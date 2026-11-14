// Gridword: guess the five-letter word in six tries.
// Plain JavaScript, no dependencies. Progress and statistics are kept in this browser's localStorage only.
(function () {
  'use strict';

  var LENGTH = 5;
  var TRIES = 6;
  var STORE_KEY = 'gridword:v1';
  var FIRST_DAY = Date.UTC(2026, 10, 13); // Gridword #1 is 13 November 2026
  var KEY_ROWS = ['qwertyuiop', 'asdfghjkl', '>zxcvbnm<'];
  var RANK = { miss: 1, near: 2, hit: 3 };

  var root = document.getElementById('gridword');
  var words = window.GRIDWORD_WORDS;
  if (!root || !words) return;

  var answers = shuffled(words.answers, 20261113);
  var valid = new Set(words.answers.concat(words.valid));
  var store = load();
  var state; // { mode, day, answer, guesses, current, done }
  var busy = false;

  // ---------------------------------------------------------------------------
  // Helpers

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffled(list, seed) {
    var out = list.slice();
    var rand = mulberry32(seed);
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  function todayNumber() {
    var now = new Date();
    var local = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.max(0, Math.round((local - FIRST_DAY) / 86400000));
  }

  function load() {
    var empty = { daily: null, stats: { played: 0, wins: 0, streak: 0, best: 0, dist: [0, 0, 0, 0, 0, 0], lastDay: null } };
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY));
      return saved && saved.stats ? saved : empty;
    } catch (e) { return empty; }
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* private mode: play without saving */ }
  }

  /** Scores a guess: 'hit' = right letter, right spot; 'near' = in the word elsewhere; 'miss' = not in the word. */
  function score(guess, answer) {
    var result = Array(LENGTH).fill('miss');
    var left = {};
    for (var i = 0; i < LENGTH; i++) {
      if (guess[i] === answer[i]) result[i] = 'hit';
      else left[answer[i]] = (left[answer[i]] || 0) + 1;
    }
    for (var k = 0; k < LENGTH; k++) {
      if (result[k] !== 'hit' && left[guess[k]]) { result[k] = 'near'; left[guess[k]]--; }
    }
    return result;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // ---------------------------------------------------------------------------
  // DOM

  root.textContent = '';
  root.classList.add('gw');
  var top = el('div', 'gw-top');
  var title = el('p', 'gw-title');
  var tabs = el('div', 'gw-tabs');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'Mode');
  var dailyTab = el('button', 'gw-tab', 'Daily');
  var practiceTab = el('button', 'gw-tab', 'Practice');
  tabs.append(dailyTab, practiceTab);
  var tools = el('div', 'gw-tools');
  var helpBtn = el('button', 'gw-icon-btn', '?');
  helpBtn.setAttribute('aria-label', 'How to play');
  var statsBtn = el('button', 'gw-icon-btn');
  statsBtn.setAttribute('aria-label', 'Statistics');
  statsBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>';
  tools.append(helpBtn, statsBtn);
  top.append(title, tabs, tools);

  var toast = el('div', 'gw-toast');
  toast.setAttribute('role', 'status');
  var live = el('p', 'sr-only');
  live.setAttribute('aria-live', 'polite');

  var board = el('div', 'gw-board');
  board.setAttribute('aria-label', 'Guesses');
  var rows = [];
  for (var r = 0; r < TRIES; r++) {
    var row = el('div', 'gw-row');
    var tiles = [];
    for (var c = 0; c < LENGTH; c++) { var t = el('div', 'gw-tile'); row.appendChild(t); tiles.push(t); }
    board.appendChild(row);
    rows.push({ row: row, tiles: tiles });
  }

  var result = el('div', 'gw-result');
  result.hidden = true;

  var keyboard = el('div', 'gw-keys');
  keyboard.setAttribute('aria-label', 'Keyboard');
  var keys = {};
  KEY_ROWS.forEach(function (line) {
    var kr = el('div', 'gw-key-row');
    line.split('').forEach(function (ch) {
      var key = el('button', 'gw-key');
      key.type = 'button';
      if (ch === '>') { key.textContent = 'Enter'; key.dataset.key = 'enter'; key.classList.add('gw-key-wide'); }
      else if (ch === '<') {
        key.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11v12H9l-6-6 6-6ZM12 9l6 6M18 9l-6 6"/></svg>';
        key.dataset.key = 'back'; key.setAttribute('aria-label', 'Delete letter'); key.classList.add('gw-key-wide');
      } else { key.textContent = ch; key.dataset.key = ch; keys[ch] = key; }
      kr.appendChild(key);
    });
    keyboard.appendChild(kr);
  });

  root.append(top, toast, live, board, result, keyboard);

  var helpDialog = dialog('How to play', [
    '<p>Guess the five-letter word in six tries. Each guess must be a real English word.</p>',
    '<div class="gw-example">' + exampleRow('crane', ['hit', 'miss', 'near', 'miss', 'miss']) + '</div>',
    '<ul class="gw-legend">',
    '<li><span class="gw-swatch hit"></span><span><strong>Teal</strong>: the letter is in the right spot.</span></li>',
    '<li><span class="gw-swatch near"></span><span><strong>Indigo</strong>: the letter is in the word, but in another spot.</span></li>',
    '<li><span class="gw-swatch miss"></span><span><strong>Dark</strong>: the letter is not in the word.</span></li>',
    '</ul>',
    '<p>The <strong>Daily</strong> word is the same for everyone and changes at midnight. <strong>Practice</strong> gives you a new random word whenever you like and does not count towards your statistics.</p>',
    '<p class="gw-fine">Progress is saved only in this browser.</p>',
  ].join(''));
  var statsDialog = dialog('Statistics', '');

  function exampleRow(word, marks) {
    return word.split('').map(function (ch, i) { return '<span class="gw-tile ' + marks[i] + '">' + ch + '</span>'; }).join('');
  }

  function dialog(heading, html) {
    var d = el('dialog', 'gw-dialog');
    var head = el('div', 'gw-dialog-head');
    head.append(el('h2', null, heading));
    var close = el('button', 'gw-icon-btn', '×');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', function () { d.close(); });
    head.append(close);
    var body = el('div', 'gw-dialog-body');
    body.innerHTML = html;
    d.append(head, body);
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    document.body.appendChild(d);
    return d;
  }

  // ---------------------------------------------------------------------------
  // Game flow

  function startDaily() {
    var day = todayNumber();
    if (!store.daily || store.daily.day !== day) store.daily = { day: day, guesses: [] };
    var answer = answers[day % answers.length];
    state = { mode: 'daily', day: day, answer: answer, guesses: store.daily.guesses.slice(), current: '', done: false };
    state.done = isFinished();
    render();
    if (!store.seenHelp) { store.seenHelp = true; save(); helpDialog.showModal(); }
  }

  function startPractice() {
    var answer = answers[Math.floor(Math.random() * answers.length)];
    state = { mode: 'practice', answer: answer, guesses: [], current: '', done: false };
    render();
  }

  function isFinished() {
    var g = state.guesses;
    return g.length === TRIES || g[g.length - 1] === state.answer;
  }

  function render() {
    title.textContent = state.mode === 'daily' ? 'Gridword #' + (state.day + 1) : 'Gridword practice';
    dailyTab.setAttribute('aria-pressed', String(state.mode === 'daily'));
    practiceTab.setAttribute('aria-pressed', String(state.mode === 'practice'));
    Object.keys(keys).forEach(function (k) { keys[k].className = 'gw-key'; keys[k].removeAttribute('data-state'); });
    rows.forEach(function (row, i) {
      var guess = state.guesses[i];
      var marks = guess ? score(guess, state.answer) : null;
      row.row.classList.remove('is-shaking', 'is-won');
      row.tiles.forEach(function (tile, j) {
        tile.className = 'gw-tile';
        tile.textContent = guess ? guess[j] : '';
        if (marks) { tile.classList.add(marks[j], 'is-revealed'); }
      });
      if (guess) paintKeys(guess, marks);
    });
    drawCurrent();
    showResult();
  }

  function drawCurrent() {
    if (state.done) return;
    var row = rows[state.guesses.length];
    row.tiles.forEach(function (tile, j) {
      var ch = state.current[j] || '';
      if (tile.textContent !== ch && ch) { tile.classList.remove('is-typed'); void tile.offsetWidth; tile.classList.add('is-typed'); }
      tile.textContent = ch;
      tile.classList.toggle('is-filled', !!ch);
    });
  }

  function paintKeys(guess, marks) {
    for (var i = 0; i < LENGTH; i++) {
      var key = keys[guess[i]];
      var prev = key.getAttribute('data-state');
      if (!prev || RANK[marks[i]] > RANK[prev]) {
        key.setAttribute('data-state', marks[i]);
        key.className = 'gw-key ' + marks[i];
      }
    }
  }

  function flash(message, ms) {
    toast.textContent = message;
    toast.classList.add('is-on');
    clearTimeout(flash.timer);
    flash.timer = setTimeout(function () { toast.classList.remove('is-on'); }, ms || 1600);
  }

  function shake() {
    var row = rows[state.guesses.length].row;
    row.classList.remove('is-shaking'); void row.offsetWidth; row.classList.add('is-shaking');
  }

  function press(key) {
    if (busy || state.done) return;
    if (key === 'enter') return submit();
    if (key === 'back') { state.current = state.current.slice(0, -1); return drawCurrent(); }
    if (/^[a-z]$/.test(key) && state.current.length < LENGTH) { state.current += key; drawCurrent(); }
  }

  function submit() {
    var guess = state.current;
    if (guess.length < LENGTH) { shake(); return flash('Not enough letters'); }
    if (!valid.has(guess)) { shake(); return flash('Not in the word list'); }

    var rowIndex = state.guesses.length;
    var marks = score(guess, state.answer);
    state.guesses.push(guess);
    state.current = '';
    if (state.mode === 'daily') { store.daily.guesses = state.guesses.slice(); save(); }

    busy = true;
    var row = rows[rowIndex];
    row.tiles.forEach(function (tile, j) {
      setTimeout(function () { tile.classList.add(marks[j], 'is-revealed'); }, j * 230);
    });
    live.textContent = guess.split('').map(function (ch, j) {
      return ch.toUpperCase() + ' ' + { hit: 'correct', near: 'elsewhere', miss: 'not in word' }[marks[j]];
    }).join(', ');

    setTimeout(function () {
      paintKeys(guess, marks);
      busy = false;
      var won = guess === state.answer;
      if (won || state.guesses.length === TRIES) finish(won, row);
    }, LENGTH * 230 + 250);
  }

  function finish(won, row) {
    state.done = true;
    if (state.mode === 'daily') recordDaily(won);
    if (won) {
      row.row.classList.add('is-won');
      flash(['Genius', 'Brilliant', 'Splendid', 'Great', 'Nice', 'Phew'][state.guesses.length - 1], 1800);
    } else {
      flash(state.answer.toUpperCase(), 2600);
    }
    setTimeout(showResult, 900);
  }

  function recordDaily(won) {
    var s = store.stats;
    if (s.lastDay === state.day) return; // already counted
    s.played++;
    if (won) {
      s.wins++;
      s.dist[state.guesses.length - 1]++;
      s.streak = s.lastWinDay === state.day - 1 ? s.streak + 1 : 1;
      s.best = Math.max(s.best, s.streak);
      s.lastWinDay = state.day;
    } else {
      s.streak = 0;
    }
    s.lastDay = state.day;
    save();
  }

  function showResult() {
    if (!state.done) { result.hidden = true; return; }
    var won = state.guesses[state.guesses.length - 1] === state.answer;
    result.hidden = false;
    result.innerHTML = '';
    var line = el('p', 'gw-result-line');
    line.innerHTML = won
      ? 'Solved in <strong>' + state.guesses.length + '/' + TRIES + '</strong>. The word was <strong>' + state.answer.toUpperCase() + '</strong>.'
      : 'The word was <strong>' + state.answer.toUpperCase() + '</strong>.';
    var actions = el('div', 'gw-result-actions');
    if (state.mode === 'daily') {
      var share = el('button', 'btn btn-primary', 'Share result');
      share.addEventListener('click', shareResult);
      var practice = el('button', 'btn btn-ghost', 'Play practice');
      practice.addEventListener('click', startPractice);
      actions.append(share, practice);
      var next = el('p', 'gw-fine');
      result.append(line, actions, next);
      tickCountdown(next);
    } else {
      var again = el('button', 'btn btn-primary', 'New word');
      again.addEventListener('click', startPractice);
      actions.append(again);
      result.append(line, actions);
    }
  }

  function tickCountdown(node) {
    clearInterval(tickCountdown.timer);
    function update() {
      if (!node.isConnected) return clearInterval(tickCountdown.timer);
      var now = new Date();
      var next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      var s = Math.max(0, Math.floor((next - now) / 1000));
      var pad = function (n) { return String(n).padStart(2, '0'); };
      node.textContent = 'Next Gridword in ' + pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
      if (s === 0) { clearInterval(tickCountdown.timer); startDaily(); }
    }
    update();
    tickCountdown.timer = setInterval(update, 1000);
  }

  function shareResult() {
    var emoji = { hit: '🟦', near: '🟪', miss: '⬛' };
    var won = state.guesses[state.guesses.length - 1] === state.answer;
    var text = 'Gridword #' + (state.day + 1) + ' ' + (won ? state.guesses.length : 'X') + '/' + TRIES + '\n\n' +
      state.guesses.map(function (g) { return score(g, state.answer).map(function (m) { return emoji[m]; }).join(''); }).join('\n') +
      '\n\n' + location.origin + location.pathname;
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      navigator.share({ text: text }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () { flash('Copied to clipboard'); }, function () { flash('Could not copy'); });
    }
  }

  function showStats() {
    var s = store.stats;
    var max = Math.max.apply(null, s.dist.concat(1));
    var winPct = s.played ? Math.round((s.wins / s.played) * 100) : 0;
    var lastWon = state.mode === 'daily' && state.done && state.guesses[state.guesses.length - 1] === state.answer;
    statsDialog.querySelector('.gw-dialog-body').innerHTML =
      '<div class="gw-stats">' +
      [[s.played, 'Played'], [winPct, 'Win %'], [s.streak, 'Streak'], [s.best, 'Best streak']]
        .map(function (p) { return '<div><strong>' + p[0] + '</strong><span>' + p[1] + '</span></div>'; }).join('') +
      '</div><h3 class="gw-dist-title">Guesses</h3><div class="gw-dist">' +
      s.dist.map(function (n, i) {
        var current = lastWon && state.guesses.length === i + 1 ? ' is-current' : '';
        return '<div class="gw-dist-row"><span>' + (i + 1) + '</span><div class="gw-bar' + current + '" style="width:' +
          Math.max(8, Math.round((n / max) * 100)) + '%">' + n + '</div></div>';
      }).join('') + '</div><p class="gw-fine">Only Daily games count. Statistics are saved in this browser only.</p>';
    statsDialog.showModal();
  }

  // ---------------------------------------------------------------------------
  // Input

  keyboard.addEventListener('click', function (e) {
    var key = e.target.closest('.gw-key');
    if (key) { press(key.dataset.key); key.blur(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (e.target.closest && e.target.closest('a, input, textarea')) return;
    var k = e.key.toLowerCase();
    if (k === 'enter') { if (e.target.closest && e.target.closest('button')) return; press('enter'); e.preventDefault(); }
    else if (k === 'backspace') { press('back'); e.preventDefault(); }
    else if (/^[a-z]$/.test(k)) press(k);
  });
  dailyTab.addEventListener('click', function () { if (state.mode !== 'daily') startDaily(); });
  practiceTab.addEventListener('click', function () { if (state.mode !== 'practice' || state.done) startPractice(); });
  helpBtn.addEventListener('click', function () { helpDialog.showModal(); });
  statsBtn.addEventListener('click', showStats);

  startDaily();
})();
