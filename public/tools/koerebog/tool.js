// Kørebog: a mileage log with the official per-km rates. Trips are kept in this browser's localStorage.
//
// Rates for tax-free mileage allowance (skattefri kørselsgodtgørelse), from https://skat.dk/hjaelp/satser
// (category "Kørsel") and https://skat.dk/erhverv/ansatte-og-loen/koerselsgodtgoerelse/
// koerselsgodtgoerelse-skattepligtig-og-skattefri. The 20.000 km limit is per year. Add the new year each December.
// The log has the fields skat.dk requires: purpose, destination with stops, date, km, the calculation at the
// rates, and that it was the person's own vehicle
// (https://skat.dk/erhverv/ansatte-og-loen/koerselsgodtgoerelse/dokumentation-og-kontrol-af-koerselsgodtgoerelse).
(function () {
  'use strict';
  var T = window.SrathTools;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'srath-koerebog';
  var RATES = {
    2025: { low: 3.81, high: 2.23, bike: 0.63 },
    2026: { low: 3.94, high: 2.28, bike: 0.64 },
    2027: { low: 4.13, high: 2.44, bike: 0.65 },
  };
  var LIMIT = 20000;

  var state = T.storageGet(KEY) || {};
  state.trips = state.trips || [];
  state.name = state.name || '';
  state.car = state.car || '';
  state.type = state.type || 'car';

  function save() { T.storageSet(KEY, state); }
  function yearOf(iso) { return Number(String(iso).slice(0, 4)); }

  function fillYears() {
    var years = Object.keys(RATES).map(Number);
    var now = new Date().getFullYear();
    var sel = $('kb-year');
    sel.replaceChildren();
    years.forEach(function (y) { var o = document.createElement('option'); o.value = y; o.textContent = y; sel.appendChild(o); });
    sel.value = RATES[now] ? now : years[years.length - 1];
  }

  /** The year's trips in date order, each with its amount: the first 20.000 km at the low-band rate. */
  function priced(year) {
    var r = RATES[year], used = 0;
    return state.trips.filter(function (t) { return yearOf(t.date) === year; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id; })
      .map(function (t) {
        var amount;
        if (state.type === 'bike') amount = t.km * r.bike;
        else {
          var low = Math.max(0, Math.min(t.km, LIMIT - used));
          amount = low * r.low + (t.km - low) * r.high;
        }
        used += t.km;
        return { trip: t, ore: T.toOre(amount) };
      });
  }

  function km(n) { return T.formatNumber(n, n % 1 ? 1 : 0); }

  function render() {
    var year = Number($('kb-year').value);
    var r = RATES[year];
    var rows = priced(year);
    var totalKm = rows.reduce(function (s, x) { return s + x.trip.km; }, 0);
    var totalOre = rows.reduce(function (s, x) { return s + x.ore; }, 0);

    $('kb-hero-label').textContent = T.t('Kørselsgodtgørelse ', 'Mileage allowance ') + year;
    $('kb-total').textContent = T.formatOre(totalOre) + ' kr.';
    $('kb-sub').textContent = km(totalKm) + ' km · ' + rows.length + T.t(rows.length === 1 ? ' tur' : ' ture', rows.length === 1 ? ' trip' : ' trips');
    $('kb-sum-km').textContent = km(totalKm);
    $('kb-sum-kr').textContent = T.formatOre(totalOre);
    $('kb-empty').hidden = rows.length > 0;
    $('kb-rates').textContent = state.type === 'bike'
      ? T.t('Sats ' + year + ': ' + T.formatNumber(r.bike, 2) + ' kr./km for egen cykel eller knallert (skat.dk).', 'Rate ' + year + ': ' + T.formatNumber(r.bike, 2) + ' kr./km for your own bicycle or moped (skat.dk).')
      : T.t('Satser ' + year + ': ' + T.formatNumber(r.low, 2) + ' kr./km for de første 20.000 km, derefter ' + T.formatNumber(r.high, 2) + ' kr./km (skat.dk).',
        'Rates ' + year + ': ' + T.formatNumber(r.low, 2) + ' kr./km for the first 20,000 km, then ' + T.formatNumber(r.high, 2) + ' kr./km (skat.dk).');
    $('kb-print-title').textContent = T.t('Kørebog ', 'Mileage log ') + year;
    $('kb-print-meta').textContent = [state.name, state.car && T.t('Køretøj: ', 'Vehicle: ') + state.car,
      state.type === 'bike' ? T.t('Egen cykel/knallert', 'Own bicycle/moped') : T.t('Egen bil/motorcykel', 'Own car/motorbike')].filter(Boolean).join(' · ');

    var body = $('kb-rows');
    body.replaceChildren();
    rows.forEach(function (x) {
      var t = x.trip, tr = document.createElement('tr');
      var place = (t.from ? t.from + ' → ' : '') + t.to + (t.ret ? T.t(' (tur/retur)', ' (return)') : '');
      [T.showDate(t.date), place, t.purpose, km(t.km), T.formatOre(x.ore)].forEach(function (v, i) {
        var td = document.createElement('td'); td.textContent = v; if (i >= 3) td.className = 'r'; tr.appendChild(td);
      });
      var del = document.createElement('button');
      del.type = 'button'; del.className = 'tl-icon-btn'; del.textContent = '×';
      del.setAttribute('aria-label', T.t('Slet turen', 'Delete the trip'));
      del.addEventListener('click', function () {
        state.trips = state.trips.filter(function (q) { return q.id !== t.id; });
        save(); render();
      });
      var td = document.createElement('td'); td.className = 'kb-del-col'; td.appendChild(del); tr.appendChild(td);
      body.appendChild(tr);
    });
  }

  $('kb-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var kmEl = $('kb-km'), n = T.parseNumber(kmEl.value);
    var ok = !isNaN(n) && n > 0 && n < 5000;
    kmEl.setAttribute('aria-invalid', ok ? 'false' : 'true');
    var date = $('kb-date').value;
    if (!ok || !date || !$('kb-to').value.trim() || !$('kb-purpose').value.trim()) return;
    if (!RATES[yearOf(date)]) { $('kb-date').setAttribute('aria-invalid', 'true'); return; }
    $('kb-date').setAttribute('aria-invalid', 'false');
    var ret = $('kb-return').checked;
    state.trips.push({
      id: Date.now(), date: date, from: $('kb-from').value.trim(), to: $('kb-to').value.trim(),
      purpose: $('kb-purpose').value.trim(), km: Math.round((ret ? n * 2 : n) * 10) / 10, ret: ret,
    });
    save();
    $('kb-year').value = yearOf(date);
    ['kb-km', 'kb-to', 'kb-purpose'].forEach(function (id) { $(id).value = ''; });
    render();
    $('kb-to').focus();
  });

  [['kb-name', 'name'], ['kb-car', 'car']].forEach(function (p) {
    $(p[0]).value = state[p[1]];
    $(p[0]).addEventListener('input', function () { state[p[1]] = this.value; save(); render(); });
  });
  $('kb-type').value = state.type;
  $('kb-type').addEventListener('change', function () { state.type = this.value; save(); render(); });
  $('kb-year').addEventListener('change', render);

  $('kb-clear').addEventListener('click', function () {
    var year = Number($('kb-year').value);
    var n = state.trips.filter(function (t) { return yearOf(t.date) === year; }).length;
    if (!n) return;
    if (!window.confirm(T.t('Slet alle ' + n + ' ture fra ' + year + '? Det kan ikke fortrydes.', 'Delete all ' + n + ' trips from ' + year + '? This cannot be undone.'))) return;
    state.trips = state.trips.filter(function (t) { return yearOf(t.date) !== year; });
    save(); render();
  });

  $('kb-csv').addEventListener('click', function () {
    var year = Number($('kb-year').value);
    var head = T.t(['Dato', 'Fra', 'Mål og delmål', 'Formål', 'Tur/retur', 'Km', 'Beløb (kr.)'], ['Date', 'From', 'Destination and stops', 'Purpose', 'Return', 'Km', 'Amount (kr.)']);
    var lines = [head.join(';')].concat(priced(year).map(function (x) {
      var t = x.trip;
      return [t.date, t.from, t.to, t.purpose, t.ret ? T.t('ja', 'yes') : '', String(t.km).replace('.', ','), (x.ore / 100).toFixed(2).replace('.', ',')].map(T.csvCell).join(';');
    }));
    T.download(T.t('koerebog-', 'mileage-log-') + year + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  });

  /** The year's log as a PDF: a table that continues on new pages, with the totals and the rates used. */
  function pdf() {
    var year = Number($('kb-year').value), r = RATES[year], rows = priced(year);
    var doc = window.SrathPDF.create();
    var INK = [27, 31, 39], GREY = [107, 114, 128], LINE = [229, 231, 235], AMBER = [232, 163, 61];
    var L = 44, R = doc.width - 44, BOTTOM = doc.height - 56;
    // Columns: date, route, purpose, km (right edge), amount (right edge).
    var X = { date: L, route: L + 62, purpose: L + 268, km: R - 78, amount: R };
    var W_ROUTE = X.purpose - X.route - 12, W_PURPOSE = X.km - 40 - X.purpose;
    var y = 52, page = 1;

    function head() {
      doc.text(T.t('Kørebog ', 'Mileage log ') + year, L, y + 18, { size: 22, bold: true, color: INK });
      doc.rect(L, y + 28, 36, 3, AMBER);
      var who = [state.name, state.car && T.t('Køretøj: ', 'Vehicle: ') + state.car,
        state.type === 'bike' ? T.t('Kørsel i egen cykel/knallert', 'Driving in own bicycle/moped') : T.t('Kørsel i egen bil/motorcykel', 'Driving in own car/motorbike')].filter(Boolean).join('   ·   ');
      doc.text(who, L, y + 50, { size: 9.5, color: INK });
      if (page > 1) doc.text(T.t('Side ', 'Page ') + page, R, y + 18, { size: 9, color: GREY, align: 'right' });
      y += 78;
      [[T.t('Dato', 'Date'), X.date], [T.t('Fra – mål og delmål', 'From – destination and stops'), X.route], [T.t('Formål', 'Purpose'), X.purpose]].forEach(function (c) {
        doc.text(c[0].toUpperCase(), c[1], y, { size: 7.5, bold: true, color: GREY });
      });
      doc.text('KM', X.km, y, { size: 7.5, bold: true, color: GREY, align: 'right' });
      doc.text(T.t('BELØB (KR.)', 'AMOUNT (KR.)'), X.amount, y, { size: 7.5, bold: true, color: GREY, align: 'right' });
      y += 7;
      doc.line(L, y, R, y, { width: 1.2, color: INK });
      y += 15;
    }
    head();
    rows.forEach(function (x) {
      var t = x.trip;
      var route = (t.from ? t.from + ' – ' : '') + t.to + (t.ret ? T.t(' (tur/retur)', ' (return)') : '');
      var h = Math.max(doc.measure(route, { size: 9, maxWidth: W_ROUTE }), doc.measure(t.purpose, { size: 9, maxWidth: W_PURPOSE }));
      if (y + h > BOTTOM) { doc.addPage(); page += 1; y = 52; head(); }
      doc.text(T.showDate(t.date), X.date, y, { size: 9, color: INK });
      doc.text(route, X.route, y, { size: 9, color: INK, maxWidth: W_ROUTE });
      doc.text(t.purpose, X.purpose, y, { size: 9, color: INK, maxWidth: W_PURPOSE });
      doc.text(km(t.km), X.km, y, { size: 9, color: INK, align: 'right' });
      doc.text(T.formatOre(x.ore), X.amount, y, { size: 9, color: INK, align: 'right' });
      y += h - 4;
      doc.line(L, y, R, y, { width: 0.5, color: LINE });
      y += 14;
    });
    if (y + 70 > BOTTOM) { doc.addPage(); page += 1; y = 52; head(); }
    var totalKm = rows.reduce(function (s, x) { return s + x.trip.km; }, 0);
    var totalOre = rows.reduce(function (s, x) { return s + x.ore; }, 0);
    y += 2;
    doc.text(T.t('I alt', 'Total'), X.date, y, { size: 10.5, bold: true, color: INK });
    doc.text(km(totalKm), X.km, y, { size: 10.5, bold: true, color: INK, align: 'right' });
    doc.text(T.formatOre(totalOre), X.amount, y, { size: 10.5, bold: true, color: INK, align: 'right' });
    y += 24;
    doc.text($('kb-rates').textContent, L, y, { size: 8.5, color: GREY, maxWidth: R - L });
    return doc;
  }

  var pageTitle = document.title;
  $('kb-pdf').addEventListener('click', function () {
    pdf().save(T.t('Kørebog ', 'Mileage log ') + $('kb-year').value + (state.name ? ' - ' + state.name : ''));
  });
  $('kb-print').addEventListener('click', function () {
    document.title = T.t('Kørebog ', 'Mileage log ') + $('kb-year').value + (state.name ? ' - ' + state.name : '');
    document.body.classList.add('kb-printing');
    window.print();
  });
  window.addEventListener('afterprint', function () { document.body.classList.remove('kb-printing'); document.title = pageTitle; });

  $('kb-date').value = T.isoDate();
  fillYears();
  T.onLang(function () { pageTitle = document.title; render(); });
  render();
})();
