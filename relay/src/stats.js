// Anonymous global stats for the srath.dk browser games.
//
// When a game ends, the page sends its result (number of guesses, a time, a win streak) and gets back
// its rank. Only counts are stored: "on board X, N results had value V". No names, no IP addresses,
// no identifiers of any kind. Gridword's daily boards are deleted two days after their day.
//
// All boards live in one Durable Object with SQLite storage (included in the Workers Free plan).

import { DurableObject } from 'cloudflare:workers';
import ANSWERS from './answers.js';   // generated from public/games/gridword/words.js by gen-answers.mjs

const FIRST_DAY = Date.UTC(2026, 10, 13);   // Gridword #1 (must match the game)
const ANSWER_SEED = 20261113;               // the seed the game shuffles its answers with
const MAX_BODY = 2048;
const RATE_LIMIT = 60;                      // submissions per hour from one address (kept in memory only)

// lower: true when a smaller value is better. day: true for boards that start fresh every day.
const BOARDS = {
  'gw-guesses': { lower: true, day: true, min: 1, max: 7 },        // 7 = not solved
  'gw-time': { lower: true, day: true, min: 3, max: 86400 },       // seconds, solved games only
  'gw-streak': { lower: false, day: true, min: 0, max: 100000 },
  'br-commands': { lower: true, min: 12, max: 100000 },
  'br-time': { lower: true, min: 60, max: 30 * 86400 },            // seconds
};
for (const game of ['trails', 'knockout', 'ricochet']) {
  for (let bots = 1; bots <= 5; bots++) BOARDS[game + '-streak-' + bots] = { lower: false, min: 1, max: 1000 };
}

// The same shuffle as the game, so the server knows each day's word.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(list, seed) {
  const out = list.slice(), rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const DAILY = shuffled(ANSWERS, ANSWER_SEED);
function utcDay() { return Math.floor((Date.now() - FIRST_DAY) / 86400000); }

function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { 'content-type': 'application/json', ...cors } });
}

// Called by the Worker for /stats/... requests.
export async function handleStats(request, env, url) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return new Response('Forbidden', { status: 403 });
  const cors = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' };
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400' } });
  }
  const stub = env.STATS.get(env.STATS.idFromName('stats'));
  const res = await stub.fetch(new Request(url.toString(), {
    method: request.method,
    headers: { 'content-type': 'application/json', 'x-ip': request.headers.get('CF-Connecting-IP') || '' },
    body: request.method === 'POST' ? (await request.text()).slice(0, MAX_BODY) : undefined,
  }));
  return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json', ...cors } });
}

