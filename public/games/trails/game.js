// Trails: steer a glowing dot that leaves a line behind it. Hit a line and you are out; slip through the gaps.
// Play against computer dots, with two players on one keyboard, or online with friends. Optional power-ups.
// The simulation runs on a fixed arena and a fixed timestep, so it plays the same on every screen.
// Online, the browser that creates the game (the host) runs the simulation and sends the state to the
// other players through a small relay (see /relay in the website repository); the others only send
// their steering. Settings are kept in localStorage.
(function () {
  'use strict';

  var root = document.getElementById('trails');
  if (!root) return;

  // Arena and rules, in arena units (the canvas is scaled to fit).
  var W = 1000, H = 680;
  var STEP = 1 / 120;            // simulation timestep, seconds
  var SPEED = 125;               // units per second
  var TURN = 2.7;                // radians per second: limits how sharply a dot can turn
  var LINE = 5;                  // trail width
  var GAP_EVERY = [2.2, 4.5];    // seconds between gaps (random in range)
  var GAP_LENGTH = 0.3;          // seconds a gap lasts; during it your dot hops over lines
  var GAP_WARN = 0.6;            // seconds of warning (a closing ring) before a gap opens
  var CELL = 2;                  // collision grid resolution
  var SELF_GRACE = 0.3;          // seconds before your own fresh trail can hit you
  var SETUP_KEY = 'trails:setup';

  var COLORS = [
    { name: 'Teal', hex: '#2dd4bf' }, { name: 'Indigo', hex: '#818cf8' }, { name: 'Amber', hex: '#fbbf24' },
    { name: 'Pink', hex: '#f472b6' }, { name: 'Sky', hex: '#38bdf8' }, { name: 'Lime', hex: '#a3e635' },
  ];

  // Power-ups. kind: 'self' helps whoever takes it, 'others' hits everyone else, 'arena' changes the arena.
  // time: seconds the effect lasts (taking the same one again adds time). weight: how often it appears.
  var POWERUPS = {
    ghost: { kind: 'self', label: 'Ghost', glyph: '◌', time: 4, weight: 2, desc: 'no line, and you pass through lines' },
    boost: { kind: 'self', label: 'Boost', glyph: '»', time: 5, weight: 2, desc: 'faster' },
    brake: { kind: 'self', label: 'Brake', glyph: '«', time: 5, weight: 2, desc: 'slower, with tighter turns' },
    sharp: { kind: 'self', label: 'Sharp turns', glyph: '┐', time: 6, weight: 1.5, desc: 'turn in 90° corners' },
    wrap: { kind: 'self', label: 'Wrap', glyph: '⇆', time: 7, weight: 1.5, desc: 'walls send you out the other side' },
    slow: { kind: 'others', label: 'Slow others', glyph: '≈', time: 5, weight: 1.5, desc: 'everyone else slows down' },
    fat: { kind: 'others', label: 'Fat lines', glyph: '▮', time: 5, weight: 1.5, desc: 'everyone else draws a thick line' },
    clear: { kind: 'arena', label: 'Clear', glyph: '✕', weight: 1, desc: 'wipes every line off the arena' },
    shrink: { kind: 'arena', label: 'Shrink', glyph: '⊡', weight: 1, desc: 'the walls close in' },
  };
  var KIND_COLORS = { self: '#2dd4bf', others: '#fb7185', arena: '#fbbf24' };
  var PICK_R = 14;               // pickup radius
  var PICK_EVERY = [2.5, 5];     // seconds between new pickups
  var PICK_MAX = 3;              // at most this many on the arena
  var PICK_LIFE = 14;            // seconds before an untaken pickup disappears
  var MAX_EFFECT = 12;           // an effect never lasts longer than this
  var SHRINK_STEP = 0.1, SHRINK_MAX = 0.3, SHRINK_SPEED = 0.02; // fraction of the arena per side, per second
  var GHOST_GRACE = 0.25;        // after Ghost ends, lines stay harmless this long so you can get clear

  // Online play. On this machine during development, a local relay (npm run dev in /relay) is used.
  var RELAY = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) ? 'ws://127.0.0.1:8787' : (root.dataset.relay || '');
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var SEND_EVERY = 0.04;         // the host sends the game state 25 times a second
  var MAX_SEATS = 6;

  // ---------------------------------------------------------------------------
  // Helpers

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function load(key, fallback) { try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // On a phone held sideways the game fills exactly one screen; scroll it into view so the
  // site header is out of the way (see the landscape rule in game.css).
  var shortLandscape = window.matchMedia('(orientation: landscape) and (max-height: 520px)');
  function bringIntoView() {
    if (!shortLandscape.matches || root.classList.contains('is-full')) return;
    var top = root.getBoundingClientRect().top + window.scrollY - 4;
    if (Math.abs(window.scrollY - top) > 2) window.scrollTo({ top: top, behavior: 'smooth' });
  }

  // Tiny synthesized sounds, only after the visitor has interacted with the page.
  var audio = null, muted = load('trails:muted', false);
  function tone(freq, dur, type, vol, slide) {
    if (muted || (navigator.userActivation && !navigator.userActivation.hasBeenActive)) return;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audio = audio || new Ctx();
    if (audio.state === 'suspended') audio.resume();
    var t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.08, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur + 0.03);
  }

  // ---------------------------------------------------------------------------
  // DOM

  root.textContent = '';
  root.classList.add('tr');
  var hud = el('div', 'tr-hud');
  var board = el('div', 'tr-scores');
  board.setAttribute('aria-label', 'Scores');
  var tools = el('div', 'tr-tools');
  var fullBtn = el('button', 'tr-btn', 'Full screen');
  var pauseBtn = el('button', 'tr-btn', 'Pause');
  var muteBtn = el('button', 'tr-btn');
  fullBtn.type = pauseBtn.type = muteBtn.type = 'button';
  tools.append(fullBtn, pauseBtn, muteBtn);
  hud.append(board, tools);

  var stage = el('div', 'tr-stage');
  stage.tabIndex = 0;
  var canvas = el('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Trails arena');
  var overlay = el('div', 'tr-overlay');
  stage.append(canvas, overlay);
  var help = el('p', 'tr-help');
  var live = el('p', 'sr-only');
  live.setAttribute('aria-live', 'polite');
  root.append(hud, stage, help, live);

  var ctx = canvas.getContext('2d');
  var trailCanvas = document.createElement('canvas');   // all trails drawn so far this round
  var tctx = trailCanvas.getContext('2d');
  var scale = 1, dpr = 1;

  // ---------------------------------------------------------------------------
  // Game state

  var setup = load(SETUP_KEY, { mode: 'solo', bots: 3, powerups: true, disabled: [] });
  if (setup.powerups === undefined) setup.powerups = true;
  if (!Array.isArray(setup.disabled)) setup.disabled = [];
  if (setup.onlineBots === undefined) setup.onlineBots = 0;
  if (setup.mode === 'online' && !RELAY) setup.mode = 'solo';
  var net = null;                 // the online connection, or null when playing offline
  var players = [];
  var grid, gridW = Math.ceil(W / CELL), gridH = Math.ceil(H / CELL);
  var stamps;                     // step number when each cell was drawn
  var segments = [];              // [x1, y1, x2, y2, colourIndex, width] for redrawing after a resize
  var particles = [];
  var pickups = [], nextPickup = 0;
  var inset = 0, insetTarget = 0; // how far the walls have closed in (fraction of the arena per side)
  var flash = 0;                  // brief white flash when the arena is cleared
  var phase = 'menu';             // menu | ready | playing | roundover | matchover | paused
  var pausedFrom = null;
  var stepCount = 0, readyTime = 0, roundOverTime = 0, target = 5, round = 0, accumulator = 0;
  var roundMessage = '', roundColor = '';
  var keys = {};
  var touch = { left: false, right: false };

  function humans() { return players.filter(function (p) { return !p.bot; }); }
  // A player's id is their colour (an index into COLORS). Online, each human also has a seat
  // (0 = host) given by the relay, which is how steering and leaving are matched to players.
  function isMe(p) { return net ? !p.bot && p.seat === net.seat : p.id === (setup.mode === 'solo' ? 0 : -1); }
  function who(p) { return isMe(p) ? 'You' : p.name; }
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  // Online name and colour, remembered in this browser.
  var profile = load('trails:profile', { name: '', color: -1 });
  function cleanName(t) {
    return String(t || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/\s+/g, ' ').trim().slice(0, 12);
  }
  function isHost() { return !!net && net.role === 'host'; }
  function isGuest() { return !!net && net.role === 'guest'; }

  function makePlayers() {
    var list = [];
    if (net) {
      var seats = [0].concat(net.guests).filter(function (s) { return net.members[s]; });
      seats.forEach(function (s) {
        var m = net.members[s];
        list.push({ id: m.ci, seat: s, bot: false, name: memberName(m), score: 0 });
      });
      var used = list.map(function (p) { return p.id; });
      var free = COLORS.map(function (c, i) { return i; }).filter(function (i) { return used.indexOf(i) === -1; });
      for (var n = 0; n < setup.onlineBots && free.length; n++) {
        var id = free.shift();
        list.push({ id: id, bot: true, name: COLORS[id].name, score: 0 });
      }
      list.sort(function (a, b) { return a.id - b.id; });
      list.forEach(function (p) { p.color = COLORS[p.id].hex; });
      return list;
    }
    var humansCount = setup.mode === 'duo' ? 2 : 1;
    for (var i = 0; i < humansCount; i++) {
      list.push({ id: i, bot: false, name: humansCount === 1 ? 'You' : 'Player ' + (i + 1), score: 0 });
    }
    for (var b = 0; b < setup.bots; b++) list.push({ id: list.length, bot: true, name: COLORS[list.length].name, score: 0 });
    list.forEach(function (p) { p.color = COLORS[p.id].hex; });
    return list;
  }

  function startMatch() {
    players = makePlayers();
    target = Math.max(3, (players.length - 1) * 5);
    round = 0;
    if (isHost()) {
      netSend({ t: 'match', target: target, pl: players.map(function (p) { return [p.id, p.bot ? 1 : 0, p.bot ? -1 : p.seat, p.bot ? '' : p.name]; }) });
    }
    startRound();
  }

  function startRound() {
    round++;
    grid = new Uint8Array(gridW * gridH);
    stamps = new Uint32Array(gridW * gridH);
    segments = [];
    particles = [];
    pickups = [];
    nextPickup = rand(2, 4);
    inset = insetTarget = 0;
    flash = 0;
    stepCount = 0;
    accumulator = 0;
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    placePlayers();
    phase = 'ready';
    readyTime = 1.6;
    overlay.hidden = true;
    renderScores();
    stage.focus({ preventScroll: true });
    bringIntoView();
    if (isHost()) {
      net.events = []; net.segs = [];
      netSend({ t: 'round', n: round, target: target });
      sendState();
    }
  }

  // Spread the dots out, each pointing roughly towards the middle.
  function placePlayers() {
    players.forEach(function (p, i) {
      var x, y, tries = 0;
      do {
        x = rand(W * 0.15, W * 0.85);
        y = rand(H * 0.15, H * 0.85);
        tries++;
      } while (tries < 200 && players.slice(0, i).some(function (q) { return Math.hypot(q.x - x, q.y - y) < 170; }));
      p.x = x; p.y = y;
      p.angle = Math.atan2(H / 2 - y, W / 2 - x) + rand(-0.9, 0.9);
      p.alive = !p.left;  // an online player who left stays out
      p.gap = 0;
      p.nextGap = rand(GAP_EVERY[0], GAP_EVERY[1]);
      p.turn = 0;
      p.think = 0;
      p.fx = {};          // active effects: name -> seconds left (can go negative once ended)
      p.latch = 0;        // Sharp turns: the direction already turned, until the key is released
      p.lastDir = 0;
    });
  }

  // ---------------------------------------------------------------------------
  // Effects

  function fx(p, name) { return (p.fx[name] || 0) > 0; }
  function speedOf(p) { return SPEED * (fx(p, 'boost') ? 1.6 : 1) * (fx(p, 'brake') ? 0.6 : 1) * (fx(p, 'slow') ? 0.6 : 1); }
  function turnOf(p) { return TURN * (fx(p, 'brake') ? 1.5 : 1); }
  function widthOf(p) { return fx(p, 'fat') ? LINE * 3 : LINE; }
  function ghostly(p) { return p.fx.ghost != null && p.fx.ghost > -GHOST_GRACE; }

  function bounds() {
    return { l: W * inset, r: W * (1 - inset), t: H * inset, b: H * (1 - inset) };
  }
  function wrapPoint(x, y) {
    var b = bounds();
    if (x < b.l) x += b.r - b.l; else if (x > b.r) x -= b.r - b.l;
    if (y < b.t) y += b.b - b.t; else if (y > b.b) y -= b.b - b.t;
    return [x, y];
  }

  // ---------------------------------------------------------------------------
  // Simulation

  function cellIndex(x, y) {
    var cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    if (cx < 0 || cy < 0 || cx >= gridW || cy >= gridH) return -1;
    return cy * gridW + cx;
  }

  function stamp(p) {
    var r = widthOf(p) / 2;
    for (var dy = -r; dy <= r; dy += CELL) {
      for (var dx = -r; dx <= r; dx += CELL) {
        if (dx * dx + dy * dy > r * r + 1) continue;
        var i = cellIndex(p.x + dx, p.y + dy);
        if (i >= 0) { grid[i] = p.id + 1; stamps[i] = stepCount; }
      }
    }
  }

  // Would player p crash at (x, y)?
  // `now` is true for the real move (not a bot's look-ahead): only then does an open gap let you hop over lines.
  function blocked(p, x, y, now) {
    var b = bounds();
    if (fx(p, 'wrap')) { var w = wrapPoint(x, y); x = w[0]; y = w[1]; }
    else if (x < b.l + 2 || y < b.t + 2 || x > b.r - 2 || y > b.b - 2) return true;
    if (ghostly(p) || (now && p.gap > 0)) return false;
    var i = cellIndex(x, y);
    if (i < 0) return true;
    var owner = grid[i];
    if (!owner) return false;
    if (owner - 1 !== p.id) return true;
    return stepCount - stamps[i] > SELF_GRACE / STEP;
  }

  function steer(p) {
    if (p.bot) return botSteer(p);
    if (net) return p.seat === 0 ? localDir() : (net.inputs[p.seat] || 0);
    if (p.id === 0) return localDir();
    return (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  }

  // Steering for the player at this keyboard: arrows (or A/D when nobody else shares it) and touch.
  function localDir() {
    var single = !!net || setup.mode === 'solo';
    var left = keys.ArrowLeft || (single && keys.KeyA) || touch.left;
    var right = keys.ArrowRight || (single && keys.KeyD) || touch.right;
    return (right ? 1 : 0) - (left ? 1 : 0);
  }

  // Bots imagine following each choice along its real path and count how long they would survive.
  var LOOK = 1.6, LOOK_STEP = 0.04;
  function survival(p, dir, turnFor, offset) {
    var x = p.x, y = p.y, a = p.angle + (offset || 0), sp = speedOf(p), tr = turnOf(p);
    for (var t = LOOK_STEP; t <= LOOK; t += LOOK_STEP) {
      if (t <= turnFor) a += dir * tr * LOOK_STEP;
      x += Math.cos(a) * sp * LOOK_STEP;
      y += Math.sin(a) * sp * LOOK_STEP;
      if (blocked(p, x, y)) return t;
    }
    return LOOK;
  }

  function nearestPickup(p) {
    var best = null, bestD = 320;
    pickups.forEach(function (k) {
      var d = Math.hypot(k.x - p.x, k.y - p.y);
      if (d < bestD) { best = k; bestD = d; }
    });
    return best;
  }

  function botSteer(p) {
    p.think -= STEP;
    if (p.think > 0) return p.turn;
    p.think = rand(0.05, 0.1);

    // With Sharp turns, a turn is an instant 90° corner, so compare straight, left corner and right corner.
    if (fx(p, 'sharp')) {
      if (p.latch !== 0) { p.turn = 0; return 0; }
      var opts = [[0, survival(p, 0, 0, 0) + 0.1], [-1, survival(p, 0, 0, -Math.PI / 2)], [1, survival(p, 0, 0, Math.PI / 2)]];
      opts.sort(function (a, b) { return b[1] - a[1]; });
      p.turn = opts[0][0];
      return p.turn;
    }

    var best = 0, bestScore = -1, safe = [];
    [-1, 0, 1].forEach(function (dir) {
      // Either keep turning, or turn briefly and then go straight; whichever survives longer.
      var score = Math.max(survival(p, dir, LOOK), survival(p, dir, 0.35));
      if (score >= LOOK) safe.push(dir);
      if (dir === p.turn) score += 0.05;         // a little stubbornness avoids wobbling
      if (score > bestScore) { bestScore = score; best = dir; }
    });
    if (safe.length > 1) {
      // When it is safe, head for a nearby power-up; otherwise wander now and then.
      var pk = powerupsOn() && nearestPickup(p);
      if (pk) {
        var diff = Math.atan2(pk.y - p.y, pk.x - p.x) - p.angle;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        var want = Math.abs(diff) < 0.15 ? 0 : diff > 0 ? 1 : -1;
        if (safe.indexOf(want) !== -1) best = want;
      } else if (Math.random() < 0.25) {
        best = safe[Math.floor(Math.random() * safe.length)];
      }
    }
    if (Math.random() < 0.02) best = 0;          // now and then a human-like hesitation
    p.turn = best;
    return best;
  }

  function stepPlayer(p) {
    if (!p.alive) return;
    var dir = steer(p);
    p.dir = dir;
    if (fx(p, 'sharp')) {
      if (dir !== 0 && p.latch === 0) p.angle += dir * Math.PI / 2;
      p.latch = dir;
    } else {
      p.angle += dir * turnOf(p) * STEP;
      p.latch = dir;
    }
    var sp = speedOf(p);
    var nx = p.x + Math.cos(p.angle) * sp * STEP;
    var ny = p.y + Math.sin(p.angle) * sp * STEP;

    // Check slightly ahead of the head so lines are hit where they look hit.
    var ahead = LINE / 2 + 0.5;
    if (blocked(p, nx + Math.cos(p.angle) * ahead, ny + Math.sin(p.angle) * ahead, true)) { crash(p); return; }

    var wrapped = false;
    if (fx(p, 'wrap')) {
      var w = wrapPoint(nx, ny);
      wrapped = w[0] !== nx || w[1] !== ny;
      nx = w[0]; ny = w[1];
    }

    var before = p.nextGap;
    p.nextGap -= STEP;
    if (!p.bot && (!net || isMe(p)) && before > GAP_WARN && p.nextGap <= GAP_WARN) tone(1200, 0.05, 'sine', 0.025); // soft tick: gap coming
    if (p.nextGap <= 0) { p.gap = GAP_LENGTH; p.nextGap = rand(GAP_EVERY[0], GAP_EVERY[1]) + GAP_LENGTH; }
    var drawing = p.gap <= 0 && !fx(p, 'ghost');
    if (p.gap > 0) p.gap -= STEP;

    if (drawing && !wrapped) {
      var width = widthOf(p);
      segments.push([p.x, p.y, nx, ny, p.id, width]);
      drawSegment(p.x, p.y, nx, ny, p.color, width);
      if (isHost()) net.segs.push(r1(p.x), r1(p.y), r1(nx), r1(ny), p.id, width);
    }
    p.x = nx; p.y = ny;
    if (drawing) stamp(p);

    Object.keys(p.fx).forEach(function (k) { if (p.fx[k] > -1) p.fx[k] -= STEP; });
    if (powerupsOn()) collect(p);
  }

  function crash(p) {
    p.alive = false;
    emit(['x', p.id]);
    crashEffect(p);
    // Everyone still alive scores a point.
    players.forEach(function (q) { if (q.alive) q.score++; });
    renderScores();
  }

  function crashEffect(p) {
    for (var i = 0; i < 26; i++) {
      var a = Math.random() * Math.PI * 2, s = rand(40, 260);
      particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 0.9), color: p.color });
    }
    particles.push({ ring: true, x: p.x, y: p.y, r: 4, life: 0.6, color: p.color });
    tone(p.bot ? 180 : 140, 0.35, 'sawtooth', 0.06, 60);
  }

  // ---------------------------------------------------------------------------
  // Power-ups

  function enabledPowerups() {
    return Object.keys(POWERUPS).filter(function (n) { return setup.disabled.indexOf(n) === -1; });
  }
  function powerupsOn() { return setup.powerups && enabledPowerups().length > 0; }

  function pickType() {
    var names = enabledPowerups();
    var total = names.reduce(function (s, n) { return s + POWERUPS[n].weight; }, 0);
    var r = Math.random() * total;
    for (var i = 0; i < names.length; i++) { r -= POWERUPS[names[i]].weight; if (r <= 0) return names[i]; }
    return names[0];
  }

  function spawnPickup() {
    var b = bounds();
    for (var tries = 0; tries < 40; tries++) {
      var x = rand(b.l + 40, b.r - 40), y = rand(b.t + 40, b.b - 40);
      if (players.some(function (p) { return p.alive && Math.hypot(p.x - x, p.y - y) < 80; })) continue;
      if (pickups.some(function (k) { return Math.hypot(k.x - x, k.y - y) < 60; })) continue;
      var clear = true;
      for (var a = 0; a < 8 && clear; a++) {
        var i = cellIndex(x + Math.cos(a) * PICK_R, y + Math.sin(a) * PICK_R);
        if (i >= 0 && grid[i]) clear = false;
      }
      if (!clear || (grid[cellIndex(x, y)] || 0)) continue;
      pickups.push({ type: pickType(), x: x, y: y, age: 0 });
      return;
    }
  }

  function updatePickups() {
    nextPickup -= STEP;
    if (nextPickup <= 0) {
      if (pickups.length < PICK_MAX) spawnPickup();
      nextPickup = rand(PICK_EVERY[0], PICK_EVERY[1]);
    }
    var b = bounds();
    pickups = pickups.filter(function (k) {
      k.age += STEP;
      return k.age < PICK_LIFE && k.x > b.l + PICK_R && k.x < b.r - PICK_R && k.y > b.t + PICK_R && k.y < b.b - PICK_R;
    });
  }

  function collect(p) {
    for (var i = 0; i < pickups.length; i++) {
      var k = pickups[i];
      if (Math.hypot(k.x - p.x, k.y - p.y) > PICK_R + 5) continue;
      pickups.splice(i, 1);
      apply(k.type, p);
      return;
    }
  }

  function addTime(q, name) {
    q.fx[name] = Math.min(MAX_EFFECT, Math.max(0, q.fx[name] || 0) + POWERUPS[name].time);
  }

  function apply(type, p) {
    var pu = POWERUPS[type];
    if (pu.kind === 'self') {
      addTime(p, type); // a key held while taking Sharp turns is already latched, so it does not corner instantly
    } else if (pu.kind === 'others') {
      players.forEach(function (q) { if (q !== p && q.alive) addTime(q, type); });
    } else if (type === 'clear') {
      grid.fill(0);
      if (isHost()) net.segs = [];  // guests clear their lines when the event arrives
    } else if (type === 'shrink') {
      insetTarget = Math.min(SHRINK_MAX, insetTarget + SHRINK_STEP);
    }
    emit(['pu', type, p.id]);
    pickupEffect(type, p);
  }

  // What everyone sees and hears when a power-up is taken (guests replay this from the host's events).
  function pickupEffect(type, p) {
    var pu = POWERUPS[type];
    if (type === 'clear') {
      segments = [];
      tctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
      flash = 1;
    }
    particles.push({ text: pu.label, x: p.x, y: p.y - 16, vx: 0, vy: -30, life: 1.1, color: KIND_COLORS[pu.kind] });
    if (!p.bot) live.textContent = pu.label + '.';
    tone(pu.kind === 'self' ? 880 : pu.kind === 'others' ? 330 : 520, 0.18, 'triangle', 0.07, pu.kind === 'self' ? 1320 : null);
  }

  // ---------------------------------------------------------------------------
  // Main update

  function update(dt) {
    particles.forEach(function (q) {
      if (q.ring) { q.r += 120 * dt; } else { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.93; q.vy *= 0.93; }
      q.life -= dt;
    });
    particles = particles.filter(function (q) { return q.life > 0; });
    flash = Math.max(0, flash - dt * 2.5);

    if (isGuest()) { guestUpdate(dt); return; }

    if (phase === 'ready') {
      readyTime -= dt;
      if (readyTime <= 0) { phase = 'playing'; emit(['go']); tone(660, 0.12, 'triangle', 0.07); }
      return;
    }
    if (phase === 'roundover') {
      roundOverTime -= dt;
      if (roundOverTime <= 0) {
        var winner = leader();
        if (winner.score >= target) endMatch(winner); else startRound();
      }
      return;
    }
    if (phase !== 'playing') return;

    // When every human is out, fast-forward so nobody waits for the bots.
    var speed = humans().some(function (p) { return p.alive; }) ? 1 : 3;
    accumulator += dt * speed;
    while (accumulator >= STEP) {
      accumulator -= STEP;
      stepCount++;
      if (inset < insetTarget) inset = Math.min(insetTarget, inset + SHRINK_SPEED * STEP);
      if (powerupsOn()) updatePickups();
      players.forEach(stepPlayer);
      var alive = players.filter(function (p) { return p.alive; });
      if (alive.length <= 1) { endRound(alive[0]); break; }
    }
  }

  function leader() {
    return players.slice().sort(function (a, b) { return b.score - a.score; })[0];
  }

  function endRound(survivor) {
    phase = 'roundover';
    roundOverTime = 1.8;
    accumulator = 0;
    emit(['ro', survivor ? survivor.id : -1]);
    roundEnded(survivor);
  }

  function roundEnded(survivor) {
    roundMessage = survivor ? who(survivor) + (who(survivor) === 'You' ? ' survive the round' : ' takes the round') : 'Nobody survives';
    roundColor = survivor ? survivor.color : '#9aa3b5';
    live.textContent = roundMessage + '.';
    if (survivor && !survivor.bot && (!net || isMe(survivor))) tone(784, 0.25, 'triangle', 0.08);
  }

  function endMatch(winner) {
    phase = 'matchover';
    if (isHost()) {
      sendState();
      netSend({ t: 'over', w: winner.id, sc: players.map(function (p) { return p.score; }) });
    }
    var you = net ? isMe(winner) : !winner.bot;
    tone(you ? 523 : 220, 0.5, 'triangle', 0.09, you ? 1046 : 110);
    var buttons = isHost() ? [['Play again', startMatch], ['Back to lobby', showLobby]]
      : isGuest() ? [['Leave game', leaveOnline]]
      : [['Play again', startMatch], ['Change setup', showMenu]];
    showOverlay(
      who(winner) === 'You' ? 'You win!' : who(winner) + ' wins',
      '<ol class="tr-final">' + players.slice().sort(function (a, b) { return b.score - a.score; }).map(function (p) {
        return '<li><span class="tr-dot" style="background:' + p.color + '"></span>' + esc(who(p)) + (p.left ? ' (left)' : '') + '<strong>' + p.score + '</strong></li>';
      }).join('') + '</ol>' + (isGuest() ? '<p>Waiting for the host to start the next game.</p>' : ''),
      buttons
    );
    live.textContent = who(winner) + ' won the match.';
  }

  // ---------------------------------------------------------------------------
  // Drawing

  function drawSegment(x1, y1, x2, y2, color, width) {
    tctx.strokeStyle = color;
    tctx.lineWidth = (width || LINE) * scale * dpr;
    tctx.lineCap = 'round';
    tctx.beginPath();
    tctx.moveTo(x1 * scale * dpr, y1 * scale * dpr);
    tctx.lineTo(x2 * scale * dpr, y2 * scale * dpr);
    tctx.stroke();
  }

  function redrawTrails() {
    tctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    segments.forEach(function (s) { drawSegment(s[0], s[1], s[2], s[3], COLORS[s[4]].hex, s[5]); });
  }

  function drawPickup(k, time) {
    var pu = POWERUPS[k.type], color = KIND_COLORS[pu.kind];
    if (k.age > PICK_LIFE - 3 && Math.floor(time * 6) % 2) return; // blink before disappearing
    var r = PICK_R * (1 + 0.06 * Math.sin(time * 5 + k.x));
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#0b0d12';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(k.x, k.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pu.glyph, k.x, k.y + 1);
    ctx.textBaseline = 'alphabetic';
  }

  // Rings around a dot showing how long each active effect has left.
  function drawTimers(p) {
    var ring = 0;
    Object.keys(p.fx).forEach(function (k) {
      if (!(p.fx[k] > 0) || !POWERUPS[k] || !POWERUPS[k].time) return;
      var part = Math.min(1, p.fx[k] / POWERUPS[k].time);
      ctx.strokeStyle = KIND_COLORS[POWERUPS[k].kind];
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10 + ring * 4, -Math.PI / 2, -Math.PI / 2 + part * Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ring++;
    });
  }

  function draw(time) {
    var cw = canvas.width, ch = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);

    // Background grid, like the rest of the site.
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1 / (scale * dpr);
    ctx.beginPath();
    for (var gx = 40; gx < W; gx += 40) { ctx.moveTo(gx, 0); ctx.lineTo(gx, H); }
    for (var gy = 40; gy < H; gy += 40) { ctx.moveTo(0, gy); ctx.lineTo(W, gy); }
    ctx.stroke();

    // Trails with a soft glow.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.shadowBlur = 10 * dpr;
    ctx.shadowColor = 'rgba(45, 212, 191, 0.35)';
    ctx.drawImage(trailCanvas, 0, 0);
    ctx.shadowBlur = 0;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);

    // Closing walls (Shrink).
    if (inset > 0.001) {
      var b = bounds();
      ctx.fillStyle = 'rgba(251, 113, 133, 0.07)';
      ctx.fillRect(0, 0, W, b.t); ctx.fillRect(0, b.b, W, H - b.b);
      ctx.fillRect(0, b.t, b.l, b.b - b.t); ctx.fillRect(b.r, b.t, W - b.r, b.b - b.t);
      ctx.strokeStyle = 'rgba(251, 113, 133, 0.75)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.strokeRect(b.l, b.t, b.r - b.l, b.b - b.t);
      ctx.setLineDash([]);
    }

    pickups.forEach(function (k) { drawPickup(k, time); });

    players.forEach(function (p) {
      if (p.x == null) return;
      if (p.alive) {
        ctx.globalAlpha = fx(p, 'ghost') ? 0.45 : 1;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 14;
        ctx.fillStyle = p.gap > 0 || fx(p, 'ghost') ? '#0b0d12' : p.color;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, LINE * 0.9, 0, Math.PI * 2);
        ctx.fill();
        if (p.gap > 0 || fx(p, 'ghost')) ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        drawTimers(p);
        // Gap warning: a ring that closes in on the dot and touches it exactly when the gap opens.
        if (phase === 'playing' && p.gap <= 0 && p.nextGap < GAP_WARN && !fx(p, 'ghost')) {
          var k = p.nextGap / GAP_WARN;
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = 0.25 + 0.6 * (1 - k);
          ctx.lineWidth = 1.5 + (1 - k) * 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(p.x, p.y, LINE * 0.9 + 2 + k * 22, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
      }
      // Before the round starts, show where each dot is heading and who it is.
      if (phase === 'ready') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 8);
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(p.angle) * 12, p.y + Math.sin(p.angle) * 12);
        ctx.lineTo(p.x + Math.cos(p.angle) * 38, p.y + Math.sin(p.angle) * 38);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (!p.bot) {
          ctx.fillStyle = p.color;
          ctx.font = '700 16px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(who(p), p.x, p.y - 18);
        }
      }
    });

    particles.forEach(function (q) {
      ctx.globalAlpha = Math.max(0, Math.min(1, q.life * 1.8));
      if (q.text) {
        ctx.fillStyle = q.color; ctx.font = '700 15px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(q.text, q.x, q.y);
      } else if (q.ring) {
        ctx.strokeStyle = q.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.fillStyle = q.color; ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
      }
    });
    ctx.globalAlpha = 1;

    if (flash > 0) { ctx.fillStyle = 'rgba(255, 255, 255, ' + flash * 0.25 + ')'; ctx.fillRect(0, 0, W, H); }

    ctx.textAlign = 'center';
    if (phase === 'ready') {
      ctx.fillStyle = '#e7e9ee';
      ctx.font = '800 54px system-ui, sans-serif';
      ctx.fillText(String(Math.max(1, Math.ceil(readyTime / 0.55))), W / 2, H / 2 + 18);
      ctx.font = '600 16px system-ui, sans-serif';
      ctx.fillStyle = '#9aa3b5';
      ctx.fillText('Round ' + round + '  ·  first to ' + target, W / 2, H / 2 + 52);
    }
    if (phase === 'roundover') {
      ctx.fillStyle = roundColor;
      ctx.font = '800 34px system-ui, sans-serif';
      ctx.fillText(roundMessage, W / 2, H / 2);
    }
  }

  function renderScores() {
    board.innerHTML = '';
    players.slice().sort(function (a, b) { return b.score - a.score; }).forEach(function (p) {
      var chip = el('span', 'tr-chip' + (p.alive === false && phase === 'playing' ? ' is-out' : ''));
      var dot = el('span', 'tr-dot');
      dot.style.background = p.color;
      chip.append(dot, el('span', 'tr-name', who(p) + (p.left ? ' (left)' : '')), el('strong', null, String(p.score)));
      board.appendChild(chip);
    });
    if (players.length) board.appendChild(el('span', 'tr-goal', 'to ' + target));
  }

  // Fit the arena to the available space, keeping its shape.
  function fit() {
    var rect = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    scale = Math.min(rect.width / W, rect.height / H);
    var cssW = W * scale, cssH = H * scale;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = trailCanvas.width = Math.round(cssW * dpr);
    canvas.height = trailCanvas.height = Math.round(cssH * dpr);
    redrawTrails();
  }

  // ---------------------------------------------------------------------------
  // Menus

  function showOverlay(title, html, buttons) {
    overlay.innerHTML = '';
    overlay.append(el('h2', 'tr-title', title));
    var body = el('div', 'tr-body');
    body.innerHTML = html;
    overlay.append(body);
    var row = el('div', 'tr-actions');
    buttons.forEach(function (b, i) {
      var btn = el('button', 'btn ' + (i === 0 ? 'btn-primary' : 'btn-ghost'), b[0]);
      btn.type = 'button';
      btn.addEventListener('click', function (e) { e.stopPropagation(); b[1](); });
      row.appendChild(btn);
    });
    overlay.append(row);
    overlay.hidden = false;
    setTimeout(function () { var first = overlay.querySelector('.btn'); if (first && !overlay.hidden && !overlay.contains(document.activeElement)) first.focus({ preventScroll: true }); }, 30);
  }

  function choice(label, options, current, onPick) {
    var wrap = el('div', 'tr-choice');
    wrap.append(el('span', 'tr-choice-label', label));
    var group = el('div', 'tr-seg');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    options.forEach(function (o) {
      var b = el('button', 'tr-seg-btn', o[1]);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(o[0] === current));
      b.addEventListener('click', function (e) { e.stopPropagation(); onPick(o[0]); });
      group.appendChild(b);
    });
    wrap.append(group);
    return wrap;
  }

  function legend() {
    var list = el('ul', 'tr-legend');
    Object.keys(POWERUPS).forEach(function (name) {
      var pu = POWERUPS[name];
      var item = el('li');
      // Each power-up is a toggle: tap to leave it out of the game.
      var btn = el('button', 'tr-legend-btn');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(setup.disabled.indexOf(name) === -1));
      var icon = el('span', 'tr-legend-icon', pu.glyph);
      icon.style.color = icon.style.borderColor = KIND_COLORS[pu.kind];
      var text = el('span');
      text.innerHTML = '<strong>' + pu.label + '</strong> ' + pu.desc;
      btn.append(icon, text);
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var i = setup.disabled.indexOf(name);
        if (i === -1) setup.disabled.push(name); else setup.disabled.splice(i, 1);
        btn.setAttribute('aria-pressed', String(i !== -1));
        save(SETUP_KEY, setup);
      });
      item.append(btn);
      list.appendChild(item);
    });
    return list;
  }

  function showMenu() {
    phase = 'menu';
    players = [];
    renderScores();
    pauseBtn.hidden = false;
    var online = setup.mode === 'online';
    var maxBots = setup.mode === 'duo' ? 4 : 5;
    var minBots = setup.mode === 'duo' ? 0 : 1;
    setup.bots = Math.max(minBots, Math.min(maxBots, setup.bots));
    showOverlay('Trails',
      '<p>Steer your dot with <kbd>←</kbd> <kbd>→</kbd>, or touch the left or right half of the screen. ' +
      'Don\'t hit any line, including your own. Every few seconds your line breaks for a moment: a ring closing around your dot warns you. ' +
      'While your line is broken you can hop over other lines, and anyone can slip through your gap.</p>' +
      '<p>Last dot alive scores. Everyone still alive gets a point each time someone crashes.</p>',
      [[online ? 'Create online game' : 'Play', function () { save(SETUP_KEY, setup); if (online) createOnline(); else startMatch(); }]]);
    var body = overlay.querySelector('.tr-body');
    var modes = [['solo', 'You vs computer'], ['duo', '2 players, 1 keyboard']];
    if (RELAY) modes.push(['online', 'Online']);
    body.append(choice('Players', modes, setup.mode, function (v) { setup.mode = v; showMenu(); }));
    if (online) {
      var info = el('p', 'tr-legend-note');
      info.innerHTML = 'You get a link to send to up to five friends. Your browser runs the game, so keep this tab open while you play. ' +
        'Players connect through a relay run by Cloudflare; see the <a class="text-link" href="/privacy/#online-games">privacy notice</a>.';
      body.append(info, joinByCode());
    } else {
      var botOptions = [];
      for (var n = minBots; n <= maxBots; n++) botOptions.push([n, String(n)]);
      body.append(choice('Computer dots', botOptions, setup.bots, function (v) { setup.bots = v; showMenu(); }));
    }
    body.append(choice('Power-ups', [[true, 'On'], [false, 'Off']], setup.powerups, function (v) { setup.powerups = v; showMenu(); }));
    if (setup.powerups) {
      var note = el('p', 'tr-legend-note');
      note.innerHTML = 'Drive into a power-up to take it. <span style="color:' + KIND_COLORS.self + '">Teal</span> helps you, ' +
        '<span style="color:' + KIND_COLORS.others + '">rose</span> hits everyone else, <span style="color:' + KIND_COLORS.arena + '">amber</span> changes the arena. ' +
        'Tap one to leave it out.';
      body.append(note, legend());
    }
    help.innerHTML = setup.mode === 'duo'
      ? '<span class="tr-dot" style="background:' + COLORS[0].hex + '"></span>Player 1: <kbd>←</kbd> <kbd>→</kbd> &nbsp; <span class="tr-dot" style="background:' + COLORS[1].hex + '"></span>Player 2: <kbd>A</kbd> <kbd>D</kbd> &nbsp; · &nbsp; <kbd>Esc</kbd> pause'
      : 'Steer with <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd>, or touch the left and right half of the arena &nbsp; · &nbsp; <kbd>Esc</kbd> pause';
    help.innerHTML += ' &nbsp; · &nbsp; <kbd>F</kbd> full screen';
    if (window.matchMedia('(pointer: coarse) and (orientation: portrait)').matches) {
      help.innerHTML = 'Touch the left or right half of the screen to steer. Turn your phone sideways for a bigger arena.';
    }
  }

  // Online, only the host can pause, and it pauses the game for everyone.
  function pause() {
    if (isGuest() || (phase !== 'playing' && phase !== 'ready')) return;
    pausedFrom = phase;
    phase = 'paused';
    if (isHost()) {
      netSend({ t: 'paused' });
      showOverlay('Paused', '<p>The game is paused for everyone.</p>', [['Continue', resume], ['Back to lobby', showLobby]]);
    } else {
      showOverlay('Paused', '', [['Continue', resume], ['Quit to menu', showMenu]]);
    }
  }
  function resume() {
    if (isGuest() || phase !== 'paused') return;
    phase = pausedFrom;
    overlay.hidden = true;
    stage.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------------
  // Online play
  //
  // Messages (JSON). Host -> guests: lobby, match, round, s (state), paused, over, busy.
  // Guest -> host: in (steering). The relay adds "from" (the guest's seat) and sends
  // welcome, join, leave, host-left and refused.

  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function emit(ev) { if (isHost()) net.events.push(ev); }
  function netSend(data) {
    if (net && net.ws.readyState === 1) net.ws.send(JSON.stringify(data));
  }
  function newCode() {
    var s = '', a = new Uint32Array(5);
    crypto.getRandomValues(a);
    for (var i = 0; i < 5; i++) s += CODE_CHARS[a[i] % CODE_CHARS.length];
    return s;
  }
  function inviteLink() { return location.origin + location.pathname + '?room=' + net.code; }

  function connect(role, code) {
    if (net) closeNet();
    var ws = new WebSocket(RELAY + '/room/' + code + '?role=' + role);
    net = { role: role, code: code, ws: ws, seat: role === 'host' ? 0 : -1, guests: [], members: {}, inputs: {}, events: [], segs: [], sendIn: 0, dir: 0, opened: false };
    var mine = net;
    ws.onmessage = function (e) {
      if (net !== mine || e.data === 'pong') return;
      var m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (role === 'host') onHostMessage(m); else onGuestMessage(m);
    };
    ws.onclose = function () {
      if (net !== mine) return;
      var wasOpen = mine.opened;
      closeNet();
      showProblem(wasOpen ? 'The connection to the game was lost.' : 'Couldn\'t reach the game server. Please try again in a little while.');
    };
    mine.ping = setInterval(function () { if (ws.readyState === 1) ws.send('ping'); }, 20000);
  }

  function closeNet() {
    if (!net) return;
    var old = net;
    net = null;
    clearInterval(old.ping);
    try { old.ws.close(1000); } catch (e) { /* already closed */ }
  }

  function leaveOnline() {
    closeNet();
    if (/[?&]room=/.test(location.search)) history.replaceState(null, '', location.pathname);
    showMenu();
  }

  function showProblem(text) {
    phase = 'menu';
    players = [];
    renderScores();
    pauseBtn.hidden = false;
    if (/[?&]room=/.test(location.search)) history.replaceState(null, '', location.pathname);
    showOverlay('Online game', '<p>' + text + '</p>', [['Back to menu', showMenu]]);
  }

  function refusedText(reason) {
    if (reason === 'full') return 'This game is full: it already has six players.';
    if (reason === 'no-game') return 'This game doesn\'t exist any more. The link may be old, or the host has closed the game.';
    return 'Couldn\'t join this game.';
  }

  // Host --------------------------------------------------------------------

  function createOnline() {
    connect('host', newCode());
    showOverlay('Online game', '<p>Opening a game…</p>', [['Cancel', leaveOnline]]);
  }

  function onHostMessage(m) {
    if (m.t === 'welcome') { net.opened = true; setMember(0, profile.name, profile.color); showLobby(); return; }
    if (m.t === 'refused') {
      // The code is already in use (very unlikely): try another one.
      if (m.reason === 'taken' && !net.retried) { closeNet(); connect('host', newCode()); net.retried = true; return; }
      closeNet();
      showProblem(refusedText(m.reason));
      return;
    }
    var seat = m.from != null ? m.from : m.seat;
    if (m.t === 'join') {
      if (phase !== 'lobby') { netSend({ t: 'busy', to: seat, kick: true }); return; }
      if (net.guests.indexOf(seat) === -1) net.guests.push(seat);
      net.guests.sort();
      setMember(seat, '', -1);   // until their name and colour arrive
      tone(660, 0.1, 'triangle', 0.05);
      showLobby();
    } else if (m.t === 'leave') {
      net.guests = net.guests.filter(function (s) { return s !== seat; });
      delete net.inputs[seat];
      delete net.members[seat];
      var p = players.filter(function (q) { return q.seat === seat; })[0];
      if (phase === 'lobby') { showLobby(); return; }
      if (p) {
        p.left = true;
        if (p.alive && (phase === 'playing' || phase === 'ready' || phase === 'paused')) crash(p); else p.alive = false;
        renderScores();
        live.textContent = p.name + ' left the game.';
      }
    } else if (m.t === 'in') {
      if (m.d === -1 || m.d === 0 || m.d === 1) net.inputs[seat] = m.d;
    } else if (m.t === 'hello') {
      if (phase !== 'lobby' || net.guests.indexOf(seat) === -1) return;
      setMember(seat, m.name, m.c);
      showLobby();
    }
  }

  // The host decides colours, so two players can never get the same one.
  function setMember(seat, name, wanted) {
    var taken = Object.keys(net.members).filter(function (s) { return +s !== seat; }).map(function (s) { return net.members[s].ci; });
    var current = net.members[seat] ? net.members[seat].ci : -1;
    var ci = -1;
    [wanted, current].concat(COLORS.map(function (c, i) { return i; })).some(function (i) {
      if (typeof i === 'number' && i >= 0 && i < COLORS.length && taken.indexOf(i) === -1) { ci = i; return true; }
      return false;
    });
    net.members[seat] = { name: cleanName(name), ci: ci };
  }
  function memberName(m) { return m.name || COLORS[m.ci].name; }
  function lobbyList() {
    return [0].concat(net.guests).filter(function (s) { return net.members[s]; }).map(function (s) {
      return [s, net.members[s].name, net.members[s].ci];
    });
  }

  function showLobby() {
    if (!isHost()) return;
    phase = 'lobby';
    players = [];
    renderScores();
    pauseBtn.hidden = false;
    var maxBots = MAX_SEATS - 1 - net.guests.length;
    setup.onlineBots = Math.max(0, Math.min(maxBots, setup.onlineBots));
    netSend({ t: 'lobby', pl: lobbyList(), bots: setup.onlineBots });

    var count = net.guests.length;
    var typing = nameFocus();
    showOverlay('Online game',
      '<p class="tr-code">Game code <strong>' + net.code + '</strong></p>' +
      '<p>Send this link to the people you want to play with, or tell them the code. Up to five can join.</p>',
      [['Start game', function () { save(SETUP_KEY, setup); startMatch(); }], ['Cancel', leaveOnline]]);
    var body = overlay.querySelector('.tr-body');
    var row = el('div', 'tr-invite');
    var input = el('input', 'tr-invite-link');
    input.readOnly = true;
    input.value = inviteLink();
    input.setAttribute('aria-label', 'Invite link');
    input.addEventListener('focus', function () { input.select(); });
    var copy = el('button', 'tr-btn', 'Copy link');
    copy.type = 'button';
    copy.addEventListener('click', function (e) {
      e.stopPropagation();
      var done = function () { copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy link'; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(done, function () { input.select(); });
      else { input.select(); }
    });
    row.append(input, copy);
    if (navigator.share) {
      var share = el('button', 'tr-btn', 'Share');
      share.type = 'button';
      share.addEventListener('click', function (e) { e.stopPropagation(); navigator.share({ title: 'Play Trails with me', url: input.value }).catch(function () {}); });
      row.append(share);
    }
    body.append(row, seatList(lobbyList()));
    body.append(profileEditor(lobbyList(), function () { setMember(0, profile.name, profile.color); showLobby(); }));
    body.append(el('p', 'tr-lobby-status', count ? (count === 1 ? 'One player has joined.' : count + ' players have joined.') : 'Waiting for players to join…'));
    var botOptions = [];
    for (var n = 0; n <= maxBots; n++) botOptions.push([n, String(n)]);
    body.append(choice('Computer dots', botOptions, setup.onlineBots, function (v) { setup.onlineBots = v; showLobby(); }));
    var note = el('p', 'tr-legend-note');
    note.textContent = setup.powerups ? 'Power-ups are on, with your choices from the menu.' : 'Power-ups are off.';
    body.append(note);
    typing();
  }

  // Rebuilding the lobby must not interrupt someone typing their name.
  function nameFocus() {
    var a = document.activeElement;
    var focused = !!(a && a.classList && a.classList.contains('tr-name-input'));
    var pos = focused ? a.selectionStart : 0;
    return function () {
      if (!focused) return;
      var input = overlay.querySelector('.tr-name-input');
      if (input) { input.focus({ preventScroll: true }); input.setSelectionRange(pos, pos); }
    };
  }

  // Name field and colour swatches. list: [[seat, name, colour], ...] as decided by the host.
  function profileEditor(list, onChange) {
    var mine = list.filter(function (e) { return e[0] === net.seat; })[0];
    var myColor = mine ? mine[2] : profile.color;
    var taken = list.filter(function (e) { return e[0] !== net.seat; }).map(function (e) { return e[2]; });
    var wrap = el('div', 'tr-profile');

    var row = el('div', 'tr-choice');
    var label = el('label', 'tr-choice-label', 'Your name');
    var input = el('input', 'tr-name-input');
    input.id = label.htmlFor = 'tr-name-input';
    input.maxLength = 12;
    input.value = profile.name;
    input.placeholder = COLORS[myColor >= 0 ? myColor : 0].name;
    input.autocomplete = 'off';
    input.spellcheck = false;
    var timer = null;
    input.addEventListener('input', function () {
      profile.name = input.value.slice(0, 12);   // cleaned when shown; kept as typed so a pause after a space is fine
      save('trails:profile', profile);
      clearTimeout(timer);
      timer = setTimeout(onChange, 450);
    });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
    row.append(label, input);

    var colours = el('div', 'tr-choice');
    colours.append(el('span', 'tr-choice-label', 'Your colour'));
    var group = el('div', 'tr-swatches');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Your colour');
    COLORS.forEach(function (c, i) {
      var b = el('button', 'tr-swatch');
      b.type = 'button';
      b.style.setProperty('--c', c.hex);
      var isTaken = taken.indexOf(i) !== -1;
      b.disabled = isTaken;
      b.setAttribute('aria-pressed', String(i === myColor));
      b.setAttribute('aria-label', c.name + (isTaken ? ' (taken)' : ''));
      b.title = c.name + (isTaken ? ' (taken)' : '');
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        profile.color = i;
        save('trails:profile', profile);
        clearTimeout(timer);
        onChange();
      });
      group.append(b);
    });
    colours.append(group);
    wrap.append(row, colours);
    return wrap;
  }

  // "Have a code?": type the five characters a friend reads out, instead of opening their link.
  function joinByCode() {
    var form = el('form', 'tr-join');
    var label = el('label', 'tr-choice-label', 'Have a code?');
    var input = el('input', 'tr-join-code');
    input.id = label.htmlFor = 'tr-join-code';
    input.maxLength = 5;
    input.placeholder = 'ABCDE';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocapitalize', 'characters');
    var btn = el('button', 'tr-btn', 'Join');
    btn.type = 'submit';
    var msg = el('p', 'tr-join-msg');
    msg.setAttribute('aria-live', 'polite');
    input.addEventListener('input', function () {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      msg.textContent = '';
    });
    form.addEventListener('click', function (e) { e.stopPropagation(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var code = input.value.toUpperCase();
      var valid = code.length === 5 && code.split('').every(function (c) { return CODE_CHARS.indexOf(c) !== -1; });
      if (!valid) {
        msg.textContent = /[01OI]/.test(code) ? 'Codes never contain 0, O, 1 or I. Check the code and try again.' : 'A code has five letters and numbers.';
        input.focus();
        return;
      }
      history.replaceState(null, '', location.pathname + '?room=' + code);
      joinOnline(code);
    });
    form.append(label, input, btn);
    var wrap = el('div');
    wrap.append(form, msg);
    return wrap;
  }

  function seatList(entries) {
    var list = el('div', 'tr-scores tr-lobby');
    entries.forEach(function (e) {
      var chip = el('span', 'tr-chip');
      var dot = el('span', 'tr-dot');
      dot.style.background = COLORS[e[2]].hex;
      var name = cleanName(e[1]) || COLORS[e[2]].name;
      chip.append(dot, el('span', null, name + (e[0] === net.seat ? ' (you)' : e[0] === 0 ? ' (host)' : '')));
      list.append(chip);
    });
    return list;
  }

  function sendState() {
    if (!isHost()) return;
    netSend({
      t: 's', ph: phase, rt: r2(readyTime), i: Math.round(inset * 1000) / 1000,
      p: players.map(function (p) {
        var f = {};
        Object.keys(p.fx).forEach(function (k) { if (p.fx[k] > 0) f[k] = r1(p.fx[k]); });
        return [r1(p.x), r1(p.y), Math.round(p.angle * 1000) / 1000, p.alive ? 1 : 0, p.gap > 0 ? r2(p.gap) : 0, r2(p.nextGap), p.dir || 0, f, p.score, p.left ? 1 : 0];
      }),
      k: pickups.map(function (k) { return [k.type, r1(k.x), r1(k.y), r1(k.age)]; }),
      e: net.events, g: net.segs,
    });
    net.events = [];
    net.segs = [];
  }

  // Guest -------------------------------------------------------------------

  function joinOnline(code) {
    connect('guest', code);
    showOverlay('Online game', '<p>Joining game ' + code + '…</p>', [['Cancel', leaveOnline]]);
  }

  function onGuestMessage(m) {
    if (m.t === 'welcome') {
      net.opened = true;
      net.seat = m.seat;
      pauseBtn.hidden = true;
      sendHello();
      showOverlay('Online game', '<p>Joined. Waiting for the host…</p>', [['Leave game', leaveOnline]]);
    } else if (m.t === 'refused') {
      closeNet();
      showProblem(refusedText(m.reason));
    } else if (m.t === 'host-left') {
      closeNet();
      showProblem('The host has left, so the game is over.');
    } else if (m.t === 'busy') {
      closeNet();
      showProblem('This game has already started. Ask the host to go back to the lobby, then open the link again.');
    } else if (m.t === 'lobby') {
      phase = 'lobby';
      players = [];
      renderScores();
      var typing = nameFocus();
      showOverlay('Online game', '<p>You\'re in. Waiting for the host to start the game.</p>', [['Leave game', leaveOnline]]);
      var body = overlay.querySelector('.tr-body');
      body.append(seatList(m.pl));
      if (m.bots) body.append(el('p', 'tr-lobby-status', m.bots === 1 ? 'Plus one computer dot.' : 'Plus ' + m.bots + ' computer dots.'));
      body.append(profileEditor(m.pl, sendHello));
      typing();
    } else if (m.t === 'match') {
      target = m.target;
      players = m.pl.map(function (d) {
        return { id: d[0], seat: d[1] ? null : d[2], bot: !!d[1], name: cleanName(d[3]) || COLORS[d[0]].name, color: COLORS[d[0]].hex, score: 0, fx: {}, alive: true, x: null };
      });
      overlay.hidden = true;
      renderScores();
    } else if (m.t === 'round') {
      round = m.n;
      target = m.target;
      segments = [];
      particles = [];
      pickups = [];
      inset = 0;
      flash = 0;
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
      players.forEach(function (p) { p.x = null; p.fx = {}; p.gap = 0; });
      phase = 'ready';
      readyTime = 1.6;
      overlay.hidden = true;
      stage.focus({ preventScroll: true });
      bringIntoView();
    } else if (m.t === 's') {
      applyState(m);
    } else if (m.t === 'paused') {
      phase = 'paused';
      showOverlay('Paused', '<p>The host has paused the game.</p>', [['Leave game', leaveOnline]]);
    } else if (m.t === 'over') {
      m.sc.forEach(function (s, i) { if (players[i]) players[i].score = s; });
      var best = players.slice().sort(function (a, b) { return b.score - a.score; })[0];
      var w = players.filter(function (p) { return p.id === m.w; })[0] || best;
      endMatch(w);
    }
  }

  function sendHello() { netSend({ t: 'hello', name: profile.name, c: profile.color }); }

  function applyState(m) {
    if (phase === 'lobby' || phase === 'matchover' || !players.length) return;
    if (phase === 'paused' && m.ph !== 'paused') overlay.hidden = true;
    var wasPlaying = phase === 'playing';
    phase = m.ph;
    readyTime = m.rt;
    inset = m.i;
    m.p.forEach(function (d, i) {
      var p = players[i];
      if (!p) return;
      var before = p.nextGap;
      p.x = p.sx = d[0]; p.y = p.sy = d[1]; p.angle = p.sa = d[2];
      p.alive = !!d[3]; p.gap = d[4]; p.nextGap = d[5]; p.dir = d[6]; p.fx = d[7]; p.score = d[8]; p.left = !!d[9];
      p.age = 0;
      if (isMe(p) && wasPlaying && before > GAP_WARN && p.nextGap <= GAP_WARN) tone(1200, 0.05, 'sine', 0.025);
    });
    pickups = m.k.map(function (k) { return { type: k[0], x: k[1], y: k[2], age: k[3] }; });
    m.e.forEach(function (ev) {
      var p = players.filter(function (q) { return q.id === ev[1]; })[0];
      if (ev[0] === 'x' && p) crashEffect(p);
      else if (ev[0] === 'pu') {
        var taker = players.filter(function (q) { return q.id === ev[2]; })[0];
        if (taker && POWERUPS[ev[1]]) pickupEffect(ev[1], taker);
      }
      else if (ev[0] === 'ro') roundEnded(p || null);
      else if (ev[0] === 'go') tone(660, 0.12, 'triangle', 0.07);
    });
    for (var j = 0; j + 5 < m.g.length; j += 6) {
      var g = m.g;
      segments.push([g[j], g[j + 1], g[j + 2], g[j + 3], g[j + 4], g[j + 5]]);
      drawSegment(g[j], g[j + 1], g[j + 2], g[j + 3], COLORS[g[j + 4]].hex, g[j + 5]);
    }
    if (board.dataset.alive !== aliveKey()) { board.dataset.alive = aliveKey(); renderScores(); }
  }

  // Between messages, move each dot along its current curve so movement looks smooth.
  function guestUpdate(dt) {
    if (phase === 'ready') readyTime = Math.max(0, readyTime - dt);
    if (phase !== 'playing') return;
    players.forEach(function (p) {
      if (!p.alive || p.sx == null) return;
      Object.keys(p.fx).forEach(function (k) { p.fx[k] -= dt; });
      if (p.gap > 0) p.gap -= dt;
      p.nextGap -= dt;
      p.age = Math.min(p.age + dt, 0.12);
      var t = p.age, sp = speedOf(p), w = fx(p, 'sharp') ? 0 : p.dir * turnOf(p);
      if (w) {
        var a = p.sa + w * t;
        p.x = p.sx + sp * (Math.sin(a) - Math.sin(p.sa)) / w;
        p.y = p.sy - sp * (Math.cos(a) - Math.cos(p.sa)) / w;
        p.angle = a;
      } else {
        p.x = p.sx + Math.cos(p.sa) * sp * t;
        p.y = p.sy + Math.sin(p.sa) * sp * t;
      }
    });
  }

  function netTick(dt) {
    if (isHost()) {
      if (phase !== 'ready' && phase !== 'playing' && phase !== 'roundover') return;
      net.sendIn -= dt;
      if (net.sendIn <= 0) { net.sendIn = SEND_EVERY; sendState(); }
    } else if (isGuest()) {
      var d = localDir();
      if (d !== net.dir) { net.dir = d; netSend({ t: 'in', d: d }); }
    }
  }

  // ---------------------------------------------------------------------------
  // Input

  var GAME_CODES = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'Space'];
  document.addEventListener('keydown', function (e) {
    if (e.target.closest && e.target.closest('input, textarea, a')) return;
    var inMenu = phase === 'menu' || phase === 'matchover' || phase === 'paused' || phase === 'lobby';
    if (e.code === 'Escape' || e.code === 'KeyP') { if (phase === 'paused') resume(); else pause(); return; }
    if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) { toggleFull(); return; }
    if (GAME_CODES.indexOf(e.code) !== -1 && !inMenu) e.preventDefault();
    keys[e.code] = true;
  });
  document.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () { keys = {}; touch.left = touch.right = false; });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); });

  // Touch: each finger steers by which half of the arena it is on.
  var pointers = {};
  function updateTouch() {
    touch.left = touch.right = false;
    Object.keys(pointers).forEach(function (id) { if (pointers[id] === 'left') touch.left = true; else touch.right = true; });
  }
  stage.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.tr-overlay')) return;
    var rect = stage.getBoundingClientRect();
    pointers[e.pointerId] = e.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
    updateTouch();
    stage.setPointerCapture && stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  function release(e) { delete pointers[e.pointerId]; updateTouch(); }
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  pauseBtn.addEventListener('click', function () { if (phase === 'paused') resume(); else pause(); pauseBtn.blur(); });

  // Full screen: the whole game (scores, arena, help) fills the screen; the arena refits automatically.
  // Where real full screen is not available or is refused (iPhone, some embedded browsers), the game
  // fills the browser window instead.
  var windowFill = false;
  function realFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function isFull() { return realFull() || windowFill; }
  function setWindowFill(on) {
    windowFill = on;
    root.classList.toggle('is-window', on);
    document.documentElement.style.overflow = on ? 'hidden' : '';
    showFull();
  }
  function toggleFull() {
    if (realFull()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    if (windowFill) { setWindowFill(false); return; }
    var request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!request) { setWindowFill(true); return; }
    var result = request.call(root);
    if (result && result.catch) result.catch(function () { setWindowFill(true); });
    setTimeout(function () { if (!realFull()) setWindowFill(true); }, 600);
  }
  function showFull() {
    fullBtn.textContent = isFull() ? 'Exit full screen' : 'Full screen';
    root.classList.toggle('is-full', isFull());
  }
  fullBtn.addEventListener('click', function () { toggleFull(); fullBtn.blur(); });
  document.addEventListener('fullscreenchange', showFull);
  document.addEventListener('webkitfullscreenchange', showFull);
  function showMute() { muteBtn.textContent = muted ? 'Sound off' : 'Sound on'; }
  muteBtn.addEventListener('click', function () { muted = !muted; save('trails:muted', muted); showMute(); muteBtn.blur(); });

  // ---------------------------------------------------------------------------
  // Loop

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    if (net) netTick(dt);
    if ((phase === 'playing' || isGuest()) && board.dataset.alive !== aliveKey()) { board.dataset.alive = aliveKey(); renderScores(); }
    draw(now / 1000);
    requestAnimationFrame(frame);
  }
  function aliveKey() { return phase + players.map(function (p) { return (p.alive ? 1 : 0) + ':' + p.score; }).join(','); }

  // Test hooks for development, used from the browser console:
  // __trails.give('boost') gives the first player a power-up; __trails.state() shows positions and effects.
  window.__trails = {
    give: function (type) { if (players[0] && players[0].alive) apply(type, players[0]); },
    raw: function () { return { players: players, grid: grid, gridW: gridW, cell: CELL }; },
    state: function () {
      return { net: net && { role: net.role, code: net.code, seat: net.seat, guests: net.guests, inputs: net.inputs }, phase: phase, inset: inset, pickups: pickups.map(function (k) { return k.type; }), lines: segments.length, players: players.map(function (p) {
        return { name: p.name, alive: p.alive, x: Math.round(p.x), y: Math.round(p.y), speed: Math.round(speedOf(p)), fx: Object.keys(p.fx).filter(function (k) { return p.fx[k] > 0; }) };
      }) };
    },
  };

  if (window.ResizeObserver) new ResizeObserver(fit).observe(stage); else window.addEventListener('resize', fit);
  // Turning the phone sideways mid-game brings the game back into view.
  var onTurn = function () { if (phase !== 'menu' && phase !== 'lobby') setTimeout(bringIntoView, 300); };
  if (shortLandscape.addEventListener) shortLandscape.addEventListener('change', onTurn);
  fit();
  showMute();
  var invite = location.search.match(/[?&]room=([A-Za-z0-9]{5})(?:&|$)/);
  if (invite && RELAY) joinOnline(invite[1].toUpperCase()); else showMenu();
  requestAnimationFrame(frame);
})();
