// Frister: the Danish VAT deadlines (indberet og betal senest) and the user's own dates, as a list and as an
// .ics calendar file. VAT dates from https://skat.dk/erhverv/moms/frister-indberet-og-betal-moms (read
// 23 November 2026; the page lists periods from October 2026 to December 2027). Add the next year's dates when
// skat.dk publishes them. B-skat dates are personal (TastSelv), so the user adds them.
(function () {
  'use strict';
  var T = window.SrathTools;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'srath-frister';
  var VAT = {
    half: [
      ['2026-07', '2027-03-01'], ['2027-01', '2027-09-01'], ['2027-07', '2028-03-01'],
    ],
    quarter: [
      ['2026-Q3', '2026-12-01'], ['2026-Q4', '2027-03-01'], ['2027-Q1', '2027-06-01'],
      ['2027-Q2', '2027-09-01'], ['2027-Q3', '2027-12-01'], ['2027-Q4', '2028-03-01'],
    ],
    month: [
      ['2026-10', '2026-11-25'], ['2026-11', '2026-12-28'], ['2026-12', '2027-01-25'],
      ['2027-01', '2027-02-25'], ['2027-02', '2027-03-30'], ['2027-03', '2027-04-26'],
      ['2027-04', '2027-05-25'], ['2027-05', '2027-06-25'], ['2027-06', '2027-08-18'],
      ['2027-07', '2027-08-25'], ['2027-08', '2027-09-27'], ['2027-09', '2027-10-25'],
      ['2027-10', '2027-11-25'], ['2027-11', '2027-12-27'], ['2027-12', '2028-01-25'],
    ],
  };
  var MONTHS = {
    da: ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'],
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  };

  var state = T.storageGet(KEY) || {};
  state.period = state.period || 'quarter';
  state.own = state.own || [];
  function save() { T.storageSet(KEY, state); }

  function periodName(kind, code) {
    var y = code.slice(0, 4);
    if (kind === 'quarter') { var q = code.slice(-1); return T.t(q + '. kvartal ' + y, 'Q' + q + ' ' + y); }
    var m = Number(code.slice(5, 7));
    if (kind === 'half') return m === 1 ? T.t('1. halvår ' + y, 'First half of ' + y) : T.t('2. halvår ' + y, 'Second half of ' + y);
    var name = MONTHS[T.lang() === 'en' ? 'en' : 'da'][m - 1];
    return T.t(name + ' ' + y, name + ' ' + y);
  }

  /** All coming deadlines: VAT for the chosen period type, and the user's own dates. */
  function items() {
    var today = T.isoDate();
    var vat = VAT[state.period].map(function (p) {
      return { date: p[1], title: T.t('Moms for ', 'VAT for ') + periodName(state.period, p[0]), detail: T.t('Indberet og betal senest i dag', 'Report and pay by today'), kind: 'vat' };
    });
    var own = state.own.map(function (o) { return { date: o.date, title: o.text, detail: '', kind: 'own', id: o.id }; });
    return vat.concat(own).filter(function (i) { return i.date >= today; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }

  function daysUntil(iso) { return Math.round((new Date(iso + 'T12:00:00') - new Date(T.isoDate() + 'T12:00:00')) / 86400000); }

  function render() {
    document.querySelectorAll('[data-period]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-period') === state.period)); });
    var list = $('fr-list');
    list.replaceChildren();
    items().forEach(function (i) {
      var li = document.createElement('li');
      li.className = 'fr-item fr-' + i.kind;
      var d = daysUntil(i.date);
      var when = d === 0 ? T.t('i dag', 'today') : d === 1 ? T.t('i morgen', 'tomorrow') : T.t('om ' + d + ' dage', 'in ' + d + ' days');
      li.innerHTML = '<span class="fr-date"></span><span class="fr-title"></span><span class="fr-when"></span>';
      li.querySelector('.fr-date').textContent = T.showDate(i.date);
      li.querySelector('.fr-title').textContent = i.title;
      li.querySelector('.fr-when').textContent = when;
      if (i.kind === 'own') {
        var del = document.createElement('button');
        del.type = 'button'; del.className = 'tl-icon-btn'; del.textContent = '×';
        del.setAttribute('aria-label', T.t('Slet', 'Delete') + ' ' + i.title);
        del.addEventListener('click', function () { state.own = state.own.filter(function (o) { return o.id !== i.id; }); save(); render(); });
        li.appendChild(del);
      }
      list.appendChild(li);
    });
    $('fr-source').textContent = T.t(
      'Momsfristerne er fra skat.dk (læst november 2026) og går til marts 2028. Falder en frist på en weekend eller helligdag, har Skattestyrelsen allerede flyttet den.',
      'The VAT deadlines are from skat.dk (read November 2026) and run to March 2028. Where a deadline falls on a weekend or public holiday, the Danish Tax Agency has already moved it.');
  }

  function ics() {
    var alarm = Number($('fr-alarm').value);
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    var esc = function (s) { return String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, '\\$&').replace(/\n/g, '\\n'); };
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//srath.dk//Frister//DA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:' + esc(T.t('Frister', 'Deadlines'))];
    items().forEach(function (i, n) {
      var d = i.date.replace(/-/g, '');
      var next = T.isoDate(new Date(new Date(i.date + 'T12:00:00').getTime() + 86400000)).replace(/-/g, '');
      lines.push('BEGIN:VEVENT', 'UID:' + d + '-' + n + '-' + i.kind + '@srath.dk', 'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + next, 'SUMMARY:' + esc(i.title),
        i.detail ? 'DESCRIPTION:' + esc(i.detail) : null,
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(i.title), 'TRIGGER:-P' + alarm + 'D', 'END:VALARM', 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.filter(Boolean).join('\r\n') + '\r\n';
  }

  document.querySelectorAll('[data-period]').forEach(function (b) {
    b.addEventListener('click', function () { state.period = b.getAttribute('data-period'); save(); render(); });
  });
  $('fr-own').addEventListener('submit', function (e) {
    e.preventDefault();
    var date = $('fr-own-date').value, text = $('fr-own-text').value.trim();
    if (!date || !text) return;
    state.own.push({ id: Date.now(), date: date, text: text });
    $('fr-own-text').value = '';
    save(); render();
  });
  $('fr-ics').addEventListener('click', function () { T.download(T.t('frister.ics', 'deadlines.ics'), ics(), 'text/calendar;charset=utf-8'); });
  T.onLang(render);
  render();
})();