export class Stats extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS counts (board TEXT NOT NULL, day INTEGER NOT NULL, value INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (board, day, value))');
    this.rates = new Map();   // address -> { start, count }; in memory only, never stored
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST') {
        if (this.tooMany(request.headers.get('x-ip'))) return json({ error: 'slow down' }, 429);
        let body;
        try { body = JSON.parse(await request.text()); } catch { return json({ error: 'bad request' }, 400); }
        if (url.pathname === '/stats/gridword') return json(this.gridword(body, true));
        if (url.pathname === '/stats/submit') return json(this.single(body.board, body.value, true));
      } else if (request.method === 'GET') {
        const q = Object.fromEntries(url.searchParams);
        if (url.pathname === '/stats/gridword') return json(this.gridword({ day: +q.day, guesses: q.guesses ? q.guesses.split(',') : [], time: +q.time, streak: +q.streak }, false));
        if (url.pathname === '/stats/rank') return json(this.single(q.board, +q.value, false));
        if (url.pathname === '/stats/top') return json(this.top(q.board));
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 400);
    }
  }

  tooMany(ip) {
    const now = Date.now();
    if (this.rates.size > 5000) this.rates.clear();
    let r = this.rates.get(ip);
    if (!r || now - r.start > 3600000) { r = { start: now, count: 0 }; this.rates.set(ip, r); }
    return ++r.count > RATE_LIMIT;
  }

  check(board, value) {
    const b = BOARDS[board];
    if (!b) throw new Error('unknown board');
    if (!Number.isInteger(value) || value < b.min || value > b.max) throw new Error('value out of range');
    return b;
  }

  add(board, day, value) {
    this.sql.exec('INSERT INTO counts (board, day, value, n) VALUES (?, ?, ?, 1) ON CONFLICT (board, day, value) DO UPDATE SET n = n + 1', board, day, value);
  }

  // Rank of a value among everything on the board. When it wasn't added, it's counted as one more result.
  rank(board, day, value, added) {
    const b = BOARDS[board];
    const row = this.sql.exec(
      'SELECT COALESCE(SUM(n), 0) AS total, COALESCE(SUM(CASE WHEN value < ? THEN n ELSE 0 END), 0) AS below, ' +
      'COALESCE(SUM(CASE WHEN value > ? THEN n ELSE 0 END), 0) AS above FROM counts WHERE board = ? AND day = ?',
      value, value, board, day).one();
    const total = row.total + (added ? 0 : 1);
    const better = b.lower ? row.below : row.above;    // results that beat this one
    const worse = b.lower ? row.above : row.below;     // results this one beats
    return { value, rank: better + 1, total, beats: total > 1 ? Math.floor((worse / (total - 1)) * 100) : 0 };
  }

  // The best value on an all-time board, and how many results it has.
  top(board) {
    const b = BOARDS[board];
    if (!b || b.day) throw new Error('unknown board');
    const row = this.sql.exec((b.lower ? 'SELECT MIN(value)' : 'SELECT MAX(value)') + ' AS top, COALESCE(SUM(n), 0) AS total FROM counts WHERE board = ? AND day = -1', board).one();
    return { top: row.top, total: row.total };
  }

  single(board, value, add) {
    const b = this.check(board, value);
    if (b.day) throw new Error('use the daily endpoint');
    if (add) this.add(board, -1, value);
    return this.rank(board, -1, value, add);
  }

  // Gridword: the server checks the guesses against the day's word before anything counts.
  gridword(body, add) {
    const day = body.day;
    if (!Number.isInteger(day) || Math.abs(day - utcDay()) > 1) throw new Error('not today\'s Gridword');
    const guesses = Array.isArray(body.guesses) ? body.guesses.map((g) => String(g).toLowerCase()) : [];
    if (!guesses.length || guesses.length > 6 || !guesses.every((g) => /^[a-z]{5}$/.test(g))) throw new Error('bad guesses');
    const answer = DAILY[day % DAILY.length];
    const solved = guesses[guesses.length - 1] === answer;
    if (!solved && guesses.length < 6) throw new Error('game not finished');
    if (guesses.slice(0, -1).includes(answer)) throw new Error('bad guesses');
    const guessValue = solved ? guesses.length : 7;
    const streak = Math.max(0, Math.min(Math.floor(body.streak) || 0, day + 1));
    const time = Math.floor(body.time) || 0;
    const timeOk = solved && time >= BOARDS['gw-time'].min && time <= BOARDS['gw-time'].max;

    if (add) {
      this.add('gw-guesses', day, guessValue);
      if (timeOk) this.add('gw-time', day, time);
      this.add('gw-streak', day, streak);
      // Old days are no longer needed.
      this.sql.exec('DELETE FROM counts WHERE day >= 0 AND day < ?', day - 2);
    }
    const dist = [0, 0, 0, 0, 0, 0, 0];
    for (const r of this.sql.exec('SELECT value, n FROM counts WHERE board = ? AND day = ?', 'gw-guesses', day)) dist[r.value - 1] = r.n;
    return {
      day,
      guesses: this.rank('gw-guesses', day, guessValue, add),
      time: timeOk ? this.rank('gw-time', day, time, add) : null,
      streak: this.rank('gw-streak', day, streak, add),
      dist,
    };
  }
}
