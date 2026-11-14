// Knockout: push the other pucks off a shrinking platform. The last puck standing takes the round.
// Play against computer pucks, or two players on one keyboard. Like Trails, the simulation runs on a
// fixed arena with a fixed timestep, so it plays the same on every screen and can later be run by one
// "host" browser for online play. Settings are kept in localStorage.
(function () {
  'use strict';

  var root = document.getElementById('knockout');
  if (!root) return;

  // Arena and rules, in arena units (the canvas is scaled to fit).
  var W = 1000, H = 680, CX = 500, CY = 340;
  var STEP = 1 / 120;             // simulation timestep, seconds
  var R0 = 290;                   // platform radius at the start of a round
  var R_MIN = 70;                 // it never gets smaller than this
  var SHRINK_AFTER = 8;           // seconds before the platform starts to shrink
  var SHRINK_SPEED = 7;           // units of radius per second
  var SUDDEN_DEATH = 40;          // after this many seconds the platform keeps shrinking until someone falls
  var PUCK = 20;                  // puck radius
  var ACCEL = 1150;               // how hard a puck pushes itself
  var DRAG = 3.4;                 // friction; top speed is about ACCEL / DRAG
  var DASH = 520;                 // a dash's burst of speed
  var DASH_COOLDOWN = 1.4;        // seconds between dashes
  var DASH_HEAVY = 0.28;          // while dashing, a puck counts as heavier, so it wins collisions
  var HEAVY_MASS = 2.4;
  var BOUNCE = 0.9;               // how bouncy collisions are
  var KNOCK = 90;                 // extra push on every hit, so even slow bumps matter
  var FALL_TIME = 0.7;            // seconds a puck takes to fall off the edge
  var CREDIT_TIME = 3;            // a fall within this long after a hit counts as a knockout by the hitter
  var SETUP_KEY = 'knockout:setup';

  // Arenas: one is picked for each round (the first round is always Classic), so rounds feel different.
  var ARENAS = {
    classic: { label: 'Classic', desc: 'A plain round platform' },
    donut: { label: 'Donut', desc: 'Mind the hole in the middle' },
    square: { label: 'Square', desc: 'The corners are dangerous' },
    bumpers: { label: 'Bumpers', desc: 'Spinning bumpers kick you away' },
    ice: { label: 'Ice', desc: 'Everything slides' },
    wind: { label: 'Wind', desc: 'A gust pushes everyone, and it turns' },
  };
  var HOLE = 82;                  // Donut: radius of the hole in the middle
  var BUMPER = 26, BUMPER_KICK = 420;
  var ICE_DRAG = 1.1;             // Ice: friction (normally DRAG)
  var WIND = 330;                 // Wind: how hard it pushes

  // Power-ups. kind: 'self' helps whoever takes it, 'others' hits everyone else, 'blast' happens at once.
  var POWERUPS = {
    heavy: { kind: 'self', label: 'Heavy', glyph: '●', time: 6, desc: 'you are hard to move' },
    giant: { kind: 'self', label: 'Giant', glyph: '◯', time: 6, desc: 'you are big and heavy' },
    turbo: { kind: 'self', label: 'Turbo', glyph: '»', time: 6, desc: 'your dash recharges almost at once' },
    ghost: { kind: 'self', label: 'Ghost', glyph: '◌', time: 4, desc: 'nothing can touch you' },
    shock: { kind: 'blast', label: 'Shockwave', glyph: '✺', desc: 'blasts everyone near you away' },
    slick: { kind: 'others', label: 'Ice others', glyph: '❄', time: 5, desc: 'everyone else slides around' },
  };
  var KIND_COLORS = { self: '#2dd4bf', others: '#fb7185', blast: '#fbbf24' };
  var PICK_R = 14, PICK_EVERY = [3, 6], PICK_MAX = 2, PICK_LIFE = 11;

  var COLORS = [
    { name: 'Teal', hex: '#2dd4bf' }, { name: 'Indigo', hex: '#818cf8' }, { name: 'Amber', hex: '#fbbf24' },
    { name: 'Pink', hex: '#f472b6' }, { name: 'Sky', hex: '#38bdf8' }, { name: 'Lime', hex: '#a3e635' },
  ];

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

  // Tiny synthesized sounds, only after the visitor has interacted with the page.
  var audio = null, muted = load('knockout:muted', false);
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
  root.classList.add('ko');
  var hud = el('div', 'ko-hud');
  var board = el('div', 'ko-scores');
  board.setAttribute('aria-label', 'Scores');
  var tools = el('div', 'ko-tools');
  var fullBtn = el('button', 'ko-btn', 'Full screen');
  var pauseBtn = el('button', 'ko-btn', 'Pause');
  var muteBtn = el('button', 'ko-btn');
  fullBtn.type = pauseBtn.type = muteBtn.type = 'button';
  tools.append(fullBtn, pauseBtn, muteBtn);
  hud.append(board, tools);

  var stage = el('div', 'ko-stage');
  stage.tabIndex = 0;
  var canvas = el('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Knockout arena');
  var overlay = el('div', 'ko-overlay');
  stage.append(canvas, overlay);
  var help = el('p', 'ko-help');
  var live = el('p', 'sr-only');
  live.setAttribute('aria-live', 'polite');
  root.append(hud, stage, help, live);

  var ctx = canvas.getContext('2d');
  var scale = 1, dpr = 1;

  // ---------------------------------------------------------------------------
  // Game state

  var setup = load(SETUP_KEY, { mode: 'solo', bots: 3 });
  if (setup.arenas === undefined) setup.arenas = true;
  if (setup.powerups === undefined) setup.powerups = true;
  var players = [];
  var arena = 'classic', lastArena = 'classic', windAngle = 0;
  var pickups = [], nextPickup = 0;
  var particles = [];
  var phase = 'menu';              // menu | ready | playing | roundover | matchover | paused
  var pausedFrom = null;
  var readyTime = 0, roundOverTime = 0, roundTime = 0, target = 5, round = 0, accumulator = 0;
  var roundMessage = '', roundColor = '';
  var shake = 0;
  var keys = {};
  var touch = { x: 0, y: 0, dash: false, joy: null };

  function isMe(p) { return setup.mode === 'solo' && p.id === 0; }
  function who(p) { return isMe(p) ? 'You' : p.name; }
  function humans() { return players.filter(function (p) { return !p.bot; }); }
  function minRadius() { return arena === 'donut' ? HOLE + 75 : R_MIN; }
  function radius() {
    if (roundTime < SHRINK_AFTER) return R0;
    var held = Math.max(minRadius(), R0 - (Math.min(roundTime, SUDDEN_DEATH) - SHRINK_AFTER) * SHRINK_SPEED);
    if (roundTime < SUDDEN_DEATH) return held;
    return Math.max(0, held - (roundTime - SUDDEN_DEATH) * SHRINK_SPEED * 1.5);
  }
  function standing(p) { return !p.out && p.falling == null; }
  function fx(p, name) { return (p.fx[name] || 0) > 0; }
  function rad(p) { return PUCK * (fx(p, 'giant') ? 1.6 : 1); }
  function mass(p) { return (p.heavy > 0 ? HEAVY_MASS : 1) * (fx(p, 'heavy') ? 2.6 : 1) * (fx(p, 'giant') ? 2 : 1); }
  function dragOf(p) { return arena === 'ice' || fx(p, 'slick') ? ICE_DRAG : DRAG; }

  // How far (x, y) is inside the platform's edge; below 0 means off the platform.
  function edgeDist(x, y) {
    var R = radius(), dx = x - CX, dy = y - CY, d = Math.hypot(dx, dy);
    if (arena === 'square') return R * 0.88 - Math.max(Math.abs(dx), Math.abs(dy));
    if (arena === 'donut') return Math.min(R - d, d - HOLE);
    return R - d;
  }
  // The direction towards safer ground from (x, y), whatever the arena's shape.
  function safeDir(x, y) {
    var e = 2, gx = edgeDist(x + e, y) - edgeDist(x - e, y), gy = edgeDist(x, y + e) - edgeDist(x, y - e);
    var len = Math.hypot(gx, gy);
    if (len < 1e-6) { var d = Math.hypot(CX - x, CY - y) || 1; return { x: (CX - x) / d, y: (CY - y) / d }; }
    return { x: gx / len, y: gy / len };
  }
  function bumpers() {
    if (arena !== 'bumpers') return [];
    var list = [], dist = Math.min(125, radius() * 0.55);
    for (var i = 0; i < 3; i++) {
      var a = roundTime * 0.45 + i * Math.PI * 2 / 3;
      list.push({ x: CX + Math.cos(a) * dist, y: CY + Math.sin(a) * dist });
    }
    return list;
  }
  function powerupsOn() { return setup.powerups; }

  function makePlayers() {
    var list = [];
    var count = setup.mode === 'duo' ? 2 : 1;
    for (var i = 0; i < count; i++) {
      list.push({ id: i, bot: false, name: count === 1 ? 'You' : 'Player ' + (i + 1), score: 0, kos: 0 });
    }
    for (var b = 0; b < setup.bots; b++) list.push({ id: list.length, bot: true, name: COLORS[list.length].name, score: 0, kos: 0 });
    list.forEach(function (p) { p.color = COLORS[p.id].hex; p.sloppy = p.bot ? rand(0.6, 1.2) : 0; });
    return list;
  }

  function startMatch() {
    players = makePlayers();
    target = players.length <= 2 ? 5 : 4;
    round = 0;
    startRound();
  }

  function startRound() {
    round++;
    particles = [];
    pickups = [];
    nextPickup = rand(2.5, 4.5);
    // A new arena each round, never the same twice in a row.
    if (round === 1 || !setup.arenas) arena = 'classic';
    else {
      var names = Object.keys(ARENAS).filter(function (n) { return n !== lastArena; });
      arena = names[Math.floor(Math.random() * names.length)];
    }
    lastArena = arena;
    windAngle = Math.random() * Math.PI * 2;
    roundTime = 0;
    accumulator = 0;
    shake = 0;
    // Evenly around the platform, facing the middle, in a random order.
    var start = Math.random() * Math.PI * 2;
    var order = players.map(function (p, i) { return i; }).sort(function () { return Math.random() - 0.5; });
    players.forEach(function (p, i) {
      var a = start + order[i] * Math.PI * 2 / players.length;
      p.x = CX + Math.cos(a) * R0 * 0.62;
      p.y = CY + Math.sin(a) * R0 * 0.62;
      p.vx = p.vy = 0;
      p.face = a + Math.PI;
      p.falling = null;
      p.out = false;
      p.cool = 0;
      p.heavy = 0;
      p.dashHeld = false;
      p.lastHit = null;
      p.think = 0;
      p.plan = { x: 0, y: 0, dash: false };
      p.fx = {};
    });
    live.textContent = 'Round ' + round + ': ' + ARENAS[arena].label + '. ' + ARENAS[arena].desc + '.';
    phase = 'ready';
    readyTime = 2.1;   // a 3, 2, 1 countdown
    overlay.hidden = true;
    renderScores();
    stage.focus({ preventScroll: true });
    bringIntoView();
  }

  // ---------------------------------------------------------------------------
  // Controls: each returns { x, y, dash } with x/y a direction of at most length 1.

  function control(p) {
    if (p.bot) return botControl(p);
    var x = 0, y = 0, dash = false;
    var solo = setup.mode === 'solo';
    if (solo || p.id === 0) {
      x += (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
      y += (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);
      dash = dash || keys.Enter || keys.NumpadEnter || keys.ShiftRight;
    }
    if (solo || p.id === 1) {
      x += (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
      y += (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
      dash = dash || keys.Space || keys.ShiftLeft;
    }
    if (solo) {
      x += touch.x; y += touch.y;
      dash = dash || touch.dash || keys.ShiftRight;
    }
    return { x: x, y: y, dash: dash };
  }

  // Computer pucks get between the middle and an opponent, then shove outwards. They back off from
  // the edge, judging by where their current speed would carry them.
  function botControl(p) {
    p.think -= STEP;
    if (p.think > 0) return p.plan;
    p.think = rand(0.06, 0.13);
    var dr = dragOf(p);
    var stopX = p.x + p.vx / dr, stopY = p.y + p.vy / dr;
    if (arena === 'wind') { stopX += Math.cos(windAngle) * WIND / dr / dr; stopY += Math.sin(windAngle) * WIND / dr / dr; }
    var safe = safeDir(stopX, stopY);
    var inX = safe.x, inY = safe.y;
    if (edgeDist(stopX, stopY) < rad(p) * 1.7) {
      p.plan = { x: inX, y: inY, dash: false };
      return p.plan;
    }
    // Go for a nearby power-up when it's safe to.
    if (powerupsOn() && pickups.length && Math.random() < 0.8) {
      var pk = null, pd = 260;
      pickups.forEach(function (k) { var d = Math.hypot(k.x - p.x, k.y - p.y); if (d < pd) { pd = d; pk = k; } });
      if (pk && edgeDist(pk.x, pk.y) > 40) {
        p.plan = { x: (pk.x - p.x) / (pd || 1), y: (pk.y - p.y) / (pd || 1), dash: false };
        return p.plan;
      }
    }
    var t = null, best = Infinity;
    players.forEach(function (q) {
      if (q === p || !standing(q)) return;
      var d = Math.hypot(q.x - p.x, q.y - p.y) - (Math.hypot(q.x - CX, q.y - CY) * 0.4); // prefer targets near the edge
      if (d < best) { best = d; t = q; }
    });
    if (!t) { p.plan = { x: inX * 0.4, y: inY * 0.4, dash: false }; return p.plan; }

    var out = safeDir(t.x, t.y);
    var ux = -out.x, uy = -out.y;                              // from the target towards its nearest edge
    var tx = t.x - p.x, ty = t.y - p.y, tD = Math.hypot(tx, ty) || 1;
    var behind = (tx * ux + ty * uy) / tD;                      // 1 when I'm right between the middle and them
    var gx, gy;
    if (behind > 0.55) {
      gx = tx / tD; gy = ty / tD;                              // lined up: go for it
    } else {
      var ax = t.x - ux * PUCK * 2.8 - p.x, ay = t.y - uy * PUCK * 2.8 - p.y, aD = Math.hypot(ax, ay) || 1;
      gx = ax / aD; gy = ay / aD;                              // get round to the middle side first
    }
    var wobble = rand(-0.3, 0.3) * p.sloppy, c = Math.cos(wobble), s = Math.sin(wobble);
    var dash = behind > 0.6 && tD < 100 && p.cool === 0 && edgeDist(p.x + gx * 90, p.y + gy * 90) > 30 && Math.random() < 0.55;
    p.plan = { x: gx * c - gy * s, y: gx * s + gy * c, dash: dash };
    return p.plan;
  }

  // ---------------------------------------------------------------------------
  // Simulation

  function stepPuck(p) {
    if (p.out) return;
    if (p.falling != null) {
      p.falling += STEP;
      p.x += p.vx * STEP; p.y += p.vy * STEP;
      if (p.falling >= FALL_TIME) p.out = true;
      return;
    }
    var c = control(p);
    var len = Math.hypot(c.x, c.y);
    if (len > 1) { c = { x: c.x / len, y: c.y / len, dash: c.dash }; len = 1; }
    p.vx += c.x * ACCEL * STEP;
    p.vy += c.y * ACCEL * STEP;
    if (arena === 'wind') { p.vx += Math.cos(windAngle) * WIND * STEP; p.vy += Math.sin(windAngle) * WIND * STEP; }
    var drag = Math.exp(-dragOf(p) * STEP);
    p.vx *= drag; p.vy *= drag;
    p.cool = Math.max(0, p.cool - STEP);
    p.heavy = Math.max(0, p.heavy - STEP);
    Object.keys(p.fx).forEach(function (k) { if (p.fx[k] > 0) p.fx[k] -= STEP; });

    // Dash on a fresh press, in the steering direction (or straight ahead when not steering).
    if (c.dash && !p.dashHeld && p.cool === 0) {
      var dx, dy;
      if (len > 0.2) { dx = c.x / len; dy = c.y / len; }
      else { dx = Math.cos(p.face); dy = Math.sin(p.face); }
      p.vx += dx * DASH; p.vy += dy * DASH;
      p.cool = fx(p, 'turbo') ? 0.3 : DASH_COOLDOWN;
      p.heavy = DASH_HEAVY;
      for (var i = 0; i < 10; i++) {
        particles.push({ x: p.x - dx * PUCK, y: p.y - dy * PUCK, vx: -dx * rand(60, 200) + rand(-50, 50), vy: -dy * rand(60, 200) + rand(-50, 50), life: rand(0.2, 0.45), color: p.color });
      }
      tone(220, 0.16, 'sawtooth', 0.035, 700);
    }
    p.dashHeld = !!c.dash;

    p.x += p.vx * STEP; p.y += p.vy * STEP;
    if (Math.hypot(p.vx, p.vy) > 8) p.face = Math.atan2(p.vy, p.vx);

    if (edgeDist(p.x, p.y) < 0) { fall(p); return; }
    if (powerupsOn()) collect(p);
    bumpers().forEach(function (b) { bump(p, b); });
  }

  // Bumpers kick any puck that touches them.
  function bump(p, b) {
    if (fx(p, 'ghost')) return;
    var dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy), min = rad(p) + BUMPER;
    if (d >= min || d === 0) return;
    var nx = dx / d, ny = dy / d;
    p.x = b.x + nx * min; p.y = b.y + ny * min;
    var vn = p.vx * nx + p.vy * ny;
    if (vn < 0) { p.vx -= vn * nx; p.vy -= vn * ny; }
    p.vx += nx * BUMPER_KICK; p.vy += ny * BUMPER_KICK;
    p.lastHit = null;
    particles.push({ ring: true, x: b.x, y: b.y, r: BUMPER, life: 0.35, color: '#fbbf24' });
    tone(660, 0.1, 'triangle', 0.05, 990);
  }

  // ---------------------------------------------------------------------------
  // Power-ups

  function pickType() {
    var names = Object.keys(POWERUPS);
    return names[Math.floor(Math.random() * names.length)];
  }

  function updatePickups() {
    nextPickup -= STEP;
    if (nextPickup <= 0) {
      nextPickup = rand(PICK_EVERY[0], PICK_EVERY[1]);
      if (pickups.length < PICK_MAX) {
        for (var tries = 0; tries < 30; tries++) {
          var a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * radius();
          var x = CX + Math.cos(a) * d, y = CY + Math.sin(a) * d;
          if (edgeDist(x, y) < 45) continue;
          if (players.some(function (q) { return standing(q) && Math.hypot(q.x - x, q.y - y) < 70; })) continue;
          if (bumpers().some(function (b) { return Math.hypot(b.x - x, b.y - y) < 60; })) continue;
          pickups.push({ type: pickType(), x: x, y: y, age: 0 });
          break;
        }
      }
    }
    pickups = pickups.filter(function (k) { k.age += STEP; return k.age < PICK_LIFE && edgeDist(k.x, k.y) > PICK_R; });
  }

  function collect(p) {
    for (var i = 0; i < pickups.length; i++) {
      var k = pickups[i];
      if (Math.hypot(k.x - p.x, k.y - p.y) > PICK_R + rad(p)) continue;
      pickups.splice(i, 1);
      apply(k.type, p);
      return;
    }
  }

  function apply(type, p) {
    var pu = POWERUPS[type];
    if (pu.kind === 'self') {
      p.fx[type] = Math.min(10, Math.max(0, p.fx[type] || 0) + pu.time);
      if (type === 'turbo') p.cool = 0;
    } else if (pu.kind === 'others') {
      players.forEach(function (q) { if (q !== p && standing(q)) q.fx[type] = Math.min(10, Math.max(0, q.fx[type] || 0) + pu.time); });
    } else if (type === 'shock') {
      players.forEach(function (q) {
        if (q === p || !standing(q) || fx(q, 'ghost')) return;
        var dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
        if (d > 260) return;
        var push = (180 + 620 * (1 - d / 260)) / Math.sqrt(mass(q));
        q.vx += dx / d * push; q.vy += dy / d * push;
        q.lastHit = { by: p, t: roundTime };
      });
      particles.push({ ring: true, x: p.x, y: p.y, r: rad(p), grow: 520, life: 0.5, color: KIND_COLORS.blast });
      shake = Math.max(shake, 8);
    }
    particles.push({ text: pu.label, x: p.x, y: p.y - 30, vx: 0, vy: -30, life: 1.1, color: KIND_COLORS[pu.kind] });
    if (!p.bot) live.textContent = pu.label + '.';
    tone(pu.kind === 'self' ? 880 : pu.kind === 'others' ? 330 : 200, 0.2, pu.kind === 'blast' ? 'sawtooth' : 'triangle', 0.07, pu.kind === 'self' ? 1320 : pu.kind === 'blast' ? 60 : null);
  }

  function fall(p) {
    p.falling = 0;
    var by = p.lastHit && roundTime - p.lastHit.t < CREDIT_TIME ? p.lastHit.by : null;
    if (by && by !== p) {
      by.kos++;
      particles.push({ text: who(by) + ' ✕ ' + who(p), x: p.x, y: p.y - 26, vx: 0, vy: -26, life: 1.4, color: by.color });
      live.textContent = who(by) + ' knocked out ' + who(p) + '.';
    } else {
      live.textContent = who(p) + (isMe(p) ? ' fall off.' : ' falls off.');
    }
    particles.push({ ring: true, x: p.x, y: p.y, r: PUCK, life: 0.6, color: p.color });
    tone(p.bot ? 420 : 360, 0.5, 'triangle', 0.07, 60);
    renderScores();
  }

  function collide(a, b) {
    if (fx(a, 'ghost') || fx(b, 'ghost')) return;
    var dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = rad(a) + rad(b);
    if (d >= min || d === 0) return;
    var nx = dx / d, ny = dy / d;
    var ma = mass(a), mb = mass(b);
    var rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rel < 0) {
      var j = -(1 + BOUNCE) * rel / (1 / ma + 1 / mb) + KNOCK;
      a.vx -= j / ma * nx; a.vy -= j / ma * ny;
      b.vx += j / mb * nx; b.vy += j / mb * ny;
      a.lastHit = { by: b, t: roundTime };
      b.lastHit = { by: a, t: roundTime };
      var hit = Math.min(1, -rel / 600);
      var mx = a.x + nx * rad(a), my = a.y + ny * rad(a);
      var n = 4 + Math.round(hit * 14);
      for (var i = 0; i < n; i++) {
        var ang = Math.random() * Math.PI * 2, sp = rand(80, 320) * (0.4 + hit);
        particles.push({ x: mx, y: my, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: rand(0.15, 0.4), color: i % 2 ? a.color : b.color });
      }
      shake = Math.max(shake, hit * 9);
      tone(140 + hit * 260, 0.09 + hit * 0.08, 'square', 0.03 + hit * 0.05, 70);
    }
    // Push them apart so they never overlap.
    var overlap = min - d;
    var share = mb / (ma + mb);
    a.x -= nx * overlap * share; a.y -= ny * overlap * share;
    b.x += nx * overlap * (1 - share); b.y += ny * overlap * (1 - share);
  }

  function update(dt) {
    particles.forEach(function (q) {
      if (q.ring) { q.r += (q.grow || 140) * dt; } else { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.9; q.vy *= 0.9; }
      q.life -= dt;
    });
    particles = particles.filter(function (q) { return q.life > 0; });
    shake = Math.max(0, shake - dt * 30);

    if (phase === 'ready') {
      var before = Math.ceil(readyTime / 0.7);
      readyTime -= dt;
      if (Math.ceil(readyTime / 0.7) !== before && readyTime > 0) tone(520, 0.08, 'triangle', 0.05);
      if (readyTime <= 0) { phase = 'playing'; tone(880, 0.14, 'triangle', 0.07); }
      return;
    }
    if (phase === 'roundover') {
      roundOverTime -= dt;
      players.forEach(function (p) { if (p.falling != null && !p.out) { p.falling += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.falling >= FALL_TIME) p.out = true; } });
      if (roundOverTime <= 0) {
        var lead = players.slice().sort(function (a, b) { return b.score - a.score; })[0];
        if (lead.score >= target) endMatch(lead); else startRound();
      }
      return;
    }
    if (phase !== 'playing') return;

    // When every human is out, fast-forward so nobody waits for the computer pucks.
    var speed = humans().some(standing) ? 1 : 3;
    accumulator += dt * speed;
    while (accumulator >= STEP) {
      accumulator -= STEP;
      roundTime += STEP;
      if (arena === 'wind') windAngle += STEP * 0.35;
      if (powerupsOn()) updatePickups();
      players.forEach(stepPuck);
      for (var i = 0; i < players.length; i++) {
        for (var k = i + 1; k < players.length; k++) {
          if (standing(players[i]) && standing(players[k])) collide(players[i], players[k]);
        }
      }
      var left = players.filter(standing);
      var falling = players.some(function (p) { return p.falling != null && !p.out; });
      if (left.length <= 1 && !falling) { endRound(left[0]); break; }
    }
  }

  function endRound(winner) {
    phase = 'roundover';
    roundOverTime = 2;
    accumulator = 0;
    if (winner) winner.score++;
    roundMessage = winner ? who(winner) + (isMe(winner) ? ' win the round' : ' wins the round') : 'Nobody is left';
    roundColor = winner ? winner.color : '#9aa3b5';
    live.textContent = roundMessage + '.';
    if (winner && !winner.bot) tone(784, 0.25, 'triangle', 0.08, 1046);
    renderScores();
  }

  function endMatch(winner) {
    phase = 'matchover';
    var you = !winner.bot;
    tone(you ? 523 : 220, 0.5, 'triangle', 0.09, you ? 1046 : 110);
    showOverlay(
      who(winner) === 'You' ? 'You win!' : who(winner) + ' wins',
      '<ol class="ko-final">' + players.slice().sort(function (a, b) { return b.score - a.score || b.kos - a.kos; }).map(function (p) {
        return '<li><span class="ko-dot" style="background:' + p.color + '"></span>' + esc(who(p)) +
          '<span class="ko-kos">' + p.kos + (p.kos === 1 ? ' knockout' : ' knockouts') + '</span><strong>' + p.score + '</strong></li>';
      }).join('') + '</ol>',
      [['Play again', startMatch], ['Change setup', showMenu]]
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

    // Background grid, like the rest of the site.
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1 / (scale * dpr);
    ctx.beginPath();
    for (var gx = 40; gx < W; gx += 40) { ctx.moveTo(gx, 0); ctx.lineTo(gx, H); }
    for (var gy = 40; gy < H; gy += 40) { ctx.moveTo(0, gy); ctx.lineTo(W, gy); }
    ctx.stroke();

    // The platform. Where it used to reach is shown faintly once it starts to shrink.
    var R = phase === 'menu' ? R0 : radius();
    var shrinking = (phase === 'playing' || phase === 'roundover') && roundTime >= SHRINK_AFTER && R > R_MIN;
    if (R < R0 - 1) {
      ctx.strokeStyle = 'rgba(251, 113, 133, 0.18)';
      ctx.setLineDash([6, 10]);
      ctx.lineWidth = 1.5;
      platformPath(R0); ctx.stroke();
      ctx.setLineDash([]);
    }
    var icy = arena === 'ice';
    var g = ctx.createRadialGradient(CX, CY, R * 0.1, CX, CY, R);
    g.addColorStop(0, icy ? '#13283a' : '#121722');
    g.addColorStop(1, icy ? '#0d1a26' : '#0c1018');
    ctx.fillStyle = g;
    platformPath(R); ctx.fill('evenodd');
    ctx.save();
    platformPath(R); ctx.clip('evenodd');
    ctx.strokeStyle = icy ? 'rgba(186, 230, 253, 0.08)' : 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (var rr = 60; rr < R * 1.3; rr += 60) { ctx.beginPath(); ctx.arc(CX, CY, rr, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
    var base = icy ? '#7dd3fc' : '#2dd4bf';
    var edge = shrinking ? 'rgba(251, 113, 133, ' + (0.65 + 0.3 * Math.sin(time * 8)) + ')' : base;
    ctx.shadowColor = shrinking ? '#fb7185' : base;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = edge;
    ctx.globalAlpha = shrinking ? 1 : 0.8;
    ctx.lineWidth = 3;
    platformPath(R); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    // Wind: streaks drifting the way it blows.
    if (arena === 'wind' && phase !== 'menu') {
      var wx = Math.cos(windAngle), wy = Math.sin(windAngle);
      ctx.strokeStyle = 'rgba(231, 233, 238, 0.13)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var i = 0; i < 26; i++) {
        var px = (i * 389 + time * 180 * wx) % W, py = (i * 211 + time * 180 * wy) % H;
        if (px < 0) px += W; if (py < 0) py += H;
        ctx.moveTo(px, py); ctx.lineTo(px - wx * 34, py - wy * 34);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(231, 233, 238, 0.5)';
      ctx.save();
      ctx.translate(CX, CY); ctx.rotate(windAngle);
      ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-10, -10); ctx.lineTo(-4, 0); ctx.lineTo(-10, 10); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    bumpers().forEach(function (b) {
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#1a1407';
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(b.x, b.y, BUMPER, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(b.x, b.y, BUMPER * 0.45, 0, Math.PI * 2); ctx.stroke();
    });

    pickups.forEach(function (k) { drawPickup(k, time); });

    // Falling pucks first, so they drop "under" the platform edge.
    var order = players.filter(function (p) { return !p.out && p.x != null; })
      .sort(function (a, b) { return (b.falling != null) - (a.falling != null); });
    order.forEach(function (p) { drawPuck(p, time); });

    particles.forEach(function (q) {
      ctx.globalAlpha = Math.max(0, Math.min(1, q.life * 2.2));
      if (q.text) {
        ctx.fillStyle = q.color; ctx.font = '700 16px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(q.text, q.x, q.y);
      } else if (q.ring) {
        ctx.strokeStyle = q.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.fillStyle = q.color; ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
      }
    });
    ctx.globalAlpha = 1;

    // Touch joystick.
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
      ctx.fillStyle = '#e7e9ee';
      ctx.font = '800 54px system-ui, sans-serif';
      ctx.fillText(String(Math.max(1, Math.ceil(readyTime / 0.7))), CX, CY + 18);
      ctx.font = '600 16px system-ui, sans-serif';
      ctx.fillStyle = '#9aa3b5';
      ctx.fillText('Round ' + round + '  ·  first to ' + target, CX, CY + 52);
      ctx.fillStyle = '#e7e9ee';
      ctx.font = '800 24px system-ui, sans-serif';
      ctx.fillText(ARENAS[arena].label, CX, CY - 52);
      ctx.fillStyle = '#9aa3b5';
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillText(ARENAS[arena].desc, CX, CY - 30);
    }
    if (phase === 'roundover') {
      ctx.fillStyle = roundColor;
      ctx.font = '800 34px system-ui, sans-serif';
      ctx.fillText(roundMessage, CX, 60);
    }
    [[SHRINK_AFTER, 'The platform is shrinking'], [SUDDEN_DEATH, 'Sudden death']].forEach(function (m) {
      if (phase !== 'playing' || roundTime < m[0] - 2 || roundTime > m[0] + 1) return;
      ctx.globalAlpha = Math.min(1, Math.max(0, 1 - Math.abs(roundTime - m[0] + 0.5)));
      ctx.fillStyle = '#fb7185';
      ctx.font = '700 18px system-ui, sans-serif';
      ctx.fillText(m[1], CX, 44);
      ctx.globalAlpha = 1;
    });
  }

  function platformPath(R) {
    ctx.beginPath();
    if (arena === 'square') {
      var h = R * 0.88;
      ctx.rect(CX - h, CY - h, h * 2, h * 2);
    } else {
      ctx.arc(CX, CY, R, 0, Math.PI * 2);
      if (arena === 'donut') { ctx.moveTo(CX + HOLE, CY); ctx.arc(CX, CY, HOLE, 0, Math.PI * 2, true); }
    }
  }

  function drawPickup(k, time) {
    var pu = POWERUPS[k.type], color = KIND_COLORS[pu.kind];
    if (k.age > PICK_LIFE - 3 && Math.floor(time * 6) % 2) return; // blink before disappearing
    var r = PICK_R * (1 + 0.07 * Math.sin(time * 5 + k.x));
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#0b0d12';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(k.x, k.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pu.glyph, k.x, k.y + 1);
    ctx.textBaseline = 'alphabetic';
  }

  function drawPuck(p, time) {
    var k = p.falling != null ? Math.max(0, 1 - p.falling / FALL_TIME) : 1;
    var r = rad(p) * (0.35 + 0.65 * k);
    ctx.globalAlpha = (0.25 + 0.75 * k) * (fx(p, 'ghost') ? 0.4 : 1);
    ctx.shadowColor = p.color;
    ctx.shadowBlur = p.heavy > 0 ? 26 : 14;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(7, 9, 13, 0.55)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2); ctx.fill();
    // Which way it's heading.
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(p.x + Math.cos(p.face) * r * 0.62, p.y + Math.sin(p.face) * r * 0.62, r * 0.16, 0, Math.PI * 2); ctx.fill();
    if (p.heavy > 0 || fx(p, 'heavy')) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = fx(p, 'heavy') ? 4 : 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2); ctx.stroke();
    }
    if (fx(p, 'slick')) {
      ctx.strokeStyle = '#7dd3fc';
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 12, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Rings showing how long each power-up has left.
    if (p.falling == null) {
      var ring = 0;
      Object.keys(p.fx).forEach(function (name) {
        if (!(p.fx[name] > 0) || !POWERUPS[name] || POWERUPS[name].kind !== 'self') return;
        ctx.strokeStyle = KIND_COLORS.self;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 12 + ring * 4, -Math.PI / 2, -Math.PI / 2 + Math.min(1, p.fx[name] / POWERUPS[name].time) * Math.PI * 2);
        ctx.stroke();
        ring++;
      });
      ctx.globalAlpha = 1;
    }
    // Dash meter: a ring that fills up again after a dash.
    if (p.falling == null && phase === 'playing') {
      var part = 1 - p.cool / DASH_COOLDOWN;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = part >= 1 ? 0.35 : 0.8;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 7, -Math.PI / 2, -Math.PI / 2 + part * Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (phase === 'ready' && !p.bot) {
      ctx.fillStyle = p.color;
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(who(p), p.x, p.y - PUCK - 12);
    }
  }

  function renderScores() {
    board.innerHTML = '';
    players.slice().sort(function (a, b) { return b.score - a.score; }).forEach(function (p) {
      var chip = el('span', 'ko-chip' + (phase === 'playing' && !standing(p) ? ' is-out' : ''));
      var dot = el('span', 'ko-dot');
      dot.style.background = p.color;
      chip.append(dot, el('span', 'ko-name', who(p)), el('strong', null, String(p.score)));
      board.appendChild(chip);
    });
    if (players.length) board.appendChild(el('span', 'ko-goal', 'to ' + target));
  }

  // Fit the arena to the available space, keeping its shape.
  function fit() {
    var rect = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    scale = Math.min(rect.width / W, rect.height / H);
    canvas.style.width = W * scale + 'px';
    canvas.style.height = H * scale + 'px';
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
  }

  // On a phone held sideways the game fills exactly one screen; scroll it into view.
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
    overlay.append(el('h2', 'ko-title', title));
    var body = el('div', 'ko-body');
    body.innerHTML = html;
    overlay.append(body);
    var row = el('div', 'ko-actions');
    buttons.forEach(function (b, i) {
      var btn = el('button', 'btn ' + (i === 0 ? 'btn-primary' : 'btn-ghost'), b[0]);
      btn.type = 'button';
      btn.addEventListener('click', function (e) { e.stopPropagation(); b[1](); });
      row.appendChild(btn);
    });
    overlay.append(row);
    overlay.hidden = false;
    setTimeout(function () { var first = overlay.querySelector('.btn'); if (first && !overlay.hidden) first.focus({ preventScroll: true }); }, 30);
  }

  function choice(label, options, current, onPick) {
    var wrap = el('div', 'ko-choice');
    wrap.append(el('span', 'ko-choice-label', label));
    var group = el('div', 'ko-seg');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    options.forEach(function (o) {
      var b = el('button', 'ko-seg-btn', o[1]);
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
    arena = 'classic';
    pickups = [];
    players = [];
    renderScores();
    var maxBots = setup.mode === 'duo' ? 4 : 5;
    var minBots = setup.mode === 'duo' ? 0 : 1;
    setup.bots = Math.max(minBots, Math.min(maxBots, setup.bots));
    showOverlay('Knockout',
      '<p>Push the other pucks off the platform and stay on it yourself. Every bump sends pucks flying, ' +
      'and a dash makes you heavier for a moment, so it wins any collision. After a few seconds the platform starts to shrink.</p>' +
      '<p>Last puck standing wins the round.</p>',
      [['Play', function () { save(SETUP_KEY, setup); startMatch(); }]]);
    var body = overlay.querySelector('.ko-body');
    body.append(choice('Players', [['solo', 'You vs computer'], ['duo', '2 players, 1 keyboard']], setup.mode, function (v) { setup.mode = v; showMenu(); }));
    var botOptions = [];
    for (var n = minBots; n <= maxBots; n++) botOptions.push([n, String(n)]);
    body.append(choice('Computer pucks', botOptions, setup.bots, function (v) { setup.bots = v; showMenu(); }));
    body.append(choice('Arenas', [[true, 'Mixed'], [false, 'Classic only']], setup.arenas, function (v) { setup.arenas = v; showMenu(); }));
    body.append(choice('Power-ups', [[true, 'On'], [false, 'Off']], setup.powerups, function (v) { setup.powerups = v; showMenu(); }));
    if (setup.powerups) {
      var list = el('ul', 'ko-legend');
      Object.keys(POWERUPS).forEach(function (name) {
        var pu = POWERUPS[name], item = el('li');
        var icon = el('span', 'ko-legend-icon', pu.glyph);
        icon.style.color = icon.style.borderColor = KIND_COLORS[pu.kind];
        var text = el('span');
        text.append(el('strong', null, pu.label), document.createTextNode(' ' + pu.desc));
        item.append(icon, text);
        list.append(item);
      });
      body.append(list);
    }
    help.innerHTML = setup.mode === 'duo'
      ? '<span class="ko-dot" style="background:' + COLORS[0].hex + '"></span>Player 1: <kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> move, <kbd>Enter</kbd> dash &nbsp; ' +
        '<span class="ko-dot" style="background:' + COLORS[1].hex + '"></span>Player 2: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move, <kbd>Space</kbd> dash'
      : 'Move with the arrow keys or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>, dash with <kbd>Space</kbd>. On a touch screen: drag on the left half to move, tap the right half to dash';
    help.innerHTML += ' &nbsp; · &nbsp; <kbd>Esc</kbd> pause &nbsp; · &nbsp; <kbd>F</kbd> full screen';
    if (window.matchMedia('(pointer: coarse) and (orientation: portrait)').matches) {
      help.innerHTML = 'Drag on the left half to move, tap the right half to dash. Turn your phone sideways for a bigger arena.';
    }
  }

  function pause() {
    if (phase !== 'playing' && phase !== 'ready') return;
    pausedFrom = phase;
    phase = 'paused';
    showOverlay('Paused', '', [['Continue', resume], ['Quit to menu', showMenu]]);
  }
  function resume() {
    if (phase !== 'paused') return;
    phase = pausedFrom;
    overlay.hidden = true;
    stage.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------------------
  // Input

  var GAME_CODES = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Enter', 'ShiftLeft', 'ShiftRight'];
  document.addEventListener('keydown', function (e) {
    if (e.target.closest && e.target.closest('input, textarea, a')) return;
    var inMenu = phase === 'menu' || phase === 'matchover' || phase === 'paused';
    if (e.code === 'Escape' || e.code === 'KeyP') { if (phase === 'paused') resume(); else pause(); return; }
    if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) { toggleFull(); return; }
    if (GAME_CODES.indexOf(e.code) !== -1 && !inMenu) e.preventDefault();
    keys[e.code] = true;
  });
  document.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () { keys = {}; touch.x = touch.y = 0; touch.dash = false; touch.joy = null; });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); });

  // Touch: drag on the left half to move (a joystick appears where you put your finger),
  // tap the right half to dash.
  var dashPointers = {};
  function toArena(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  }
  stage.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.ko-overlay')) return;
    var rect = stage.getBoundingClientRect();
    if (e.clientX - rect.left < rect.width / 2) {
      var a = toArena(e);
      touch.joy = { id: e.pointerId, ax: a.x, ay: a.y, cx: e.clientX, cy: e.clientY };
      touch.x = touch.y = 0;
    } else {
      dashPointers[e.pointerId] = true;
      touch.dash = true;
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
    touch.x = len < 0.15 ? 0 : dx;
    touch.y = len < 0.15 ? 0 : dy;
  });
  function release(e) {
    if (touch.joy && e.pointerId === touch.joy.id) { touch.joy = null; touch.x = touch.y = 0; }
    delete dashPointers[e.pointerId];
    touch.dash = Object.keys(dashPointers).length > 0;
  }
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  pauseBtn.addEventListener('click', function () { if (phase === 'paused') resume(); else pause(); pauseBtn.blur(); });

  // Full screen, with a fill-the-window fallback where real full screen isn't available (iPhone).
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
  muteBtn.addEventListener('click', function () { muted = !muted; save('knockout:muted', muted); showMute(); muteBtn.blur(); });

  // ---------------------------------------------------------------------------
  // Loop

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    var key = phase + players.map(function (p) { return (standing(p) ? 1 : 0) + ':' + p.score; }).join(',');
    if (board.dataset.key !== key) { board.dataset.key = key; renderScores(); }
    draw(now / 1000);
    requestAnimationFrame(frame);
  }

  // Test hooks for development, used from the browser console.
  // __knockout.tick(10) runs the game ten seconds forward at once (the page can be in the background).
  window.__knockout = {
    raw: function () { return { players: players, pickups: pickups }; },
    arena: function (name) { if (ARENAS[name]) { arena = name; lastArena = name; } return arena; },
    give: function (type) { if (players[0] && standing(players[0]) && POWERUPS[type]) apply(type, players[0]); },
    tick: function (seconds) { for (var t = 0; t < seconds; t += 1 / 60) update(1 / 60); draw(performance.now() / 1000); renderScores(); return this.state(); },
    state: function () {
      return { phase: phase, round: round, arena: arena, pickups: pickups.map(function (k) { return k.type; }), roundTime: Math.round(roundTime * 10) / 10, radius: Math.round(radius()), players: players.map(function (p) {
        return { name: p.name, standing: standing(p), score: p.score, kos: p.kos, x: Math.round(p.x), y: Math.round(p.y) };
      }) };
    },
  };

  if (window.ResizeObserver) new ResizeObserver(fit).observe(stage); else window.addEventListener('resize', fit);
  fit();
  showMute();
  showMenu();
  requestAnimationFrame(frame);
})();
