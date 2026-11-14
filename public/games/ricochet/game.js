// Ricochet: tanks in a maze, and every shot bounces off the walls, including back at you.
// The maze is rebuilt every round. Play against computer tanks, with two players on one keyboard, or
// online with friends. Like Trails and Knockout, the simulation runs on a fixed arena with a fixed
// timestep. Online, the browser that creates the game (the host) runs it and sends the state through
// the SRATH relay (see /relay in the website repository); the others only send their controls.
(function () {
  'use strict';

  var root = document.getElementById('ricochet');
  if (!root) return;

  // Arena and rules, in arena units (the canvas is scaled to fit).
  var W = 1000, H = 680;
  var STEP = 1 / 120;             // simulation timestep, seconds
  var TANK_R = 13;                // a tank's size for collisions
  var SPEED = 140;                // driving speed, units per second (reverse is slower)
  var REVERSE = 0.65;
  var TURN = 3.4;                 // radians per second
  var SHOT_SPEED = 250;
  var SHOT_R = 3.5;
  var SHOT_LIFE = 7;              // seconds a shot keeps bouncing
  var MAX_SHOTS = 5;              // shots a tank can have in play at once
  var FIRE_GAP = 0.18;            // seconds between shots
  var SELF_GRACE = 0.15;          // your own fresh shot can't hit you
  var WALL = 6;                   // wall thickness
  var END_DELAY = 1.4;            // shots keep flying this long after the last-but-one tank is hit
  var SETUP_KEY = 'ricochet:setup';

  var COLORS = [
    { name: 'Teal', hex: '#2dd4bf' }, { name: 'Indigo', hex: '#818cf8' }, { name: 'Amber', hex: '#fbbf24' },
    { name: 'Pink', hex: '#f472b6' }, { name: 'Sky', hex: '#38bdf8' }, { name: 'Lime', hex: '#a3e635' },
  ];

  // Mazes: a new one is built every round. loops: share of extra walls removed, so there are several ways round.
  var MAZES = {
    classic: { label: 'Maze', desc: 'Winding corridors', cols: 10, rows: 7, loops: 0.14 },
    open: { label: 'Open halls', desc: 'Few walls, long shots', cols: 8, rows: 5, loops: 0.5 },
    tight: { label: 'Tight corridors', desc: 'Close quarters', cols: 13, rows: 9, loops: 0.1 },
    pillars: { label: 'Pillars', desc: 'Short walls to bank shots off', cols: 9, rows: 6, loops: 0.75 },
  };

  // Power-ups. kind: 'self' helps whoever takes it, 'others' hits everyone else, 'arena' changes the maze.
  var POWERUPS = {
    laser: { kind: 'self', label: 'Laser sight', glyph: '⌖', desc: 'see where your shots will bounce' },
    split: { kind: 'self', label: 'Splitter', glyph: '⋔', desc: 'your next shot splits in three at its first bounce' },
    shield: { kind: 'self', label: 'Shield', glyph: '◈', desc: 'survive one hit' },
    phase: { kind: 'self', label: 'Phase', glyph: '⇥', desc: 'your next three shots pass through one wall' },
    jam: { kind: 'others', label: 'Jam', glyph: '⊘', desc: 'nobody else can fire for a moment' },
    collapse: { kind: 'arena', label: 'Collapse', glyph: '✕', desc: 'knocks a few walls down' },
  };
  var KIND_COLORS = { self: '#2dd4bf', others: '#fb7185', arena: '#fbbf24' };
  var LASER_TIME = 10, SHIELD_TIME = 15, JAM_TIME = 3;
  var CRATE = 11, CRATE_EVERY = [4, 8], CRATE_MAX = 2, CRATE_LIFE = 14;

  // Online play. On this machine during development, a local relay (npm run dev in /relay) is used.
  var RELAY = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) ? 'ws://127.0.0.1:8787' : (root.dataset.relay || '');
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var SEND_EVERY = 0.04;          // the host sends the game state 25 times a second
  var INPUT_EVERY = 1 / 30;       // a guest sends controls at most this often
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
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function angleDiff(a, b) { var d = b - a; return Math.atan2(Math.sin(d), Math.cos(d)); }

  // Tiny synthesized sounds, only after the visitor has interacted with the page.
  var audio = null, muted = load('ricochet:muted', false), lastTick = 0;
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
  root.classList.add('ri');
  var hud = el('div', 'ri-hud');
  var board = el('div', 'ri-scores');
  board.setAttribute('aria-label', 'Scores');
  var tools = el('div', 'ri-tools');
  var fullBtn = el('button', 'ri-btn', 'Full screen');
  var pauseBtn = el('button', 'ri-btn', 'Pause');
  var muteBtn = el('button', 'ri-btn');
  fullBtn.type = pauseBtn.type = muteBtn.type = 'button';
  tools.append(fullBtn, pauseBtn, muteBtn);
  hud.append(board, tools);

  var stage = el('div', 'ri-stage');
  stage.tabIndex = 0;
  var canvas = el('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Ricochet arena');
  var overlay = el('div', 'ri-overlay');
  stage.append(canvas, overlay);
  var help = el('p', 'ri-help');
  var live = el('p', 'sr-only');
  live.setAttribute('aria-live', 'polite');
  root.append(hud, stage, help, live);

  var ctx = canvas.getContext('2d');
  var scale = 1, dpr = 1;

  // ---------------------------------------------------------------------------
  // Game state

  var setup = load(SETUP_KEY, { mode: 'solo', bots: 2, mazes: true, powerups: true });
  if (setup.mazes === undefined) setup.mazes = true;
  if (setup.powerups === undefined) setup.powerups = true;
  if (setup.onlineBots === undefined) setup.onlineBots = 0;
  if (setup.mode === 'online' && !RELAY) setup.mode = 'solo';
  var net = null;                  // the online connection, or null when playing offline
  // Online name and colour, remembered in this browser (starting from the other games' ones, if any).
  var profile = load('ricochet:profile', null) || load('knockout:profile', null) || load('trails:profile', { name: '', color: -1 });
  function cleanName(t) {
    return String(t || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/\s+/g, ' ').trim().slice(0, 12);
  }
  var players = [];
  var shots = [];
  var crates = [], nextCrate = 0;
  var particles = [];
  var maze = null, mazeKind = 'classic', lastMaze = 'classic';
  var phase = 'menu';              // menu | ready | playing | roundover | matchover | paused
  var pausedFrom = null;
  var readyTime = 0, roundOverTime = 0, roundTime = 0, endTimer = 0, target = 5, round = 0, accumulator = 0;
  var roundMessage = '', roundColor = '';
  var shake = 0, wallFlash = 0;
  var keys = {};
  var touch = { x: 0, y: 0, fire: false, joy: null };

  // A player's id is their colour (an index into COLORS). Online, each human also has a seat (0 = host).
  function isMe(p) { return net ? !p.bot && p.seat === net.seat : setup.mode === 'solo' && p.id === 0; }
  function isHost() { return !!net && net.role === 'host'; }
  function isGuest() { return !!net && net.role === 'guest'; }
  function who(p) { return isMe(p) ? 'You' : p.name; }
  function humans() { return players.filter(function (p) { return !p.bot; }); }
  function fx(p, name) { return (p.fx[name] || 0) > 0; }

  // ---------------------------------------------------------------------------
  // The maze
  //
  // A grid of cells with a wall on each side. A depth-first walk knocks walls down to make a maze
  // where every cell can be reached, then some extra walls go so there are loops to shoot round.
  // Walls become thin rectangles; each cell keeps a list of the rectangles near it for fast tests.

  function buildMaze(kind) {
    var spec = MAZES[kind];
    var cols = spec.cols, rows = spec.rows, M = 14;
    var S = Math.min((W - 2 * M) / cols, (H - 2 * M) / rows);
    var m = { cols: cols, rows: rows, S: S, ox: (W - cols * S) / 2, oy: (H - rows * S) / 2, h: [], v: [] };
    for (var r = 0; r <= rows; r++) { m.h.push([]); m.v.push([]); for (var c = 0; c <= cols; c++) { m.h[r].push(true); m.v[r].push(true); } }

    var seen = [], stack = [[Math.floor(Math.random() * cols), Math.floor(Math.random() * rows)]];
    for (r = 0; r < rows; r++) { seen.push([]); for (c = 0; c < cols; c++) seen[r].push(false); }
    seen[stack[0][1]][stack[0][0]] = true;
    while (stack.length) {
      var cur = stack[stack.length - 1], cx = cur[0], cy = cur[1];
      var next = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]].filter(function (n) {
        return n[0] >= 0 && n[1] >= 0 && n[0] < cols && n[1] < rows && !seen[n[1]][n[0]];
      });
      if (!next.length) { stack.pop(); continue; }
      var n = next[Math.floor(Math.random() * next.length)];
      openBetween(m, cx, cy, n[0], n[1]);
      seen[n[1]][n[0]] = true;
      stack.push(n);
    }
    // Extra openings for loops.
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        if (c > 0 && m.v[r][c] && Math.random() < spec.loops) m.v[r][c] = false;
        if (r > 0 && m.h[r][c] && Math.random() < spec.loops) m.h[r][c] = false;
      }
    }
    rebuildWalls(m);
    return m;
  }

  // The maze travels to guests as two strings of 0s and 1s (horizontal and vertical walls).
  function encodeMaze() {
    var enc = function (g) { return g.map(function (row) { return row.map(function (b) { return b ? 1 : 0; }).join(''); }).join('|'); };
    return [enc(maze.h), enc(maze.v)];
  }
  function decodeMaze(kind, data) {
    var spec = MAZES[kind] || MAZES.classic, cols = spec.cols, rows = spec.rows, M = 14;
    var S = Math.min((W - 2 * M) / cols, (H - 2 * M) / rows);
    var dec = function (str) { return str.split('|').map(function (row) { return row.split('').map(function (c) { return c === '1'; }); }); };
    var m = { cols: cols, rows: rows, S: S, ox: (W - cols * S) / 2, oy: (H - rows * S) / 2, h: dec(data[0]), v: dec(data[1]) };
    rebuildWalls(m);
    return m;
  }

  function openBetween(m, ax, ay, bx, by) {
    if (bx === ax + 1) m.v[ay][bx] = false;
    else if (bx === ax - 1) m.v[ay][ax] = false;
    else if (by === ay + 1) m.h[by][ax] = false;
    else if (by === ay - 1) m.h[ay][ax] = false;
  }

  // Merge wall pieces into rectangles and index them by cell.
  function rebuildWalls(m) {
    var rects = [], T = WALL, S = m.S, r, c, start;
    for (r = 0; r <= m.rows; r++) {
      start = -1;
      for (c = 0; c <= m.cols; c++) {
        var on = c < m.cols && m.h[r][c];
        if (on && start < 0) start = c;
        if (!on && start >= 0) { rects.push({ x: m.ox + start * S - T / 2, y: m.oy + r * S - T / 2, w: (c - start) * S + T, h: T }); start = -1; }
      }
    }
    for (c = 0; c <= m.cols; c++) {
      start = -1;
      for (r = 0; r <= m.rows; r++) {
        var onv = r < m.rows && m.v[r][c];
        if (onv && start < 0) start = r;
        if (!onv && start >= 0) { rects.push({ x: m.ox + c * S - T / 2, y: m.oy + start * S - T / 2, w: T, h: (r - start) * S + T }); start = -1; }
      }
    }
    m.rects = rects;
    var pad = 18;
    m.index = [];
    for (r = 0; r < m.rows; r++) {
      m.index.push([]);
      for (c = 0; c < m.cols; c++) {
        var x0 = m.ox + c * S - pad, y0 = m.oy + r * S - pad, x1 = x0 + S + pad * 2, y1 = y0 + S + pad * 2;
        m.index[r].push(rects.filter(function (q) { return q.x < x1 && q.x + q.w > x0 && q.y < y1 && q.y + q.h > y0; }));
      }
    }
  }

  function cellAt(x, y) {
    var c = Math.floor((x - maze.ox) / maze.S), r = Math.floor((y - maze.oy) / maze.S);
    return { c: Math.max(0, Math.min(maze.cols - 1, c)), r: Math.max(0, Math.min(maze.rows - 1, r)) };
  }
  function cellCenter(c, r) { return { x: maze.ox + (c + 0.5) * maze.S, y: maze.oy + (r + 0.5) * maze.S }; }
  function inside(x, y) { return x > maze.ox && y > maze.oy && x < maze.ox + maze.cols * maze.S && y < maze.oy + maze.rows * maze.S; }

  // Does a circle at (x, y) touch a wall?
  function hitsWall(x, y, rad) {
    if (!inside(x, y)) return true;
    var cell = cellAt(x, y), list = maze.index[cell.r][cell.c];
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      var nx = Math.max(q.x, Math.min(x, q.x + q.w)), ny = Math.max(q.y, Math.min(y, q.y + q.h));
      if ((x - nx) * (x - nx) + (y - ny) * (y - ny) < rad * rad) return true;
    }
    return false;
  }

  // Shortest route between two cells (breadth-first search), as a list of cells.
  function route(from, to) {
    var key = function (c, r) { return r * maze.cols + c; };
    var prev = {}, queue = [from], start = key(from.c, from.r), goal = key(to.c, to.r);
    prev[start] = -1;
    while (queue.length) {
      var cur = queue.shift(), k = key(cur.c, cur.r);
      if (k === goal) break;
      var c = cur.c, r = cur.r, ways = [];
      if (c + 1 < maze.cols && !maze.v[r][c + 1]) ways.push({ c: c + 1, r: r });
      if (c > 0 && !maze.v[r][c]) ways.push({ c: c - 1, r: r });
      if (r + 1 < maze.rows && !maze.h[r + 1][c]) ways.push({ c: c, r: r + 1 });
      if (r > 0 && !maze.h[r][c]) ways.push({ c: c, r: r - 1 });
      ways.forEach(function (w) { var wk = key(w.c, w.r); if (!(wk in prev)) { prev[wk] = k; queue.push(w); } });
    }
    if (!(goal in prev)) return null;
    var path = [];
    for (var at = goal; at !== -1; at = prev[at]) path.unshift({ c: at % maze.cols, r: Math.floor(at / maze.cols) });
    return path;
  }

  // Follow a shot's path with bounces. visit(x, y, t) returns true to stop early.
  function trace(x, y, a, maxT, dt, visit) {
    var vx = Math.cos(a) * SHOT_SPEED, vy = Math.sin(a) * SHOT_SPEED;
    for (var t = dt; t <= maxT; t += dt) {
      var nx = x + vx * dt;
      if (hitsWall(nx, y, SHOT_R)) vx = -vx; else x = nx;
      var ny = y + vy * dt;
      if (hitsWall(x, ny, SHOT_R)) vy = -vy; else y = ny;
      if (visit(x, y, t)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Matches and rounds

  function makePlayers() {
    var list = [];
    if (net) {
      [0].concat(net.guests).filter(function (x) { return net.members[x]; }).forEach(function (x) {
        var m = net.members[x];
        list.push({ id: m.ci, seat: x, bot: false, name: memberName(m), score: 0, kills: 0 });
      });
      var used = list.map(function (q) { return q.id; });
      var free = COLORS.map(function (c, i) { return i; }).filter(function (i) { return used.indexOf(i) === -1; });
      for (var nb = 0; nb < setup.onlineBots && free.length; nb++) {
        var bid = free.shift();
        list.push({ id: bid, bot: true, name: COLORS[bid].name, score: 0, kills: 0 });
      }
      list.sort(function (a, b) { return a.id - b.id; });
      list.forEach(function (q) { q.color = COLORS[q.id].hex; q.skill = q.bot ? rand(0.75, 1) : 1; });
      return list;
    }
    var count = setup.mode === 'duo' ? 2 : 1;
    for (var i = 0; i < count; i++) list.push({ id: i, bot: false, name: count === 1 ? 'You' : 'Player ' + (i + 1), score: 0, kills: 0 });
    for (var b = 0; b < setup.bots; b++) list.push({ id: list.length, bot: true, name: COLORS[list.length].name, score: 0, kills: 0 });
    list.forEach(function (p) { p.color = COLORS[p.id].hex; p.skill = p.bot ? rand(0.75, 1) : 1; });
    return list;
  }

  function startMatch() {
    players = makePlayers();
    target = players.length <= 2 ? 5 : 4;
    round = 0;
    if (isHost()) netSend({ t: 'match', target: target, pl: players.map(function (q) { return [q.id, q.bot ? 1 : 0, q.bot ? -1 : q.seat, q.bot ? '' : q.name]; }) });
    startRound();
  }

  function startRound() {
    round++;
    if (round === 1 || !setup.mazes) mazeKind = 'classic';
    else {
      var kinds = Object.keys(MAZES).filter(function (k) { return k !== lastMaze; });
      mazeKind = kinds[Math.floor(Math.random() * kinds.length)];
    }
    lastMaze = mazeKind;
    maze = buildMaze(mazeKind);
    shots = [];
    crates = [];
    particles = [];
    nextCrate = rand(3, 5);
    roundTime = 0;
    endTimer = 0;
    accumulator = 0;
    shake = wallFlash = 0;

    // Start in cells far apart from each other.
    var taken = [];
    players.forEach(function (p) {
      var best = null, bestD = -1;
      for (var tries = 0; tries < 60; tries++) {
        var c = Math.floor(Math.random() * maze.cols), r = Math.floor(Math.random() * maze.rows);
        var d = taken.length ? Math.min.apply(null, taken.map(function (t) { return Math.hypot(t.c - c, t.r - r); })) : 99;
        if (d > bestD) { bestD = d; best = { c: c, r: r }; }
      }
      taken.push(best);
      var at = cellCenter(best.c, best.r);
      p.x = at.x; p.y = at.y;
      p.angle = Math.floor(Math.random() * 4) * Math.PI / 2;
      p.alive = !p.left;   // an online player who left stays out
      p.fx = {};
      p.vx = p.vy = p.spin = 0;
      p.split = 0;
      p.phase = 0;
      p.cool = 0;
      p.fireHeld = false;
      p.think = 0;
      p.plan = { turn: 0, move: 0, fire: false };
      p.stuck = 0;
    });
    phase = 'ready';
    readyTime = 2.1;
    overlay.hidden = true;
    live.textContent = 'Round ' + round + ': ' + MAZES[mazeKind].label + '.';
    renderScores();
    stage.focus({ preventScroll: true });
    bringIntoView();
    if (isHost()) {
      net.events = [];
      netSend({ t: 'round', n: round, target: target, kind: mazeKind, mz: encodeMaze() });
      sendState();
    }
  }

  // ---------------------------------------------------------------------------
  // Controls: { turn: -1..1, move: -1..1, fire } or, for the touch joystick, { aim, thrust, fire }.

  function control(p) {
    if (p.bot) return botControl(p);
    if (net) {
      if (p.seat === net.seat) return localControl(true, 0);
      var inp = net.inputs[p.seat];
      if (!inp) return { turn: 0, move: 0, fire: false };
      var shoot = inp.fires > 0;
      if (shoot) inp.fires--;   // each press a guest makes fires exactly once
      return inp.aim != null ? { aim: inp.aim, thrust: inp.thrust, fire: shoot } : { turn: inp.turn, move: inp.move, fire: shoot };
    }
    return localControl(setup.mode === 'solo', p.id);
  }

  // Keys and touch at this device. single: one player uses every key; otherwise player 0 has the
  // arrows and Enter, player 1 has WASD and Space.
  function localControl(single, id) {
    var turn = 0, move = 0, fire = false;
    var solo = single, p = { id: id };
    if (solo || p.id === 0) {
      turn += (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
      move += (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0);
      fire = fire || keys.Enter || keys.NumpadEnter || keys.ShiftRight || keys.Slash;
    }
    if (solo || p.id === 1) {
      turn += (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
      move += (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
      fire = fire || keys.Space || keys.KeyQ || keys.ShiftLeft;
    }
    if (solo && (touch.x || touch.y)) {
      return { aim: Math.atan2(touch.y, touch.x), thrust: Math.min(1, Math.hypot(touch.x, touch.y)), fire: fire || touch.fire };
    }
    if (solo) fire = fire || touch.fire;
    return { turn: Math.max(-1, Math.min(1, turn)), move: Math.max(-1, Math.min(1, move)), fire: fire };
  }

  // Computer tanks: dodge shots coming their way, fire when a bounce path reaches someone, turn to
  // find such a path, and otherwise drive towards the nearest tank (or a crate) through the maze.
  function botControl(p) {
    p.think -= STEP;
    if (p.think > 0) return p.plan;
    p.think = rand(0.08, 0.14);
    var enemies = players.filter(function (q) { return q !== p && q.alive; });
    if (!enemies.length) { p.plan = { turn: 0, move: 0, fire: false }; return p.plan; }

    // 1. Dodge.
    var threat = null;
    shots.forEach(function (s) {
      if (threat || (s.owner === p && s.age < 0.4)) return;
      trace(s.x, s.y, Math.atan2(s.vy, s.vx), 0.7, 1 / 60, function (x, y, t) {
        if (Math.hypot(x - p.x, y - p.y) < TANK_R + 12) { threat = { x: x, y: y, t: t }; return true; }
        return false;
      });
    });
    if (threat && Math.random() < 0.85 * p.skill) {
      var best = null, bestD = -1;
      [1, -1].forEach(function (mv) {
        [-1, 0, 1].forEach(function (tn) {
          var a = p.angle + tn * TURN * threat.t * 0.5;
          var sp = mv > 0 ? SPEED : SPEED * REVERSE;
          var x = p.x + Math.cos(a) * sp * mv * threat.t, y = p.y + Math.sin(a) * sp * mv * threat.t;
          var d = hitsWall(x, y, TANK_R) ? 0 : Math.hypot(x - threat.x, y - threat.y);
          if (d > bestD) { bestD = d; best = { turn: tn, move: mv }; }
        });
      });
      p.plan = { turn: best.turn, move: best.move, fire: false };
      return p.plan;
    }

    // 2. Fire, or turn towards an angle that hits.
    var hitAt = function (a) {
      var result = 0;
      trace(p.x + Math.cos(a) * (TANK_R + 5), p.y + Math.sin(a) * (TANK_R + 5), a, 2.2, 1 / 60, function (x, y, t) {
        if (t > 0.3 && Math.hypot(x - p.x, y - p.y) < TANK_R + 6) { result = -1; return true; }
        for (var i = 0; i < enemies.length; i++) {
          if (Math.hypot(x - enemies[i].x, y - enemies[i].y) < TANK_R * (fx(p, 'laser') ? 1.1 : 0.9)) { result = 1; return true; }
        }
        return false;
      });
      return result;
    };
    var canFire = p.cool <= 0 && !fx(p, 'jam') && shots.filter(function (s) { return s.owner === p; }).length < MAX_SHOTS;
    if (canFire && hitAt(p.angle) === 1 && Math.random() < 0.75 * p.skill) {
      p.plan = { turn: 0, move: 0, fire: true };
      return p.plan;
    }
    if (canFire) {
      for (var k = 1; k <= 5; k++) {
        var found = 0;
        [-1, 1].some(function (sgn) {
          if (hitAt(p.angle + sgn * k * 0.13) === 1) { found = sgn; return true; }
          return false;
        });
        if (found) { p.plan = { turn: found, move: 0, fire: false }; return p.plan; }
      }
    }

    // 3. Drive: to a nearby crate when there is one, otherwise towards the nearest tank.
    var here = cellAt(p.x, p.y), goal = null, path = null;
    if (crates.length && setup.powerups) {
      crates.forEach(function (cr) {
        var r = route(here, cellAt(cr.x, cr.y));
        if (r && r.length <= 5 && (!path || r.length < path.length)) { path = r; goal = cr; }
      });
    }
    if (!path) {
      enemies.forEach(function (q) {
        var r = route(here, cellAt(q.x, q.y));
        if (r && (!path || r.length < path.length)) { path = r; goal = q; }
      });
    }
    var tx, ty;
    if (!path || path.length <= 1) { tx = goal ? goal.x : p.x; ty = goal ? goal.y : p.y; }
    else { var nc = cellCenter(path[1].c, path[1].r); tx = nc.x; ty = nc.y; }
    var diff = angleDiff(p.angle, Math.atan2(ty - p.y, tx - p.x));
    var close = goal && goal.alive !== undefined && path && path.length <= 2;
    var move = Math.abs(diff) < 0.35 ? 1 : Math.abs(diff) < 1.1 ? 0.35 : 0;
    if (close) move = Math.min(move, 0.3);    // don't drive into point-blank range
    // Unstick: if driving but not getting anywhere, back up and turn for a moment.
    if (p.stuck > 0.6) { p.stuck = -0.4; }
    if (p.stuck < 0) { p.plan = { turn: 1, move: -1, fire: false }; return p.plan; }
    p.plan = { turn: Math.abs(diff) < 0.06 ? 0 : diff > 0 ? 1 : -1, move: move, fire: false };
    return p.plan;
  }

  // ---------------------------------------------------------------------------
  // Simulation

  function stepTank(p) {
    if (!p.alive) return;
    var c = control(p);
    var turn = c.turn || 0, move = c.move || 0;
    if (c.aim != null) {
      var d = angleDiff(p.angle, c.aim);
      turn = Math.abs(d) < 0.05 ? 0 : Math.max(-1, Math.min(1, d * 4));
      move = Math.abs(d) < 1.0 ? c.thrust : 0;
    }
    p.angle += turn * TURN * STEP;
    var sp = (move >= 0 ? SPEED : SPEED * REVERSE) * move;
    var dx = Math.cos(p.angle) * sp * STEP, dy = Math.sin(p.angle) * sp * STEP;
    var ox = p.x, oy = p.y;
    if (!hitsWall(p.x + dx, p.y, TANK_R)) p.x += dx;
    if (!hitsWall(p.x, p.y + dy, TANK_R)) p.y += dy;
    p.vx = (p.x - ox) / STEP; p.vy = (p.y - oy) / STEP; p.spin = turn * TURN;   // for guests to move tanks between updates
    if (p.bot) {
      var moved = Math.hypot(p.x - ox, p.y - oy);
      if (p.stuck < 0) p.stuck += STEP;
      else if (Math.abs(move) > 0.3 && moved < Math.abs(sp) * STEP * 0.3) p.stuck += STEP;
      else p.stuck = Math.max(0, p.stuck - STEP);
    }

    p.cool -= STEP;
    Object.keys(p.fx).forEach(function (k) { if (p.fx[k] > 0) p.fx[k] -= STEP; });
    if (c.fire && !p.fireHeld) fire(p);
    p.fireHeld = !!c.fire;

    for (var i = 0; i < crates.length; i++) {
      if (Math.hypot(crates[i].x - p.x, crates[i].y - p.y) < TANK_R + CRATE) {
        var k = crates.splice(i, 1)[0];
        apply(k.type, p);
        break;
      }
    }
  }

  function fire(p) {
    if (p.cool > 0 || fx(p, 'jam')) return;
    if (shots.filter(function (s) { return s.owner === p; }).length >= MAX_SHOTS) { tone(160, 0.05, 'square', 0.02); return; }
    var ax = Math.cos(p.angle), ay = Math.sin(p.angle);
    // Start at the end of the barrel, or closer in if the barrel is against a wall.
    var dist = TANK_R + 5;
    while (dist > 0 && hitsWall(p.x + ax * dist, p.y + ay * dist, SHOT_R)) dist -= 1;
    var s = { x: p.x + ax * dist, y: p.y + ay * dist, vx: ax * SHOT_SPEED, vy: ay * SHOT_SPEED, owner: p, age: 0, bounces: 0, split: false, phase: 0, inWall: false };
    if (p.split > 0) { s.split = true; p.split--; }
    if (p.phase > 0) { s.phase = 1; p.phase--; }
    shots.push(s);
    p.cool = FIRE_GAP;
    emit(['f', r1(s.x), r1(s.y), r2(ax), r2(ay)]);
    fireEffect(s.x, s.y, ax, ay);
  }

  // What everyone sees and hears; guests replay these from the host's events.
  function fireEffect(x, y, ax, ay) {
    particles.push({ x: x, y: y, vx: ax * 60, vy: ay * 60, life: 0.15, color: '#fff' });
    tone(520, 0.06, 'square', 0.03, 260);
  }
  function shieldEffect(p) {
    particles.push({ ring: true, x: p.x, y: p.y, r: TANK_R + 6, life: 0.4, color: KIND_COLORS.self });
    tone(900, 0.12, 'triangle', 0.06, 400);
  }
  function bounceTick() {
    if (roundTime - lastTick > 0.04) { tone(1400, 0.025, 'sine', 0.012); lastTick = roundTime; }
  }

  function stepShot(s) {
    s.age += STEP;
    var bounced = false;
    var nx = s.x + s.vx * STEP;
    if (hitsWall(nx, s.y, SHOT_R)) { if (s.phase > 0) { s.x = nx; s.inWall = true; } else { s.vx = -s.vx; bounced = true; } } else s.x = nx;
    var ny = s.y + s.vy * STEP;
    if (hitsWall(s.x, ny, SHOT_R)) { if (s.phase > 0) { s.y = ny; s.inWall = true; } else { s.vy = -s.vy; bounced = true; } } else s.y = ny;
    if (s.inWall && !hitsWall(s.x, s.y, SHOT_R)) { s.inWall = false; s.phase = 0; }
    if (!inside(s.x, s.y)) { s.age = SHOT_LIFE; return; }   // a phase shot that left the maze
    if (bounced) {
      s.bounces++;
      bounceTick();
      if (s.split) {
        s.split = false;
        var a = Math.atan2(s.vy, s.vx);
        [-0.32, 0.32].forEach(function (o) {
          shots.push({ x: s.x, y: s.y, vx: Math.cos(a + o) * SHOT_SPEED, vy: Math.sin(a + o) * SHOT_SPEED, owner: s.owner, age: s.age, bounces: s.bounces, split: false, phase: 0, inWall: false, extra: true });
        });
      }
    }
    // Hits.
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (!p.alive || (p === s.owner && s.age < SELF_GRACE)) continue;
      if (Math.hypot(p.x - s.x, p.y - s.y) < TANK_R + SHOT_R) {
        s.age = SHOT_LIFE;
        if (fx(p, 'shield')) {
          p.fx.shield = 0;
          emit(['sh', p.id]);
          shieldEffect(p);
        } else {
          destroy(p, s.owner);
        }
        return;
      }
    }
  }

  function destroy(p, by) {
    p.alive = false;
    if (by && by !== p) by.kills++;
    emit(['x', p.id, by ? by.id : -1]);
    destroyEffect(p, by);
    renderScores();
  }

  function destroyEffect(p, by) {
    for (var i = 0; i < 34; i++) {
      var a = Math.random() * Math.PI * 2, sp = rand(40, 300);
      particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.3, 0.9), color: i % 3 ? p.color : '#fbbf24' });
    }
    particles.push({ ring: true, x: p.x, y: p.y, r: 6, life: 0.5, color: p.color });
    var text = !by ? who(p) + ' left' : by === p ? who(p) + (isMe(p) ? ' hit yourself' : ' hit itself') : who(by) + ' ✕ ' + who(p);
    particles.push({ text: text, x: p.x, y: p.y - 24, vx: 0, vy: -24, life: 1.5, color: !by || by === p ? '#9aa3b5' : by.color });
    live.textContent = text + '.';
    shake = 8;
    tone(110, 0.45, 'sawtooth', 0.08, 40);
    renderScores();
  }

  // ---------------------------------------------------------------------------
  // Power-ups

  function spawnCrate() {
    var names = Object.keys(POWERUPS);
    for (var tries = 0; tries < 30; tries++) {
      var c = Math.floor(Math.random() * maze.cols), r = Math.floor(Math.random() * maze.rows);
      var at = cellCenter(c, r);
      if (players.some(function (p) { return p.alive && Math.hypot(p.x - at.x, p.y - at.y) < maze.S * 1.5; })) continue;
      if (crates.some(function (k) { return Math.hypot(k.x - at.x, k.y - at.y) < maze.S; })) continue;
      crates.push({ type: names[Math.floor(Math.random() * names.length)], x: at.x, y: at.y, age: 0 });
      return;
    }
  }

  function apply(type, p) {
    var pu = POWERUPS[type];
    if (type === 'laser') p.fx.laser = LASER_TIME;
    else if (type === 'shield') p.fx.shield = SHIELD_TIME;
    else if (type === 'split') p.split = Math.min(2, p.split + 1);
    else if (type === 'phase') p.phase = Math.min(6, p.phase + 3);
    else if (type === 'jam') players.forEach(function (q) { if (q !== p && q.alive) q.fx.jam = JAM_TIME; });
    else if (type === 'collapse') collapse();
    emit(['pu', type, p.id]);
    pickupEffect(type, p);
  }

  function pickupEffect(type, p) {
    var pu = POWERUPS[type];
    particles.push({ text: pu.label, x: p.x, y: p.y - 26, vx: 0, vy: -28, life: 1.1, color: KIND_COLORS[pu.kind] });
    if (isMe(p) || (!net && !p.bot)) live.textContent = pu.label + '.';
    tone(pu.kind === 'self' ? 880 : pu.kind === 'others' ? 330 : 240, 0.2, 'triangle', 0.07, pu.kind === 'self' ? 1320 : pu.kind === 'arena' ? 80 : null);
  }

  // Knock down some inner walls (never the outer ones).
  function collapse() {
    var pieces = [];
    for (var r = 0; r < maze.rows; r++) {
      for (var c = 0; c < maze.cols; c++) {
        if (c > 0 && maze.v[r][c]) pieces.push(['v', r, c]);
        if (r > 0 && maze.h[r][c]) pieces.push(['h', r, c]);
      }
    }
    pieces.sort(function () { return Math.random() - 0.5; }).slice(0, Math.min(10, Math.ceil(pieces.length * 0.25))).forEach(function (w) {
      maze[w[0]][w[1]][w[2]] = false;
      var x = w[0] === 'v' ? maze.ox + w[2] * maze.S : maze.ox + (w[2] + 0.5) * maze.S;
      var y = w[0] === 'v' ? maze.oy + (w[1] + 0.5) * maze.S : maze.oy + w[1] * maze.S;
      for (var i = 0; i < 6; i++) particles.push({ x: x + rand(-maze.S / 3, maze.S / 3) * (w[0] === 'h'), y: y + rand(-maze.S / 3, maze.S / 3) * (w[0] === 'v'), vx: rand(-60, 60), vy: rand(-60, 60), life: rand(0.3, 0.7), color: '#64748b' });
    });
    rebuildWalls(maze);
    emit(['c', encodeMaze()]);
    wallFlash = 1;
    shake = Math.max(shake, 6);
  }

  // ---------------------------------------------------------------------------
  // Main update

  function update(dt) {
    particles.forEach(function (q) {
      if (q.ring) q.r += 120 * dt; else { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.92; q.vy *= 0.92; }
      q.life -= dt;
    });
    particles = particles.filter(function (q) { return q.life > 0; });
    shake = Math.max(0, shake - dt * 30);
    wallFlash = Math.max(0, wallFlash - dt * 2);

    if (isGuest()) { guestUpdate(dt); return; }

    if (phase === 'ready') {
      var before = Math.ceil(readyTime / 0.7);
      readyTime -= dt;
      if (Math.ceil(readyTime / 0.7) !== before && readyTime > 0) tone(520, 0.08, 'triangle', 0.05);
      if (readyTime <= 0) { phase = 'playing'; emit(['go']); tone(880, 0.14, 'triangle', 0.07); }
      return;
    }
    if (phase === 'roundover') {
      roundOverTime -= dt;
      if (roundOverTime <= 0) {
        var lead = players.slice().sort(function (a, b) { return b.score - a.score; })[0];
        if (lead.score >= target) endMatch(lead); else startRound();
      }
      return;
    }
    if (phase !== 'playing') return;

    // When every human is out, speed up so nobody waits long for the computer tanks.
    var speed = humans().some(function (p) { return p.alive; }) ? 1 : 2.5;
    accumulator += dt * speed;
    while (accumulator >= STEP) {
      accumulator -= STEP;
      roundTime += STEP;
      if (setup.powerups) {
        nextCrate -= STEP;
        if (nextCrate <= 0) { nextCrate = rand(CRATE_EVERY[0], CRATE_EVERY[1]); if (crates.length < CRATE_MAX) spawnCrate(); }
        crates = crates.filter(function (k) { k.age += STEP; return k.age < CRATE_LIFE; });
      }
      players.forEach(stepTank);
      separateTanks();
      shots.forEach(stepShot);
      shots = shots.filter(function (s) { return s.age < SHOT_LIFE; });

      var alive = players.filter(function (p) { return p.alive; });
      if (alive.length <= 1) {
        // Shots in the air can still decide it, so wait a moment before calling the round.
        if (!endTimer) endTimer = END_DELAY;
        endTimer -= STEP;
        if (endTimer <= 0) { endRound(alive[0]); break; }
      }
    }
  }

  function separateTanks() {
    for (var i = 0; i < players.length; i++) {
      for (var k = i + 1; k < players.length; k++) {
        var a = players[i], b = players[k];
        if (!a.alive || !b.alive) continue;
        var dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d >= TANK_R * 2 || d === 0) continue;
        var push = (TANK_R * 2 - d) / 2, nx = dx / d, ny = dy / d;
        if (!hitsWall(a.x - nx * push, a.y - ny * push, TANK_R)) { a.x -= nx * push; a.y -= ny * push; }
        if (!hitsWall(b.x + nx * push, b.y + ny * push, TANK_R)) { b.x += nx * push; b.y += ny * push; }
      }
    }
  }

  function endRound(winner) {
    phase = 'roundover';
    roundOverTime = 2;
    accumulator = 0;
    if (winner) winner.score++;
    emit(['ro', winner ? winner.id : -1]);
    roundEnded(winner);
  }

  function roundEnded(winner) {
    roundMessage = winner ? who(winner) + (isMe(winner) ? ' win the round' : ' wins the round') : 'Nobody survives';
    roundColor = winner ? winner.color : '#9aa3b5';
    live.textContent = roundMessage + '.';
    if (winner && !winner.bot && (!net || isMe(winner))) tone(784, 0.25, 'triangle', 0.08, 1046);
    renderScores();
  }

  function endMatch(winner) {
    phase = 'matchover';
    if (isHost()) {
      sendState();
      netSend({ t: 'over', w: winner.id, sc: players.map(function (q) { return [q.score, q.kills]; }) });
    }
    var you = net ? isMe(winner) : !winner.bot;
    var buttons = isHost() ? [['Play again', startMatch], ['Back to lobby', showLobby]]
      : isGuest() ? [['Leave game', leaveOnline]]
      : [['Play again', startMatch], ['Change setup', showMenu]];
    tone(you ? 523 : 220, 0.5, 'triangle', 0.09, you ? 1046 : 110);
    showOverlay(
      who(winner) === 'You' ? 'You win!' : who(winner) + ' wins',
      '<ol class="ri-final">' + players.slice().sort(function (a, b) { return b.score - a.score || b.kills - a.kills; }).map(function (p) {
        return '<li><span class="ri-dot" style="background:' + p.color + '"></span>' + esc(who(p)) +
          (p.left ? ' (left)' : '') + '<span class="ri-kills">' + p.kills + (p.kills === 1 ? ' hit' : ' hits') + '</span><strong>' + p.score + '</strong></li>';
      }).join('') + '</ol>' + (isGuest() ? '<p>Waiting for the host to start the next game.</p>' : ''),
      buttons
    );
    live.textContent = who(winner) + ' won the match.';
  }

  // ---------------------------------------------------------------------------
  // Drawing

  function draw(time) {
    var cw = canvas.width, ch = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    var sx = shake ? rand(-shake, shake) : 0, sy = shake ? rand(-shake, shake) : 0;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, sx * scale * dpr, sy * scale * dpr);

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1 / (scale * dpr);
    ctx.beginPath();
    for (var gx = 40; gx < W; gx += 40) { ctx.moveTo(gx, 0); ctx.lineTo(gx, H); }
    for (var gy = 40; gy < H; gy += 40) { ctx.moveTo(0, gy); ctx.lineTo(W, gy); }
    ctx.stroke();

    if (!maze) maze = buildMaze('classic');
    // Floor and walls.
    ctx.fillStyle = 'rgba(18, 23, 34, 0.75)';
    ctx.fillRect(maze.ox, maze.oy, maze.cols * maze.S, maze.rows * maze.S);
    ctx.shadowColor = '#2dd4bf';
    ctx.shadowBlur = 10 + wallFlash * 20;
    ctx.fillStyle = wallFlash ? 'rgba(' + Math.round(94 + 140 * wallFlash) + ', 234, 212, 0.9)' : '#5eead4';
    ctx.globalAlpha = 0.85;
    maze.rects.forEach(function (q) { ctx.fillRect(q.x, q.y, q.w, q.h); });
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    crates.forEach(function (k) { drawCrate(k, time); });

    // Laser sights.
    players.forEach(function (p) {
      if (!p.alive || !fx(p, 'laser') || phase !== 'playing') return;
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      var a = p.angle, sx0 = p.x + Math.cos(a) * (TANK_R + 5), sy0 = p.y + Math.sin(a) * (TANK_R + 5);
      ctx.moveTo(sx0, sy0);
      var lastX = sx0, lastY = sy0, n = 0;
      trace(sx0, sy0, a, 1.6, STEP * 2, function (x, y) { if (++n % 4 === 0) ctx.lineTo(x, y); lastX = x; lastY = y; return false; });
      ctx.lineTo(lastX, lastY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    });

    players.forEach(function (p) { if (p.alive && p.x != null) drawTank(p, time); });

    // Shots: a bright core with a short streak and the shooter's colour as glow.
    shots.forEach(function (s) {
      if (s.age > SHOT_LIFE - 1 && Math.floor(time * 10) % 2) return;
      var owner = s.owner || { color: '#f8fafc' };
      ctx.strokeStyle = owner.color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(s.x - s.vx * 0.035, s.y - s.vy * 0.035); ctx.lineTo(s.x, s.y); ctx.stroke();
      ctx.globalAlpha = s.phase > 0 ? 0.6 : 1;
      ctx.shadowColor = owner.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath(); ctx.arc(s.x, s.y, SHOT_R, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    });

    particles.forEach(function (q) {
      ctx.globalAlpha = Math.max(0, Math.min(1, q.life * 2.2));
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

    if (touch.joy) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(touch.joy.ax, touch.joy.ay, 46, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.arc(touch.joy.ax + touch.x * 46, touch.joy.ay + touch.y * 46, 18, 0, Math.PI * 2); ctx.fill();
    }

    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.textAlign = 'center';
    if (phase === 'ready') {
      ctx.fillStyle = 'rgba(7, 9, 13, 0.6)';
      ctx.fillRect(W / 2 - 170, H / 2 - 92, 340, 160);
      ctx.fillStyle = '#e7e9ee';
      ctx.font = '800 24px system-ui, sans-serif';
      ctx.fillText(MAZES[mazeKind].label, W / 2, H / 2 - 56);
      ctx.fillStyle = '#9aa3b5';
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillText(MAZES[mazeKind].desc, W / 2, H / 2 - 34);
      ctx.fillStyle = '#e7e9ee';
      ctx.font = '800 50px system-ui, sans-serif';
      ctx.fillText(String(Math.max(1, Math.ceil(readyTime / 0.7))), W / 2, H / 2 + 22);
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillStyle = '#9aa3b5';
      ctx.fillText('Round ' + round + '  ·  first to ' + target, W / 2, H / 2 + 52);
    }
    if (phase === 'roundover') {
      ctx.fillStyle = 'rgba(7, 9, 13, 0.6)';
      ctx.fillRect(W / 2 - 220, H / 2 - 36, 440, 56);
      ctx.fillStyle = roundColor;
      ctx.font = '800 30px system-ui, sans-serif';
      ctx.fillText(roundMessage, W / 2, H / 2 + 2);
    }
  }

  function drawTank(p, time) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 12;
    // Tracks, body, turret and barrel.
    ctx.fillStyle = 'rgba(7, 9, 13, 0.85)';
    ctx.fillRect(-13, -12, 26, 5); ctx.fillRect(-13, 7, 26, 5);
    ctx.fillStyle = p.color;
    ctx.fillRect(-11, -9, 22, 18);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(7, 9, 13, 0.45)';
    ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.color;
    ctx.fillRect(2, -2.5, 16, 5);
    ctx.restore();
    if (fx(p, 'shield')) {
      ctx.strokeStyle = KIND_COLORS.self;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.6 + 0.3 * Math.sin(time * 6);
      ctx.beginPath(); ctx.arc(p.x, p.y, TANK_R + 6, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (fx(p, 'jam')) {
      ctx.strokeStyle = KIND_COLORS.others;
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, TANK_R + 10, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Special shots ready: small marks under the tank.
    var marks = [];
    for (var i = 0; i < p.split; i++) marks.push('⋔');
    if (p.phase) marks.push('⇥' + p.phase);
    if (marks.length) {
      ctx.fillStyle = KIND_COLORS.self;
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(marks.join(' '), p.x, p.y + TANK_R + 16);
    }
    if (phase === 'ready' && !p.bot) {
      ctx.fillStyle = p.color;
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(who(p), p.x, p.y - TANK_R - 12);
    }
  }

  function drawCrate(k, time) {
    var pu = POWERUPS[k.type], color = KIND_COLORS[pu.kind];
    if (k.age > CRATE_LIFE - 3 && Math.floor(time * 6) % 2) return;
    var s = CRATE * (1 + 0.06 * Math.sin(time * 4 + k.x));
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#0b0d12';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(k.x - s, k.y - s, s * 2, s * 2, 5); else ctx.rect(k.x - s, k.y - s, s * 2, s * 2);
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pu.glyph, k.x, k.y + 1);
    ctx.textBaseline = 'alphabetic';
  }

  function renderScores() {
    board.innerHTML = '';
    players.slice().sort(function (a, b) { return b.score - a.score; }).forEach(function (p) {
      var chip = el('span', 'ri-chip' + (phase === 'playing' && !p.alive ? ' is-out' : ''));
      var dot = el('span', 'ri-dot');
      dot.style.background = p.color;
      chip.append(dot, el('span', 'ri-name', who(p) + (p.left ? ' (left)' : '')), el('strong', null, String(p.score)));
      board.appendChild(chip);
    });
    if (players.length) board.appendChild(el('span', 'ri-goal', 'to ' + target));
  }

  function fit() {
    var rect = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    scale = Math.min(rect.width / W, rect.height / H);
    canvas.style.width = W * scale + 'px';
    canvas.style.height = H * scale + 'px';
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
  }

  var shortLandscape = window.matchMedia('(orientation: landscape) and (max-height: 520px)');
  function bringIntoView() {
    if (!shortLandscape.matches || root.classList.contains('is-full')) return;
    var top = root.getBoundingClientRect().top + window.scrollY - 4;
    if (Math.abs(window.scrollY - top) > 2) window.scrollTo({ top: top, behavior: 'smooth' });
  }

  // ---------------------------------------------------------------------------
  // Menus

  function showOverlay(title, html, buttons) {
    overlay.innerHTML = '';
    overlay.append(el('h2', 'ri-title', title));
    var body = el('div', 'ri-body');
    body.innerHTML = html;
    overlay.append(body);
    var row = el('div', 'ri-actions');
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
    var wrap = el('div', 'ri-choice');
    wrap.append(el('span', 'ri-choice-label', label));
    var group = el('div', 'ri-seg');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    options.forEach(function (o) {
      var b = el('button', 'ri-seg-btn', o[1]);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(o[0] === current));
      b.addEventListener('click', function (e) { e.stopPropagation(); onPick(o[0]); });
      group.appendChild(b);
    });
    wrap.append(group);
    return wrap;
  }

  function showMenu() {
    phase = 'menu';
    players = [];
    shots = [];
    crates = [];
    renderScores();
    pauseBtn.hidden = false;
    var online = setup.mode === 'online';
    var maxBots = setup.mode === 'duo' ? 4 : 5;
    var minBots = setup.mode === 'duo' ? 0 : 1;
    setup.bots = Math.max(minBots, Math.min(maxBots, setup.bots));
    showOverlay('Ricochet',
      '<p>Drive your tank through the maze and hit the others. Every shot bounces off the walls, ' +
      'so you can shoot round corners, but your own shots can come back and hit you too.</p>' +
      '<p>Last tank standing wins the round. The maze changes every round.</p>',
      [[online ? 'Create online game' : 'Play', function () { save(SETUP_KEY, setup); if (online) createOnline(); else startMatch(); }]]);
    var body = overlay.querySelector('.ri-body');
    var modes = [['solo', 'You vs computer'], ['duo', '2 players, 1 keyboard']];
    if (RELAY) modes.push(['online', 'Online']);
    body.append(choice('Players', modes, setup.mode, function (v) { setup.mode = v; showMenu(); }));
    if (online) {
      var info = el('p', 'ri-note');
      info.innerHTML = 'You get a link and a code to send to up to five friends. Your browser runs the game, so keep this tab open while you play. ' +
        'Players connect through a relay run by Cloudflare; see the <a class="text-link" href="/privacy/#online-games">privacy notice</a>.';
      body.append(info, joinByCode());
    } else {
      var botOptions = [];
      for (var n = minBots; n <= maxBots; n++) botOptions.push([n, String(n)]);
      body.append(choice('Computer tanks', botOptions, setup.bots, function (v) { setup.bots = v; showMenu(); }));
    }
    body.append(choice('Mazes', [[true, 'Mixed'], [false, 'Classic only']], setup.mazes, function (v) { setup.mazes = v; showMenu(); }));
    body.append(choice('Power-ups', [[true, 'On'], [false, 'Off']], setup.powerups, function (v) { setup.powerups = v; showMenu(); }));
    if (setup.powerups) {
      var list = el('ul', 'ri-legend');
      Object.keys(POWERUPS).forEach(function (name) {
        var pu = POWERUPS[name], item = el('li');
        var icon = el('span', 'ri-legend-icon', pu.glyph);
        icon.style.color = icon.style.borderColor = KIND_COLORS[pu.kind];
        var text = el('span');
        text.append(el('strong', null, pu.label), document.createTextNode(' ' + pu.desc));
        item.append(icon, text);
        list.append(item);
      });
      body.append(list);
    }
    help.innerHTML = setup.mode === 'duo'
      ? '<span class="ri-dot" style="background:' + COLORS[0].hex + '"></span>Player 1: <kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> drive, <kbd>Enter</kbd> fire &nbsp; ' +
        '<span class="ri-dot" style="background:' + COLORS[1].hex + '"></span>Player 2: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive, <kbd>Space</kbd> fire'
      : 'Drive with the arrow keys or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> (up drives forward, left and right turn), fire with <kbd>Space</kbd>. On a touch screen: drag on the left half to steer, tap the right half to fire';
    help.innerHTML += ' &nbsp; · &nbsp; <kbd>Esc</kbd> pause &nbsp; · &nbsp; <kbd>F</kbd> full screen';
    if (window.matchMedia('(pointer: coarse) and (orientation: portrait)').matches) {
      help.innerHTML = 'Drag on the left half to steer, tap the right half to fire. Turn your phone sideways for a bigger arena.';
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
  // Messages (JSON). Host -> guests: lobby, match, round (with the maze), s (state), paused, over, busy.
  // Guest -> host: hello (name and colour), in (controls). The relay adds "from" (the guest's seat)
  // and sends welcome, join, leave, host-left and refused.

  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function clamp1(v) { v = +v || 0; return Math.max(-1, Math.min(1, v)); }
  function emit(ev) { if (isHost()) net.events.push(ev); }
  function netSend(data) { if (net && net.ws.readyState === 1) net.ws.send(JSON.stringify(data)); }
  function newCode() {
    var out = '', a = new Uint32Array(5);
    crypto.getRandomValues(a);
    for (var i = 0; i < 5; i++) out += CODE_CHARS[a[i] % CODE_CHARS.length];
    return out;
  }
  function inviteLink() { return location.origin + location.pathname + '?room=' + net.code; }
  function byId(id) { return players.filter(function (q) { return q.id === id; })[0]; }

  function connect(role, code) {
    if (net) closeNet();
    var ws = new WebSocket(RELAY + '/room/ricochet/' + code + '?role=' + role);
    net = { role: role, code: code, ws: ws, seat: role === 'host' ? 0 : -1, guests: [], members: {}, inputs: {}, events: [], sendIn: 0, inputIn: 0, sent: '', opened: false };
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
    shots = [];
    crates = [];
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
      net.guests = net.guests.filter(function (x) { return x !== seat; });
      delete net.inputs[seat];
      delete net.members[seat];
      if (phase === 'lobby') { showLobby(); return; }
      var q = players.filter(function (pl) { return pl.seat === seat && !pl.bot; })[0];
      if (q) {
        q.left = true;
        if (q.alive) { q.alive = false; emit(['x', q.id, -1]); destroyEffect(q, null); }
        renderScores();
        live.textContent = q.name + ' left the game.';
      }
    } else if (m.t === 'in') {
      // m.n counts the guest's fire presses, so a quick tap is never lost between two steps.
      var prev = net.inputs[seat] || { n: 0, fires: 0 };
      var presses = ((+m.n || 0) - prev.n + 1000) % 1000;
      net.inputs[seat] = {
        turn: clamp1(m.tu), move: clamp1(m.mv), aim: m.a == null ? null : +m.a || 0, thrust: Math.max(0, clamp1(m.th)),
        n: +m.n || 0, fires: Math.min(3, prev.fires + (presses > 0 && presses < 10 ? presses : 0)),
      };
    } else if (m.t === 'hello') {
      if (phase !== 'lobby' || net.guests.indexOf(seat) === -1) return;
      setMember(seat, m.name, m.c);
      showLobby();
    }
  }

  // The host decides colours, so two players can never get the same one.
  function setMember(seat, name, wanted) {
    var taken = Object.keys(net.members).filter(function (x) { return +x !== seat; }).map(function (x) { return net.members[x].ci; });
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
    return [0].concat(net.guests).filter(function (x) { return net.members[x]; }).map(function (x) {
      return [x, net.members[x].name, net.members[x].ci];
    });
  }

  function showLobby() {
    if (!isHost()) return;
    phase = 'lobby';
    players = [];
    shots = [];
    crates = [];
    renderScores();
    pauseBtn.hidden = false;
    var maxBots = MAX_SEATS - 1 - net.guests.length;
    setup.onlineBots = Math.max(0, Math.min(maxBots, setup.onlineBots));
    netSend({ t: 'lobby', pl: lobbyList(), bots: setup.onlineBots });

    var count = net.guests.length;
    var typing = nameFocus();
    showOverlay('Online game',
      '<p class="ri-code">Game code <strong>' + net.code + '</strong></p>' +
      '<p>Send this link to the people you want to play with, or tell them the code. Up to five can join.</p>',
      [['Start game', function () { save(SETUP_KEY, setup); startMatch(); }], ['Cancel', leaveOnline]]);
    var body = overlay.querySelector('.ri-body');
    var row = el('div', 'ri-invite');
    var input = el('input', 'ri-invite-link');
    input.readOnly = true;
    input.value = inviteLink();
    input.setAttribute('aria-label', 'Invite link');
    input.addEventListener('focus', function () { input.select(); });
    var copy = el('button', 'ri-btn', 'Copy link');
    copy.type = 'button';
    copy.addEventListener('click', function (e) {
      e.stopPropagation();
      var done = function () { copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy link'; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(done, function () { input.select(); });
      else input.select();
    });
    row.append(input, copy);
    if (navigator.share) {
      var share = el('button', 'ri-btn', 'Share');
      share.type = 'button';
      share.addEventListener('click', function (e) { e.stopPropagation(); navigator.share({ title: 'Play Ricochet with me', url: input.value }).catch(function () {}); });
      row.append(share);
    }
    body.append(row, seatList(lobbyList()));
    body.append(profileEditor(lobbyList(), function () { setMember(0, profile.name, profile.color); showLobby(); }));
    body.append(el('p', 'ri-lobby-status', count ? (count === 1 ? 'One player has joined.' : count + ' players have joined.') : 'Waiting for players to join…'));
    var botOptions = [];
    for (var n = 0; n <= maxBots; n++) botOptions.push([n, String(n)]);
    body.append(choice('Computer tanks', botOptions, setup.onlineBots, function (v) { setup.onlineBots = v; showLobby(); }));
    var note = el('p', 'ri-note');
    note.textContent = (setup.mazes ? 'Mixed mazes' : 'Classic maze only') + ', power-ups ' + (setup.powerups ? 'on' : 'off') + ' (change these in the menu).';
    body.append(note);
    typing();
  }

  function sendState() {
    if (!isHost()) return;
    netSend({
      t: 's', ph: phase, rt: r2(readyTime), tm: r2(roundTime),
      p: players.map(function (q) {
        var f = {};
        Object.keys(q.fx).forEach(function (k) { if (q.fx[k] > 0) f[k] = r1(q.fx[k]); });
        return [r1(q.x), r1(q.y), r2(q.angle), r1(q.vx || 0), r1(q.vy || 0), r2(q.spin || 0), q.alive ? 1 : 0, f, q.split, q.phase, q.score, q.kills, q.left ? 1 : 0];
      }),
      b: shots.map(function (x) { return [r1(x.x), r1(x.y), r1(x.vx), r1(x.vy), x.owner.id, x.phase ? 1 : 0, x.inWall ? 1 : 0, r1(x.age)]; }),
      k: crates.map(function (k) { return [k.type, r1(k.x), r1(k.y), r1(k.age)]; }),
      e: net.events,
    });
    net.events = [];
  }

  // Shared lobby pieces ---------------------------------------------------------

  // "Have a code?": type the five characters a friend reads out, instead of opening their link.
  function joinByCode() {
    var form = el('form', 'ri-join');
    var label = el('label', 'ri-choice-label', 'Have a code?');
    var input = el('input', 'ri-join-code');
    input.id = label.htmlFor = 'ri-join-code';
    input.maxLength = 5;
    input.placeholder = 'ABCDE';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocapitalize', 'characters');
    var btn = el('button', 'ri-btn', 'Join');
    btn.type = 'submit';
    var msg = el('p', 'ri-join-msg');
    msg.setAttribute('aria-live', 'polite');
    input.addEventListener('input', function () { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); msg.textContent = ''; });
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

  // Rebuilding the lobby must not interrupt someone typing their name.
  function nameFocus() {
    var a = document.activeElement;
    var focused = !!(a && a.classList && a.classList.contains('ri-name-input'));
    var pos = focused ? a.selectionStart : 0;
    return function () {
      if (!focused) return;
      var input = overlay.querySelector('.ri-name-input');
      if (input) { input.focus({ preventScroll: true }); input.setSelectionRange(pos, pos); }
    };
  }

  // Name field and colour swatches. list: [[seat, name, colour], ...] as decided by the host.
  function profileEditor(list, onChange) {
    var mine = list.filter(function (e) { return e[0] === net.seat; })[0];
    var myColor = mine ? mine[2] : profile.color;
    var taken = list.filter(function (e) { return e[0] !== net.seat; }).map(function (e) { return e[2]; });
    var wrap = el('div', 'ri-profile');
    var row = el('div', 'ri-choice');
    var label = el('label', 'ri-choice-label', 'Your name');
    var input = el('input', 'ri-name-input');
    input.id = label.htmlFor = 'ri-name-input';
    input.maxLength = 12;
    input.value = profile.name;
    input.placeholder = COLORS[myColor >= 0 ? myColor : 0].name;
    input.autocomplete = 'off';
    input.spellcheck = false;
    var timer = null;
    input.addEventListener('input', function () {
      profile.name = input.value.slice(0, 12);   // cleaned when shown; kept as typed so a pause after a space is fine
      save('ricochet:profile', profile);
      clearTimeout(timer);
      timer = setTimeout(onChange, 450);
    });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
    row.append(label, input);
    var colours = el('div', 'ri-choice');
    colours.append(el('span', 'ri-choice-label', 'Your colour'));
    var group = el('div', 'ri-swatches');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Your colour');
    COLORS.forEach(function (c, i) {
      var b = el('button', 'ri-swatch');
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
        save('ricochet:profile', profile);
        clearTimeout(timer);
        onChange();
      });
      group.append(b);
    });
    colours.append(group);
    wrap.append(row, colours);
    return wrap;
  }

  function seatList(entries) {
    var list = el('div', 'ri-scores ri-lobby');
    entries.forEach(function (e) {
      var chip = el('span', 'ri-chip');
      var dot = el('span', 'ri-dot');
      dot.style.background = COLORS[e[2]].hex;
      var name = cleanName(e[1]) || COLORS[e[2]].name;
      chip.append(dot, el('span', null, name + (e[0] === net.seat ? ' (you)' : e[0] === 0 ? ' (host)' : '')));
      list.append(chip);
    });
    return list;
  }

  // Guest -------------------------------------------------------------------

  function joinOnline(code) {
    connect('guest', code);
    showOverlay('Online game', '<p>Joining game ' + code + '…</p>', [['Cancel', leaveOnline]]);
  }

  function sendHello() { netSend({ t: 'hello', name: profile.name, c: profile.color }); }

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
      shots = [];
      crates = [];
      renderScores();
      var typing = nameFocus();
      showOverlay('Online game', '<p>You\'re in. Waiting for the host to start the game.</p>', [['Leave game', leaveOnline]]);
      var body = overlay.querySelector('.ri-body');
      body.append(seatList(m.pl));
      if (m.bots) body.append(el('p', 'ri-lobby-status', m.bots === 1 ? 'Plus one computer tank.' : 'Plus ' + m.bots + ' computer tanks.'));
      body.append(profileEditor(m.pl, sendHello));
      typing();
    } else if (m.t === 'match') {
      target = m.target;
      players = m.pl.map(function (d) {
        return { id: d[0], bot: !!d[1], seat: d[1] ? null : d[2], name: cleanName(d[3]) || COLORS[d[0]].name, color: COLORS[d[0]].hex,
          score: 0, kills: 0, fx: {}, x: null, y: null, angle: 0, vx: 0, vy: 0, spin: 0, alive: true, split: 0, phase: 0 };
      });
      overlay.hidden = true;
      renderScores();
    } else if (m.t === 'round') {
      round = m.n;
      target = m.target;
      mazeKind = MAZES[m.kind] ? m.kind : 'classic';
      maze = decodeMaze(mazeKind, m.mz);
      roundTime = 0;
      shots = [];
      crates = [];
      particles = [];
      shake = wallFlash = 0;
      players.forEach(function (q) { q.x = null; q.fx = {}; });
      live.textContent = 'Round ' + round + ': ' + MAZES[mazeKind].label + '.';
      phase = 'ready';
      readyTime = 2.1;
      overlay.hidden = true;
      stage.focus({ preventScroll: true });
      bringIntoView();
    } else if (m.t === 's') {
      applyState(m);
    } else if (m.t === 'paused') {
      phase = 'paused';
      showOverlay('Paused', '<p>The host has paused the game.</p>', [['Leave game', leaveOnline]]);
    } else if (m.t === 'over') {
      m.sc.forEach(function (sk, i) { if (players[i]) { players[i].score = sk[0]; players[i].kills = sk[1]; } });
      endMatch(byId(m.w) || players[0]);
    }
  }

  function applyState(m) {
    if (phase === 'lobby' || phase === 'matchover' || !players.length || !maze) return;
    if (phase === 'paused' && m.ph !== 'paused') overlay.hidden = true;
    phase = m.ph;
    readyTime = m.rt;
    roundTime = m.tm;
    m.p.forEach(function (d, i) {
      var q = players[i];
      if (!q) return;
      q.x = q.sx = d[0]; q.y = q.sy = d[1]; q.angle = q.sa = d[2]; q.vx = d[3]; q.vy = d[4]; q.spin = d[5];
      q.alive = !!d[6]; q.fx = d[7]; q.split = d[8]; q.phase = d[9]; q.score = d[10]; q.kills = d[11]; q.left = !!d[12];
      q.age = 0;
    });
    // Events first: a Collapse changes the maze the shots below bounce in.
    m.e.forEach(function (ev) {
      if (ev[0] === 'f') fireEffect(ev[1], ev[2], ev[3], ev[4]);
      else if (ev[0] === 'x') { var a = byId(ev[1]); if (a) destroyEffect(a, ev[2] >= 0 ? byId(ev[2]) : null); }
      else if (ev[0] === 'sh') { var b = byId(ev[1]); if (b) shieldEffect(b); }
      else if (ev[0] === 'pu') { var t = byId(ev[2]); if (t && POWERUPS[ev[1]]) pickupEffect(ev[1], t); }
      else if (ev[0] === 'c') { maze = decodeMaze(mazeKind, ev[1]); wallFlash = 1; shake = Math.max(shake, 6); }
      else if (ev[0] === 'ro') roundEnded(byId(ev[1]) || null);
      else if (ev[0] === 'go') tone(880, 0.14, 'triangle', 0.07);
    });
    shots = m.b.map(function (d) { return { x: d[0], y: d[1], vx: d[2], vy: d[3], owner: byId(d[4]), phase: d[5], inWall: !!d[6], age: d[7] }; });
    crates = m.k.map(function (k) { return { type: k[0], x: k[1], y: k[2], age: k[3] }; });
    renderScores();
  }

  // Between messages, keep tanks moving and shots bouncing so everything looks smooth.
  function guestUpdate(dt) {
    if (phase === 'ready') {
      var before = Math.ceil(readyTime / 0.7);
      readyTime = Math.max(0, readyTime - dt);
      if (Math.ceil(readyTime / 0.7) !== before && readyTime > 0) tone(520, 0.08, 'triangle', 0.05);
      return;
    }
    if (phase !== 'playing') return;
    roundTime += dt;
    crates.forEach(function (k) { k.age += dt; });
    players.forEach(function (q) {
      if (!q.alive || q.x == null) return;
      q.age = Math.min((q.age || 0) + dt, 0.1);
      var nx = q.sx + q.vx * q.age, ny = q.sy + q.vy * q.age;
      if (!hitsWall(nx, ny, TANK_R - 1)) { q.x = nx; q.y = ny; }
      q.angle = q.sa + q.spin * q.age;
      Object.keys(q.fx).forEach(function (k) { q.fx[k] -= dt; });
    });
    shots.forEach(function (x) {
      for (var t = 0; t < dt; t += STEP) {
        x.age += STEP;
        var nx = x.x + x.vx * STEP;
        if (hitsWall(nx, x.y, SHOT_R)) { if (x.phase > 0) { x.x = nx; x.inWall = true; } else { x.vx = -x.vx; bounceTick(); } } else x.x = nx;
        var ny = x.y + x.vy * STEP;
        if (hitsWall(x.x, ny, SHOT_R)) { if (x.phase > 0) { x.y = ny; x.inWall = true; } else { x.vy = -x.vy; bounceTick(); } } else x.y = ny;
        if (x.inWall && !hitsWall(x.x, x.y, SHOT_R)) { x.inWall = false; x.phase = 0; }
      }
    });
  }

  function netTick(dt) {
    if (isHost()) {
      if (phase !== 'ready' && phase !== 'playing' && phase !== 'roundover') return;
      net.sendIn -= dt;
      if (net.sendIn <= 0) { net.sendIn = SEND_EVERY; sendState(); }
    } else if (isGuest()) {
      net.inputIn -= dt;
      var c = localControl(true, 0);
      if (c.fire && !net.fireWas) net.presses = ((net.presses || 0) + 1) % 1000;
      net.fireWas = !!c.fire;
      var msg = c.aim != null
        ? { t: 'in', a: r2(c.aim), th: r2(c.thrust), n: net.presses || 0 }
        : { t: 'in', tu: r2(c.turn), mv: r2(c.move), n: net.presses || 0 };
      var key = [msg.tu, msg.mv, msg.a, msg.th, msg.n].join(',');
      var fired = net.sentN !== msg.n;
      if (key !== net.sent && (net.inputIn <= 0 || fired || !net.sent)) {
        net.sent = key;
        net.sentN = msg.n;
        net.inputIn = INPUT_EVERY;
        netSend(msg);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Input

  var GAME_CODES = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Enter', 'ShiftLeft', 'ShiftRight', 'Slash', 'KeyQ'];
  document.addEventListener('keydown', function (e) {
    if (e.target.closest && e.target.closest('input, textarea, a')) return;
    var inMenu = phase === 'menu' || phase === 'matchover' || phase === 'paused' || phase === 'lobby';
    if (e.code === 'Escape' || e.code === 'KeyP') { if (phase === 'paused') resume(); else pause(); return; }
    if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) { toggleFull(); return; }
    if (GAME_CODES.indexOf(e.code) !== -1 && !inMenu) e.preventDefault();
    keys[e.code] = true;
  });
  document.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () { keys = {}; touch.x = touch.y = 0; touch.fire = false; touch.joy = null; });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); });

  // Touch: drag on the left half to steer (the tank turns to face the way you drag and drives),
  // tap the right half to fire.
  var firePointers = {};
  function toArena(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  }
  stage.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.ri-overlay')) return;
    var rect = stage.getBoundingClientRect();
    if (e.clientX - rect.left < rect.width / 2) {
      var a = toArena(e);
      touch.joy = { id: e.pointerId, ax: a.x, ay: a.y, cx: e.clientX, cy: e.clientY };
      touch.x = touch.y = 0;
    } else {
      firePointers[e.pointerId] = true;
      touch.fire = true;
    }
    stage.setPointerCapture && stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  stage.addEventListener('pointermove', function (e) {
    if (!touch.joy || e.pointerId !== touch.joy.id) return;
    var reach = 46 * scale;
    var dx = (e.clientX - touch.joy.cx) / reach, dy = (e.clientY - touch.joy.cy) / reach;
    var len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    touch.x = len < 0.2 ? 0 : dx;
    touch.y = len < 0.2 ? 0 : dy;
  });
  function release(e) {
    if (touch.joy && e.pointerId === touch.joy.id) { touch.joy = null; touch.x = touch.y = 0; }
    delete firePointers[e.pointerId];
    touch.fire = Object.keys(firePointers).length > 0;
  }
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  pauseBtn.addEventListener('click', function () { if (phase === 'paused') resume(); else pause(); pauseBtn.blur(); });

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
  muteBtn.addEventListener('click', function () { muted = !muted; save('ricochet:muted', muted); showMute(); muteBtn.blur(); });

  // ---------------------------------------------------------------------------
  // Loop

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    if (net) netTick(dt);
    var key = phase + players.map(function (p) { return (p.alive ? 1 : 0) + ':' + p.score + (p.left ? 'L' : ''); }).join(',');
    if (board.dataset.key !== key) { board.dataset.key = key; renderScores(); }
    draw(now / 1000);
    requestAnimationFrame(frame);
  }

  // Test hooks for development, used from the browser console.
  // __ricochet.tick(10) runs the game ten seconds forward at once (the page can be in the background).
  window.__ricochet = {
    raw: function () { return { players: players, shots: shots, crates: crates, maze: maze }; },
    tick: function (seconds) { for (var t = 0; t < seconds; t += 1 / 60) { update(1 / 60); if (net) netTick(1 / 60); } draw(performance.now() / 1000); renderScores(); return this.state(); },
    maze: function (kind) { if (MAZES[kind]) { mazeKind = lastMaze = kind; maze = buildMaze(kind); } return mazeKind; },
    give: function (type) { if (players[0] && players[0].alive && POWERUPS[type]) apply(type, players[0]); },
    state: function () {
      return { net: net && { role: net.role, code: net.code, seat: net.seat, guests: net.guests, inputs: net.inputs }, phase: phase, round: round, maze: mazeKind, roundTime: Math.round(roundTime * 10) / 10, shots: shots.length,
        crates: crates.map(function (k) { return k.type; }), players: players.map(function (p) {
          return { name: p.name, alive: p.alive, score: p.score, kills: p.kills, x: Math.round(p.x), y: Math.round(p.y) };
        }) };
    },
  };

  if (window.ResizeObserver) new ResizeObserver(fit).observe(stage); else window.addEventListener('resize', fit);
  fit();
  showMute();
  var invite = location.search.match(/[?&]room=([A-Za-z0-9]{5})(?:&|$)/);
  if (invite && RELAY) joinOnline(invite[1].toUpperCase()); else showMenu();
  requestAnimationFrame(frame);
})();
