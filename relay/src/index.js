// SRATH game relay (named trails-relay after the first game that used it).
// 1. Passes messages between the players of online games (Trails, Knockout, Ricochet).
// 2. Keeps anonymous global stats for the games (see stats.js), under /stats/.
//
// Each room is one Durable Object, named by its game and invite code. The player who creates the room is the
// "host": their browser runs the game. The other players ("guests") only send their steering.
//   - host  -> relay: broadcast to every guest, or to one guest when the message has "to": <seat>
//   - guest -> relay: forwarded to the host with "from": <seat> added
// The relay stores nothing. It keeps no names, no chat and no logs of its own; a room disappears
// when its last player leaves. Hibernating WebSockets mean an idle room costs nothing.

import { DurableObject } from 'cloudflare:workers';
import { handleStats, Stats } from './stats.js';

export { Stats };

const CODE = /^[A-HJ-NP-Z2-9]{5}$/;   // invite codes: no 0/O or 1/I to mix up
const GAMES = ['trails', 'knockout', 'ricochet']; // games that can be played online
const MAX_PLAYERS = 6;                // seats 0 (host) to 5
const MAX_HOST_BYTES = 48 * 1024;     // a game-state message from the host
const MAX_GUEST_BYTES = 256;          // a steering message from a guest
const RATE_WINDOW_MS = 1000;
const MAX_HOST_RATE = 90;             // messages per second; the game sends about 30
const MAX_GUEST_RATE = 40;            // steering changes per second

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') return new Response('Trails relay for srath.dk\n', { headers: { 'content-type': 'text/plain' } });
    if (url.pathname.startsWith('/stats/')) return handleStats(request, env, url);

    // /room/<game>/<code>; the older /room/<code> is Trails.
    const match = url.pathname.match(/^\/room\/(?:([a-z]+)\/)?([^/]+)$/);
    if (!match || !CODE.test(match[2])) return new Response('Not found', { status: 404 });
    const game = match[1] || 'trails';
    if (!GAMES.includes(game)) return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });

    // Only pages on the site may open games (browsers always send Origin with WebSockets).
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(request.headers.get('Origin'))) return new Response('Forbidden', { status: 403 });

    const role = url.searchParams.get('role');
    if (role !== 'host' && role !== 'guest') return new Response('Bad role', { status: 400 });

    // Trails rooms keep their original names, so links made before games had their own rooms still work.
    const name = game === 'trails' ? match[2] : game + ':' + match[2];
    const stub = env.ROOMS.get(env.ROOMS.idFromName(name));
    return stub.fetch(request);
  },
};

export class TrailsRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rates = new Map(); // socket -> { start, count }; lost on hibernation, which is fine
    // Keep-alive pings are answered without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request) {
    const role = new URL(request.url).searchParams.get('role');
    const { 0: client, 1: server } = new WebSocketPair();
    const open = this.ctx.getWebSockets();
    const host = this.ctx.getWebSockets('host')[0];

    // A browser cannot read why a WebSocket upgrade failed, so refusals are sent as a message.
    const refuse = (reason) => {
      this.ctx.acceptWebSocket(server, ['refused']);
      server.serializeAttachment({ seat: -1 });
      server.send(JSON.stringify({ t: 'refused', reason }));
      server.close(4000, reason);
      return new Response(null, { status: 101, webSocket: client });
    };

    let seat;
    if (role === 'host') {
      if (host) return refuse('taken');
      seat = 0;
    } else {
      if (!host) return refuse('no-game');
      const taken = new Set(open.map((ws) => this.seatOf(ws)));
      for (let s = 1; s < MAX_PLAYERS; s++) if (!taken.has(s)) { seat = s; break; }
      if (seat === undefined) return refuse('full');
    }

    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ seat });
    server.send(JSON.stringify({ t: 'welcome', seat }));
    if (role === 'guest') this.send(host, { t: 'join', seat });
    return new Response(null, { status: 101, webSocket: client });
  }

  seatOf(ws) {
    const a = ws.deserializeAttachment();
    return a ? a.seat : -1;
  }

  send(ws, data) {
    try { ws.send(typeof data === 'string' ? data : JSON.stringify(data)); } catch { /* already closed */ }
  }

  tooFast(ws, limit) {
    const now = Date.now();
    let r = this.rates.get(ws);
    if (!r || now - r.start >= RATE_WINDOW_MS) { r = { start: now, count: 0 }; this.rates.set(ws, r); }
    return ++r.count > limit;
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string') return;
    const seat = this.seatOf(ws);
    if (seat < 0) return;
    const isHost = seat === 0;
    if (message.length > (isHost ? MAX_HOST_BYTES : MAX_GUEST_BYTES)) return;
    if (this.tooFast(ws, isHost ? MAX_HOST_RATE : MAX_GUEST_RATE)) return;

    let data;
    try { data = JSON.parse(message); } catch { return; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;

    if (isHost) {
      const guests = this.ctx.getWebSockets('guest');
      if (Number.isInteger(data.to)) {
        const target = guests.find((g) => this.seatOf(g) === data.to);
        if (target) this.send(target, message);
        if (data.kick && target) target.close(4002, 'removed');
      } else {
        for (const g of guests) this.send(g, message);
      }
    } else {
      const host = this.ctx.getWebSockets('host')[0];
      if (!host) return;
      data.from = seat;
      this.send(host, data);
    }
  }

  async webSocketClose(ws, code) {
    this.left(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch { /* already closed */ }
  }

  async webSocketError(ws) {
    this.left(ws);
  }

  left(ws) {
    this.rates.delete(ws);
    const seat = this.seatOf(ws);
    if (seat === 0) {
      // Without the host there is no game: tell everyone and close the room.
      for (const g of this.ctx.getWebSockets('guest')) {
        this.send(g, { t: 'host-left' });
        try { g.close(4001, 'host left'); } catch { /* already closed */ }
      }
    } else if (seat > 0) {
      const host = this.ctx.getWebSockets('host')[0];
      if (host && host !== ws) this.send(host, { t: 'leave', seat });
    }
  }
}
