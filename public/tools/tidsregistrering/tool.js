// Tidsregistrering: a start/stop timer and a list of time entries, kept in this browser's localStorage.
// Selected entries become invoice lines (one per customer and task) in the invoice generator.
(function () {
  'use strict';
  var T = window.SrathTools;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'srath-tid';
  var HOUR = 3600000;

  var state = T.storageGet(KEY) || {};
  state.entries = state.entries || [];   // { id, date, project, desc, ms, invoiced }
  state.running = state.running || null; // { start, project, desc }
  state.rate = state.rate || '';
  state.round = state.round || '0.25';
  var selected = {};

  function save() { T.storageSet(KEY, state); }
  function hours(ms) { return ms / HOUR; }
  function fmtHours(h) { return T.formatNumber(h, 2).replace(/[,.]00$/, '') + T.t(' t', ' h'); }
  function clock(ms) {
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return h + ':' + String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function label(e) { return [e.project, e.desc].filter(Boolean).join(' – ') || T.t('(uden navn)', '(no name)'); }

  function tick() {
    $('tt-clock').textContent = clock(state.running ? Date.now() - state.running.start : 0);
    $('tt-clock').classList.toggle('is-running', !!state.running);
  }

  function projects() {
    var seen = {};
    state.entries.forEach(function (e) { if (e.project) seen[e.project] = true; });
    return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'da'); });
  }

  function visible() {
    var f = $('tt-filter').value, p = $('tt-pfilter').value;
    return state.entries.filter(function (e) { return (f === 'all' || !e.invoiced) && (!p || e.project === p); })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id; });
  }

  function roundUp(h) {
    var step = Number(state.round);
    return step ? Math.ceil(h / step - 1e-9) * step : Math.round(h * 100) / 100;
  }

  /** Selected entries grouped by customer + task, as invoice lines. */
  function groups() {
    var g = {};
    state.entries.forEach(function (e) {
      if (!selected[e.id]) return;
      var k = label(e);
      (g[k] = g[k] || { label: k, ms: 0, ids: [], from: e.date, to: e.date });
      g[k].ms += e.ms; g[k].ids.push(e.id);
      if (e.date < g[k].from) g[k].from = e.date;
      if (e.date > g[k].to) g[k].to = e.date;
    });
    return Object.keys(g).map(function (k) { return g[k]; });
  }

  function render() {
    var dl = $('tt-projects'), pf = $('tt-pfilter'), cur = pf.value;
    dl.replaceChildren(); pf.replaceChildren(pf.options[0]);
    projects().forEach(function (p) {
      var o = document.createElement('option'); o.value = p; dl.appendChild(o);
      var o2 = document.createElement('option'); o2.value = p; o2.textContent = p; pf.appendChild(o2);
    });
    pf.value = cur;

    var rows = visible(), body = $('tt-rows');
    body.replaceChildren();
    rows.forEach(function (e) {
      var tr = document.createElement('tr');
      if (e.invoiced) tr.className = 'is-done';
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = !!selected[e.id]; cb.disabled = !!e.invoiced;
      cb.setAttribute('aria-label', T.t('Vælg', 'Select') + ' ' + label(e));
      cb.addEventListener('change', function () { if (this.checked) selected[e.id] = true; else delete selected[e.id]; summary(); });
      var c0 = document.createElement('td'); c0.appendChild(cb); tr.appendChild(c0);
      [T.showDate(e.date), label(e) + (e.invoiced ? T.t(' · faktureret', ' · invoiced') : ''), fmtHours(hours(e.ms))].forEach(function (v, i) {
        var td = document.createElement('td'); td.textContent = v; if (i === 2) td.className = 'r'; tr.appendChild(td);
      });
      var del = document.createElement('button');
      del.type = 'button'; del.className = 'tl-icon-btn'; del.textContent = '×';
      del.setAttribute('aria-label', T.t('Slet', 'Delete'));
      del.addEventListener('click', function () {
        state.entries = state.entries.filter(function (q) { return q.id !== e.id; });
        delete selected[e.id]; save(); render();
      });
      var td = document.createElement('td'); td.className = 'kb-del-col'; td.appendChild(del); tr.appendChild(td);
      body.appendChild(tr);
    });
    $('tt-empty').hidden = rows.length > 0;
    $('tt-toggle').textContent = state.running ? T.t('Stop', 'Stop') : T.t('Start', 'Start');
    $('tt-toggle').classList.toggle('btn-primary', !state.running);
    $('tt-toggle').classList.toggle('btn-ghost', !!state.running);
    summary();
  }

  function summary() {
    var gs = groups();
    var h = gs.reduce(function (s, g) { return s + roundUp(hours(g.ms)); }, 0);
    var rate = T.parseNumber(state.rate);
    $('tt-sel-hours').textContent = fmtHours(h);
    $('tt-sel-sum').textContent = !isNaN(rate) && h ? T.formatKr(h * rate) + T.t(' uden moms', ' without VAT') : T.t('Vælg tid i listen', 'Select time in the list');
    $('tt-invoice').disabled = !gs.length;
  }

  $('tt-toggle').addEventListener('click', function () {
    if (state.running) {
      var r = state.running, ms = Date.now() - r.start;
      if (ms >= 60000) state.entries.push({ id: Date.now(), date: T.isoDate(new Date(r.start)), project: r.project, desc: r.desc, ms: ms, invoiced: false });
      state.running = null;
    } else {
      state.running = { start: Date.now(), project: $('tt-project').value.trim(), desc: $('tt-desc').value.trim() };
    }
    save(); tick(); render();
  });
  // Changing the customer or task while the timer runs updates the running entry.
  ['tt-project', 'tt-desc'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      if (!state.running) return;
      state.running.project = $('tt-project').value.trim();
      state.running.desc = $('tt-desc').value.trim();
      save();
    });
  });

  $('tt-manual').addEventListener('submit', function (e) {
    e.preventDefault();
    var h = T.parseNumber($('tt-m-hours').value);
    var ok = !isNaN(h) && h > 0 && h <= 24;
    $('tt-m-hours').setAttribute('aria-invalid', ok ? 'false' : 'true');
    if (!ok || !$('tt-m-date').value) return;
    state.entries.push({ id: Date.now(), date: $('tt-m-date').value, project: $('tt-project').value.trim(), desc: $('tt-desc').value.trim(), ms: Math.round(h * HOUR), invoiced: false });
    $('tt-m-hours').value = '';
    save(); render();
  });

  $('tt-rate').value = state.rate;
  $('tt-rate').addEventListener('input', function () { state.rate = this.value; save(); summary(); });
  $('tt-round').value = state.round;
  $('tt-round').addEventListener('change', function () { state.round = this.value; save(); summary(); });
  $('tt-filter').addEventListener('change', render);
  $('tt-pfilter').addEventListener('change', render);

  $('tt-invoice').addEventListener('click', function () {
    var gs = groups();
    if (!gs.length) return;
    var rate = T.parseNumber(state.rate);
    var lines = gs.map(function (g) {
      var period = g.from === g.to ? T.showDate(g.from) : T.showDate(g.from) + ' – ' + T.showDate(g.to);
      return { desc: g.label + ' (' + period + ')', qty: T.formatNumber(roundUp(hours(g.ms)), 2).replace(/[,.]00$/, ''), price: isNaN(rate) ? '' : T.formatNumber(rate, 2) };
    });
    gs.forEach(function (g) { g.ids.forEach(function (id) { state.entries.forEach(function (e) { if (e.id === id) e.invoiced = true; }); }); });
    selected = {};
    save();
    T.sendToInvoice({ doc: 'faktura', lines: lines, from: 'timer' });
  });

  $('tt-csv').addEventListener('click', function () {
    var head = T.t(['Dato', 'Kunde/projekt', 'Opgave', 'Timer', 'Faktureret'], ['Date', 'Customer/project', 'Task', 'Hours', 'Invoiced']);
    var rows = state.entries.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (e) {
      return [e.date, e.project, e.desc, hours(e.ms).toFixed(2).replace('.', ','), e.invoiced ? T.t('ja', 'yes') : ''].map(T.csvCell).join(';');
    });
    T.download(T.t('tidsregistrering.csv', 'time-tracking.csv'), '﻿' + [head.join(';')].concat(rows).join('\r\n'), 'text/csv;charset=utf-8');
  });

  if (state.running) { $('tt-project').value = state.running.project; $('tt-desc').value = state.running.desc; }
  $('tt-m-date').value = T.isoDate();
  T.onLang(render);
  render();
  tick();
  setInterval(tick, 1000);
})();
