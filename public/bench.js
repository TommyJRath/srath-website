// The workbench behind the home page hero: one of five small interactive "tools" is picked at random on each
// visit, and a Swap button cycles through them. Plain canvas, no libraries. Off for prefers-reduced-motion.
// The hero carries data-bench='{"notes":[...]}' (see homePage in src/build.mjs).
(function () {
  'use strict';
  var hero = document.querySelector('.hero[data-bench]');
  if (!hero || !window.requestAnimationFrame) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var data;
  try { data = JSON.parse(hero.getAttribute('data-bench')); } catch (e) { return; }

  var AMBER = '#e8a33d';
  var INK = '#ece6d8';
  var SAND = '#cfc6b4';
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  var canvas = document.createElement('canvas');
  canvas.className = 'bench-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  hero.insertBefore(canvas, hero.firstChild);
  hero.classList.add('has-bench'); // turns off text selection in the hero, see styles.css
  var ctx = canvas.getContext('2d');

  var s = { w: 0, h: 0, t: 0, m: null, down: false, touch: false };

  function resize() {
    var r = hero.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    s.w = r.width; s.h = r.height;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (toy && toy.resize) toy.resize();
  }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rightStart() { return s.w < 760 ? 16 : s.w * 0.5; }

  // 1. Parts bin: screws, nuts and washers that fall, bounce and pile up; the pointer pushes them. ---------
  // Physics: fixed sub-steps (frame-rate independent), impulse-based contacts with restitution and friction,
  // a few relaxation passes per step so stacks don't tremble, and resting parts that fall asleep.
  // Up to MAX_PARTS; beyond that the oldest fade out instead of popping away.
  var MAX_PARTS = 240;
  var GRAVITY = 1500;     // px/s²
  var BOUNCE = 0.18;      // restitution between parts and against the floor
  var FRICTION = 0.35;    // tangential friction at contacts
  var CELL = 20;          // spatial grid cell for finding neighbours
  var parts = {
    name: 'Parts bin',
    hint: 'click to drop screws and nuts',
    init: function () { this.p = []; this.last = 0; this.prevM = null; this.mv = { x: 0, y: 0 }; },
    step: function (h) {
      var list = this.p, floor = s.h - 2, W = s.w, m = s.m, mv = this.mv;
      // Integrate.
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (p.sleep > 30) continue;
        p.vy += GRAVITY * h;
        p.x += p.vx * h; p.y += p.vy * h;
        p.r += p.vr * h;
        p.vx *= 0.999; p.vr *= 0.995;
      }
      // The pointer is a round pusher that also hands on its own speed.
      if (m && !s.touch) {
        for (i = 0; i < list.length; i++) {
          p = list[i];
          var dx = p.x - m.x, dy = p.y - m.y, d = Math.hypot(dx, dy), R = 26 + p.s;
          if (d < R && d > 0.01) {
            var nx = dx / d, ny = dy / d;
            p.x += nx * (R - d); p.y += ny * (R - d);
            // Give the part at most a capped speed away from the pointer (set, not added, so it can't
            // build up over sub-steps), so a quick flick nudges the pile instead of launching it.
            var push = Math.min(Math.max(0, mv.x * nx + mv.y * ny) * 0.6, 420) + 30;
            var away = p.vx * nx + p.vy * ny;
            if (away < push) { p.vx += nx * (push - away); p.vy += ny * (push - away); }
            p.sleep = 0;
          }
        }
      }
      // Contacts, a few passes.
      var grid = {};
      for (i = 0; i < list.length; i++) {
        p = list[i];
        var key = Math.floor(p.x / CELL) + ',' + Math.floor(p.y / CELL);
        (grid[key] || (grid[key] = [])).push(p);
      }
      for (var pass = 0; pass < 3; pass++) {
        for (i = 0; i < list.length; i++) {
          var a = list[i], cx = Math.floor(a.x / CELL), cy = Math.floor(a.y / CELL);
          for (var gx = cx - 1; gx <= cx + 1; gx++) {
            for (var gy = cy - 1; gy <= cy + 1; gy++) {
              var cell = grid[gx + ',' + gy];
              if (!cell) continue;
              for (var k = 0; k < cell.length; k++) {
                var b = cell[k];
                if (b.id <= a.id) continue;
                var ddx = b.x - a.x, ddy = b.y - a.y, dist = Math.hypot(ddx, ddy), min = a.s + b.s;
                if (dist >= min || dist < 0.001) continue;
                var nnx = ddx / dist, nny = ddy / dist, over = min - dist;
                // Push apart (positions only; no energy added).
                var corr = over * 0.5 * 0.8;
                a.x -= nnx * corr; a.y -= nny * corr; b.x += nnx * corr; b.y += nny * corr;
                // Bounce: only if they are moving into each other.
                var rvx = b.vx - a.vx, rvy = b.vy - a.vy, vn = rvx * nnx + rvy * nny;
                if (vn < 0) {
                  var jn = -(1 + BOUNCE) * vn / 2;
                  a.vx -= jn * nnx; a.vy -= jn * nny; b.vx += jn * nnx; b.vy += jn * nny;
                  // Friction along the contact, which also makes them spin.
                  var tx = -nny, ty = nnx, vt = rvx * tx + rvy * ty, jt = clamp(-vt / 2, -jn * FRICTION, jn * FRICTION);
                  a.vx -= jt * tx; a.vy -= jt * ty; b.vx += jt * tx; b.vy += jt * ty;
                  a.vr -= jt / a.s; b.vr -= jt / b.s;
                  if (Math.abs(vn) > 60) { a.sleep = 0; b.sleep = 0; }
                }
              }
            }
          }
        }
        // Floor and walls.
        for (i = 0; i < list.length; i++) {
          p = list[i];
          if (p.y > floor - p.s) {
            p.y = floor - p.s;
            if (p.vy > 0) p.vy = p.vy > 80 ? -p.vy * BOUNCE : 0;
            p.vx *= 0.92;
            p.vr = p.vr * 0.8 + (p.vx / p.s) * 0.2; // roll along the floor
          }
          if (p.x < p.s) { p.x = p.s; if (p.vx < 0) p.vx = -p.vx * BOUNCE; }
          if (p.x > W - p.s) { p.x = W - p.s; if (p.vx > 0) p.vx = -p.vx * BOUNCE; }
        }
      }
      // Sleep: parts that have barely moved for a while stop being simulated until something hits them.
      for (i = 0; i < list.length; i++) {
        p = list[i];
        var speed = Math.abs(p.vx) + Math.abs(p.vy);
        if (speed < 14) { p.sleep = (p.sleep || 0) + 1; if (p.sleep > 30) { p.vx = 0; p.vy = 0; p.vr = 0; } }
        else p.sleep = 0;
      }
    },
    draw: function (x) {
      var now = s.t, dt = this.last ? clamp(now - this.last, 0, 1 / 30) : 1 / 60;
      this.last = now;
      // Pointer speed, for pushing.
      // Smoothed, so one jumpy mouse event doesn't count as a huge speed.
      var raw = s.m && this.prevM && dt > 0 ? { x: (s.m.x - this.prevM.x) / dt, y: (s.m.y - this.prevM.y) / dt } : { x: 0, y: 0 };
      this.mv = { x: this.mv.x * 0.6 + raw.x * 0.4, y: this.mv.y * 0.6 + raw.y * 0.4 };
      this.prevM = s.m ? { x: s.m.x, y: s.m.y } : null;
      var SUB = 4;
      for (var n = 0; n < SUB; n++) this.step(dt / SUB);
      // Fade out the oldest beyond the limit.
      var extra = this.p.length - MAX_PARTS;
      for (var i = 0; i < this.p.length; i++) {
        var p = this.p[i];
        if (i < extra || p.fading) { p.fading = true; p.alpha = (p.alpha == null ? 1 : p.alpha) - dt * 2; }
      }
      var before = this.p.length;
      this.p = this.p.filter(function (q) { return !q.fading || q.alpha > 0; });
      // A part vanished from the pile: wake everything so the parts resting on it can settle again.
      if (this.p.length < before) this.p.forEach(function (q) { q.sleep = 0; });
      this.p.forEach(function (p) {
        x.save(); x.translate(p.x, p.y); x.rotate(p.r);
        x.globalAlpha = p.fading ? Math.max(0, p.alpha) : 1;
        x.strokeStyle = x.fillStyle = p.k === 1 ? AMBER : SAND; x.lineWidth = 2;
        if (p.k === 0) { // screw head
          x.beginPath(); x.arc(0, 0, p.s, 0, 7); x.stroke();
          x.beginPath(); x.moveTo(-p.s * 0.6, 0); x.lineTo(p.s * 0.6, 0); x.stroke();
        } else if (p.k === 1) { // nut
          x.beginPath();
          for (var q = 0; q < 6; q++) { var an = q * Math.PI / 3; x.lineTo(Math.cos(an) * p.s, Math.sin(an) * p.s); }
          x.closePath(); x.stroke();
          x.beginPath(); x.arc(0, 0, p.s * 0.4, 0, 7); x.stroke();
        } else { // washer
          x.beginPath(); x.arc(0, 0, p.s, 0, 7); x.arc(0, 0, p.s * 0.45, 0, 7, true); x.fill('evenodd');
        }
        x.restore();
      });
    },
    down: function (p) {
      this.nextId = this.nextId || 1;
      for (var i = 0; i < 3; i++) {
        // Spread out a little so new parts don't start inside each other.
        this.p.push({
          id: this.nextId++, x: p.x + (i - 1) * 16 + rand(-2, 2), y: p.y - i * 6, vx: rand(-60, 60), vy: rand(-140, -60),
          r: rand(0, 6), vr: rand(-6, 6), k: (this.nextId + i) % 3, s: rand(6, 8.5), sleep: 0,
        });
      }
      // Anything dropped onto the pile wakes it up.
      this.p.forEach(function (q) { if (Math.abs(q.x - p.x) < 80) q.sleep = 0; });
    },
  };

  // 2. Soldering iron: joints snap to a grid and are linked by right-angled traces that never cross. ---------
  var G = 12;
  function seg(a, b) { return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y), a: a, b: b }; }
  // Do two axis-aligned segments touch anywhere other than the allowed shared point?
  function clash(p, q, ok) {
    var x1 = Math.max(p.x1, q.x1), x2 = Math.min(p.x2, q.x2), y1 = Math.max(p.y1, q.y1), y2 = Math.min(p.y2, q.y2);
    if (x1 > x2 || y1 > y2) return false; // no overlap at all
    // They meet in a point or a stretch; that is only fine if it is exactly the shared joint.
    return !(ok && x1 === x2 && y1 === y2 && x1 === ok.x && y1 === ok.y);
  }
  function passesThrough(sg, j) {
    var onLine = sg.x1 === sg.x2 ? j.x === sg.x1 && j.y > sg.y1 && j.y < sg.y2 : j.y === sg.y1 && j.x > sg.x1 && j.x < sg.x2;
    return onLine;
  }
  var solder = {
    name: 'Soldering iron',
    hint: 'click to place joints',
    init: function () { this.joints = []; this.segs = []; },
    route: function (p) {
      var self = this;
      var others = this.joints.filter(function (j) { return j !== p; })
        .sort(function (a, b) { return Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y); })
        .slice(0, 6);
      for (var i = 0; i < others.length; i++) {
        var c = others[i];
        var corners = [{ x: c.x, y: p.y }, { x: p.x, y: c.y }];
        for (var k = 0; k < 2; k++) {
          var corner = corners[k];
          var path = [seg(p, corner), seg(corner, c)].filter(function (sg) { return sg.x1 !== sg.x2 || sg.y1 !== sg.y2; });
          var cornerTaken = self.joints.some(function (q) { return q !== c && q.x === corner.x && q.y === corner.y; });
          var bad = cornerTaken || path.some(function (sg) {
            return self.segs.some(function (old) { return clash(sg, old, c); }) ||
              self.joints.some(function (j) { return j !== p && j !== c && passesThrough(sg, j); });
          });
          if (!bad) { path.forEach(function (sg) { sg.a = p; sg.b = c; self.segs.push(sg); }); return; }
        }
      }
    },
    draw: function (x) {
      x.lineWidth = 3; x.lineJoin = 'round'; x.lineCap = 'round';
      x.strokeStyle = 'rgba(214, 170, 110, .75)';
      this.segs.forEach(function (sg) { x.beginPath(); x.moveTo(sg.x1, sg.y1); x.lineTo(sg.x2, sg.y2); x.stroke(); });
      this.joints.forEach(function (j) {
        j.heat = Math.max(0, j.heat - 0.006);
        var h = j.heat;
        x.fillStyle = 'rgb(' + Math.round(196 + 36 * h) + ',' + Math.round(190 - 27 * h) + ',' + Math.round(180 - 119 * h) + ')';
        x.beginPath(); x.arc(j.x, j.y, 5, 0, 7); x.fill();
        if (h > 0.05) { x.fillStyle = 'rgba(232, 163, 61, ' + (h * 0.3) + ')'; x.beginPath(); x.arc(j.x, j.y, 11, 0, 7); x.fill(); }
      });
      if (s.m && !s.touch) {
        var m = s.m;
        x.save(); x.translate(m.x, m.y); x.rotate(-0.7);
        x.fillStyle = '#8a8272'; x.fillRect(-2, -34, 4, 30);
        x.fillStyle = '#2a2621'; x.fillRect(-5, -72, 10, 40);
        x.fillStyle = AMBER; x.beginPath(); x.moveTo(-2, -4); x.lineTo(2, -4); x.lineTo(0, 0); x.fill();
        x.restore();
        x.strokeStyle = 'rgba(236, 230, 216, .15)'; x.lineWidth = 1;
        x.beginPath(); x.moveTo(m.x + 3, m.y - 6); x.quadraticCurveTo(m.x + 10 + Math.sin(s.t * 3) * 4, m.y - 20, m.x + 4, m.y - 34); x.stroke();
      }
    },
    down: function (raw) {
      var p = { x: Math.round(raw.x / G) * G, y: Math.round(raw.y / G) * G, heat: 1 };
      var same = this.joints.filter(function (j) { return Math.abs(j.x - p.x) < G && Math.abs(j.y - p.y) < G; })[0];
      if (same) { same.heat = 1; return; }
      // A joint may not sit on top of an existing trace.
      if (this.segs.some(function (sg) { return passesThrough(sg, p) || (sg.x1 === p.x && sg.y1 === p.y) || (sg.x2 === p.x && sg.y2 === p.y); })) return;
      this.joints.push(p);
      if (this.joints.length > 16) {
        var gone = this.joints.shift();
        this.segs = this.segs.filter(function (sg) { return sg.a !== gone && sg.b !== gone; });
      }
      this.route(p);
    },
  };

  // 3. Hammer and nails: click to hit a nail; three hits drive it home. ---------
  var hammer = {
    name: 'Hammer',
    hint: 'click three times to drive a nail in',
    init: function () { this.nails = []; this.swing = 0; },
    draw: function (x) {
      var board = s.h - 46;
      x.fillStyle = 'rgba(120, 86, 50, .2)'; x.fillRect(0, board, s.w, s.h - board);
      x.strokeStyle = 'rgba(150, 110, 66, .45)'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(0, board + 0.5); x.lineTo(s.w, board + 0.5); x.stroke();
      for (var g = 0; g < 4; g++) {
        x.strokeStyle = 'rgba(150, 110, 66, .12)';
        x.beginPath(); x.moveTo(0, board + 10 + g * 9);
        for (var gx = 0; gx <= s.w; gx += 60) x.lineTo(gx, board + 10 + g * 9 + Math.sin(gx * 0.01 + g) * 2);
        x.stroke();
      }
      this.nails.forEach(function (n) {
        var out = (3 - n.hits) * 13; // 39px of nail above the board before the first hit
        n.vis += (out - n.vis) * 0.35;
        var top = board - n.vis;
        x.fillStyle = SAND; x.fillRect(n.x - 1.5, top, 3, n.vis + 1);
        x.fillStyle = n.hits >= 3 ? AMBER : SAND; x.fillRect(n.x - 7, top - 3, 14, 3);
      });
      this.swing *= 0.8;
      if (s.m && !s.touch) {
        x.save(); x.translate(s.m.x + 26, s.m.y - 32); x.rotate(0.5 - this.swing);
        x.fillStyle = '#8a6a44'; x.fillRect(-3, 0, 6, 56);
        x.fillStyle = '#a39b8b'; x.fillRect(-15, -9, 30, 13);
        x.restore();
      }
    },
    down: function (p) {
      this.swing = 0.9;
      var n = this.nails.filter(function (q) { return Math.abs(q.x - p.x) < 12 && q.hits < 3; })[0];
      if (!n) { n = { x: p.x, hits: 0, vis: 39 }; this.nails.push(n); if (this.nails.length > 18) this.nails.shift(); }
      n.hits++;
    },
  };

  // 4. After-work coffee: a mug follows the pointer; putting it down leaves a ring. No two rings are alike. ---------
  var coffee = {
    name: 'Coffee',
    hint: 'click to put the mug down',
    init: function () { this.rings = []; },
    draw: function (x) {
      this.rings.forEach(function (r) {
        x.save(); x.translate(r.x, r.y); x.rotate(r.rot); x.scale(1, r.squash);
        x.strokeStyle = 'rgba(150, 104, 60, ' + r.a + ')'; x.lineWidth = r.thick;
        x.beginPath(); x.arc(0, 0, r.R, r.gap, r.gap + Math.PI * 2 - r.gapLen); x.stroke();
        x.lineWidth = 1; x.strokeStyle = 'rgba(150, 104, 60, ' + (r.a * 0.55) + ')';
        x.beginPath(); x.arc(r.ix, r.iy, r.R - 3, r.gap + 1, r.gap + 1 + Math.PI * 1.3); x.stroke();
        if (r.drip) { x.fillStyle = 'rgba(150, 104, 60, ' + (r.a * 0.8) + ')'; x.beginPath(); x.arc(r.drip.x, r.drip.y, r.drip.r, 0, 7); x.fill(); }
        x.restore();
        r.a = Math.max(0.16, r.a - 0.0004);
      });
      if (s.m && !s.touch) {
        var m = s.m;
        x.fillStyle = INK; x.fillRect(m.x - 18, m.y - 26, 36, 40);
        x.strokeStyle = INK; x.lineWidth = 5; x.beginPath(); x.arc(m.x + 20, m.y - 6, 9, -1.4, 1.4); x.stroke();
        x.fillStyle = AMBER; x.fillRect(m.x - 18, m.y - 14, 36, 6);
        for (var i = 0; i < 3; i++) {
          var ox = m.x - 8 + i * 8;
          x.strokeStyle = 'rgba(236, 230, 216, .25)'; x.lineWidth = 1.2;
          x.beginPath(); x.moveTo(ox, m.y - 30); x.quadraticCurveTo(ox + Math.sin(s.t * 2 + i) * 5, m.y - 42, ox, m.y - 54); x.stroke();
        }
      }
    },
    down: function (p) {
      var R = rand(21, 27);
      this.rings.push({
        x: p.x + rand(-2, 2), y: p.y + 14, R: R, a: rand(0.45, 0.6), rot: rand(0, Math.PI * 2), squash: rand(0.9, 1),
        thick: rand(2, 3.6), gap: rand(0, Math.PI * 2), gapLen: rand(0.15, 0.9), ix: rand(-2.5, 2.5), iy: rand(-2.5, 2.5),
        drip: Math.random() < 0.45 ? { x: rand(-R, R), y: R + rand(3, 9), r: rand(1.2, 2.6) } : null,
      });
      if (this.rings.length > 9) this.rings.shift();
    },
  };

  // 5. Magnifying glass over tiny print. Press and drag up or down to raise or lower the lens. ---------
  var glass = {
    name: 'Magnifying glass',
    hint: 'press and drag up or down to focus',
    init: function () { this.paper = null; this.lift = 0.35; this.hold = null; this.pos = null; },
    resize: function () { this.paper = null; },
    makePaper: function () {
      var scale = 3, c = document.createElement('canvas');
      c.width = Math.round(s.w * scale); c.height = Math.round(s.h * scale);
      var x = c.getContext('2d');
      x.scale(scale, scale);
      x.fillStyle = 'rgba(236, 230, 216, .5)';
      x.font = '3.3px ' + MONO;
      var x0 = rightStart(), notes = data.notes, k = 0;
      for (var y = 9; y < s.h - 4; y += 6.5) {
        var xx = x0;
        while (xx < s.w - 10) {
          var note = notes[k++ % notes.length] + '   ·   ';
          x.fillText(note, xx, y);
          xx += x.measureText(note).width;
        }
        k += 3; // so the rows don't line up
      }
      this.paper = c; this.scale = scale;
    },
    draw: function (x) {
      if (!this.paper) this.makePaper();
      x.drawImage(this.paper, 0, 0, s.w, s.h);
      var p = this.hold ? this.hold.at : (s.m && !s.touch ? s.m : (s.touch && s.down ? s.m : this.pos));
      if (!p) return;
      this.pos = p;
      var lift = this.lift, R = 46, zoom = 2 + lift * 3, sc = this.scale;
      // Shadow on the paper: further away and softer the higher the lens is.
      x.fillStyle = 'rgba(0, 0, 0, ' + (0.35 - lift * 0.2) + ')';
      x.beginPath(); x.arc(p.x + 6 + lift * 16, p.y + 8 + lift * 22, R * (1 + lift * 0.15), 0, 7); x.fill();
      x.save();
      x.beginPath(); x.arc(p.x, p.y, R, 0, 7); x.clip();
      x.fillStyle = '#1e1c18'; x.fillRect(p.x - R, p.y - R, R * 2, R * 2);
      var src = R / zoom;
      x.drawImage(this.paper, (p.x - src) * sc, (p.y - src) * sc, src * 2 * sc, src * 2 * sc, p.x - R, p.y - R, R * 2, R * 2);
      x.restore();
      x.strokeStyle = SAND; x.lineWidth = 4; x.beginPath(); x.arc(p.x, p.y, R, 0, 7); x.stroke();
      x.strokeStyle = '#8a6a44'; x.lineWidth = 8; x.lineCap = 'round';
      x.beginPath(); x.moveTo(p.x + R * 0.72, p.y + R * 0.72); x.lineTo(p.x + R * 1.45, p.y + R * 1.45); x.stroke();
      if (this.hold) {
        x.fillStyle = AMBER; x.font = '11px ' + MONO;
        x.fillText(Math.round(zoom * 10) / 10 + '×', p.x - R, p.y - R - 8);
      }
    },
    down: function (p) { this.hold = { at: { x: p.x, y: p.y }, y0: p.y, lift0: this.lift }; },
    move: function (p) { if (this.hold) this.lift = clamp(this.hold.lift0 + (this.hold.y0 - p.y) / 140, 0, 1); },
    up: function () { this.hold = null; },
  };

  var TOYS = [parts, solder, hammer, coffee, glass];
  var index = Math.floor(Math.random() * TOYS.length);
  var toy = null;

  // Name, hint and a Swap button, bottom right of the hero.
  var bar = document.createElement('div');
  bar.className = 'bench-bar';
  var label = document.createElement('span');
  label.className = 'bench-hint';
  var swap = document.createElement('button');
  swap.type = 'button';
  swap.className = 'bench-swap';
  swap.textContent = 'Swap tool';
  bar.appendChild(label);
  bar.appendChild(swap);
  hero.appendChild(bar);

  function use(i) {
    index = (i + TOYS.length) % TOYS.length;
    toy = TOYS[index];
    toy.init();
    if (toy.resize) toy.resize();
    label.textContent = toy.name + ' · ' + toy.hint;
  }
  swap.addEventListener('click', function () { use(index + 1); });

  function pos(e) { var r = hero.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function ignored(e) { return e.target.closest && e.target.closest('a, button, .bench-bar'); }
  hero.addEventListener('pointermove', function (e) {
    s.touch = e.pointerType === 'touch';
    s.m = pos(e);
    if (s.down && toy.move) toy.move(s.m);
  });
  hero.addEventListener('pointerleave', function () { s.m = null; if (s.down) { s.down = false; if (toy.up) toy.up(); } });
  hero.addEventListener('pointerdown', function (e) {
    if (ignored(e)) return;
    // Quick repeated clicks (the hammer, the coffee mug) would otherwise select the headline text.
    if (e.pointerType === 'mouse') e.preventDefault();
    var sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount && hero.contains(sel.anchorNode)) sel.removeAllRanges();
    s.touch = e.pointerType === 'touch';
    s.m = pos(e); s.down = true;
    toy.down(s.m);
  });
  window.addEventListener('pointerup', function () { if (s.down) { s.down = false; if (toy.up) toy.up(); } });

  // Only animate while the hero is on screen.
  var visible = true, frame = 0;
  function loop(ts) {
    frame = 0;
    if (!visible) return;
    s.t = ts / 1000;
    ctx.clearRect(0, 0, s.w, s.h);
    toy.draw(ctx);
    frame = requestAnimationFrame(loop);
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible && !frame) frame = requestAnimationFrame(loop);
    }).observe(hero);
  }
  window.addEventListener('resize', resize);
  resize();
  use(index);
  frame = requestAnimationFrame(loop);
})();
