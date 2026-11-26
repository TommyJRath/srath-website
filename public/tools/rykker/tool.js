// Rykkergenerator: a payment reminder with the legal fees and late-payment interest, saved as PDF.
//
// Rules (renteloven, LBK nr 459 af 13/05/2014, https://www.retsinformation.dk/eli/lta/2014/459):
//   § 3: interest runs from the due date.
//   § 5: yearly interest = Nationalbanken's official lending rate on 1 January / 1 July + 8 percentage points.
//   § 9 b: reminder fee at most 100 kr. per reminder, at most 3 reminders, sent at least 10 days apart.
//   § 9 a, stk. 3 + BEK nr 105 af 31/01/2013 (https://www.retsinformation.dk/eli/lta/2013/105): a fixed
//   compensation fee of 310 kr., not for consumer agreements.
// Reference rates from Nationalbanken (udlånsrente 1.75 % on 1 Jan 2026, 2.00 % on 1 Jul 2026), matching
// forbrug.dk's morarente table. Add the next half-year in January and July.
// Interest is simple interest per day on a 365-day year. Nothing is stored.
(function () {
  'use strict';
  var T = window.SrathTools;
  var $ = function (id) { return document.getElementById(id); };
  var form = $('rk-form');
  var paper = $('rk-paper');
  var who = 'b2b';
  var model = null; // what the preview shows; also what the PDF is built from
  var logo = null;  // from the invoice generator, if it remembers your details
  var RATES = [ // [from (ISO date), yearly interest rate in %]
    ['2026-01-01', 9.75],
    ['2026-07-01', 10.00],
  ];
  var KNOWN_UNTIL = '2026-12-31';

  function field(name) { return form.querySelector('[data-f="' + name + '"]'); }
  function val(name) { return field(name).value.trim(); }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (k === 'text') node.textContent = attrs[k]; else node.setAttribute(k, attrs[k]); });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }
  function addDays(iso, days) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + days); return T.isoDate(d); }
  function dayDiff(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000); }

  /** Interest (øre) on `ore` from the day after `from` to `to`, split over the half-year rate periods. */
  function interest(ore, from, to) {
    var parts = [], total = 0;
    if (!(dayDiff(from, to) > 0)) return { ore: 0, parts: parts, days: 0 };
    for (var i = 0; i < RATES.length; i++) {
      var start = RATES[i][0], end = i + 1 < RATES.length ? RATES[i + 1][0] : '9999-12-31';
      var a = from > start ? from : addDays(start, -1); // interest for the days after `a`
      var b = to < end ? to : addDays(end, -1);
      var days = dayDiff(a, b);
      if (days <= 0) continue;
      var amount = ore * RATES[i][1] / 100 * days / 365;
      parts.push({ rate: RATES[i][1], days: days });
      total += amount;
    }
    return { ore: Math.round(total), parts: parts, days: dayDiff(from, to) };
  }

  function render() {
    var err = [];
    var amountKr = T.parseNumber(val('amount'));
    var ore = isNaN(amountKr) ? 0 : T.toOre(amountKr);
    var nr = Number(val('nr'));
    var date = val('date') || T.isoDate();
    var due = val('due');
    var days = parseInt(val('days'), 10);
    if (!(days >= 1)) days = 10;
    var b2b = who === 'b2b';
    $('rk-comp-row').hidden = !b2b;
    $('rk-earlier-fields').hidden = !$('rk-earlier').checked;

    var lines = [[T.t('Skyldigt beløb, faktura nr. ', 'Amount owed, invoice no. ') + (val('no') || '–'), ore]];
    if ($('rk-earlier').checked) {
      var earlier = T.parseNumber(val('earlier'));
      if (!isNaN(earlier) && earlier > 0) lines.push([T.t('Gebyrer og renter fra tidligere rykkere', 'Fees and interest from earlier reminders'), T.toOre(earlier)]);
    }
    if ($('rk-fee').checked) lines.push([T.t('Rykkergebyr (momsfrit)', 'Reminder fee (no VAT)'), 10000]);
    if (b2b && $('rk-comp').checked) lines.push([T.t('Kompensationsbeløb, renteloven § 9 a', 'Compensation fee, renteloven § 9 a'), 31000]);
    var intText = '';
    if ($('rk-interest').checked && due && ore) {
      if (due < RATES[0][0]) err.push(T.t('Værktøjet kender kun renten fra 1. januar 2026. Forfaldsdatoen ligger før.', 'The tool only knows the interest rate from 1 January 2026. The due date is earlier.'));
      else if (date > due) {
        var it = interest(ore, due, date);
        if (it.ore > 0) {
          lines.push([T.t('Morarente', 'Late-payment interest'), it.ore]);
          intText = it.parts.map(function (p) { return T.formatNumber(p.rate, 2) + ' % p.a. ' + T.t('i ', 'for ') + p.days + T.t(' dage', ' days'); }).join(' + ');
        }
        if (date > KNOWN_UNTIL) err.push(T.t('Renten efter 31. december 2026 er ikke lagt ind endnu. Værktøjet bruger 10,00 % for de dage.', 'The interest rate after 31 December 2026 is not in the tool yet. It uses 10.00 % for those days.'));
      }
    }
    if (due && date <= due) err.push(T.t('Rykkerens dato skal ligge efter forfaldsdatoen.', 'The reminder date must be after the due date.'));
    var total = lines.reduce(function (s, l) { return s + l[1]; }, 0);
    $('rk-error').hidden = !err.length;
    $('rk-error').textContent = err.join(' ');

    var title = T.t('Rykker ', 'Reminder ') + nr;
    var payBy = addDays(date, days);
    var invRef = (val('no') ? T.t('faktura nr. ', 'invoice no. ') + val('no') : T.t('fakturaen', 'the invoice')) + (val('invDate') ? T.t(' af ', ' of ') + T.showDate(val('invDate')) : '');
    var intro = [
      T.t('Vi har endnu ikke modtaget betaling for ', 'We have not yet received payment for ') + invRef +
        (due ? T.t(', som forfaldt ', ', which was due on ') + T.showDate(due) : '') + '.',
      nr === 1 ? T.t('Det kan være en forglemmelse. Hvis du allerede har betalt, kan du se bort fra denne rykker.', 'It may be an oversight. If you have already paid, please ignore this reminder.')
        : nr === 2 ? T.t('Vi har tidligere sendt en rykker uden at have modtaget betaling.', 'We have sent an earlier reminder without receiving payment.')
          : T.t('Dette er sidste rykker. Hvis beløbet ikke er betalt senest ' + T.showDate(payBy) + ', sender vi kravet til inkasso, hvilket medfører yderligere omkostninger.',
            'This is the final reminder. If the amount is not paid by ' + T.showDate(payBy) + ', we will pass the claim to a debt collector, which will add further costs.'),
    ];

    var sellerLines = [val('sAddr'), val('sCvr') && 'CVR ' + val('sCvr')].filter(Boolean).join('\n');
    var small = intText ? T.t('Morarente efter renteloven: ', 'Late-payment interest under the Danish Interest Act: ') + intText + T.t(', fra forfaldsdagen til rykkerens dato.', ', from the due date to the date of this reminder.') : '';
    var payText = val('sPay') ? val('sPay') + T.t('\nAngiv fakturanr. ', '\nPlease quote invoice no. ') + (val('no') || '') + T.t(' ved betaling.', ' with your payment.') : '';
    // The same content as the preview, for the PDF.
    model = {
      title: title, logo: logo,
      seller: { name: val('sName') || T.t('Dit firma', 'Your business'), lines: sellerLines },
      buyer: { label: T.t('Til', 'To'), name: val('bName') || T.t('Kundens navn', 'Customer name'), lines: val('bAddr') },
      meta: [[T.t('Dato', 'Date'), T.showDate(date)], [T.t('Betal senest', 'Pay by'), T.showDate(payBy)]],
      intro: intro,
      totals: lines.map(function (l) { return [l[0], T.formatOre(l[1]) + ' kr.']; }).concat([[T.t('I alt at betale', 'Total to pay'), T.formatOre(total) + ' kr.', true]]),
      small: small,
      foot: payText ? [{ label: T.t('Betaling', 'Payment'), text: payText }] : [],
    };
    paper.replaceChildren(
      el('div', { class: 'inv-head' }, [
        el('div', null, [el('h2', { text: title }), el('div', { class: 'inv-accent' })]),
        el('div', { class: 'inv-seller' }, [logo ? el('img', { class: 'inv-logo-img', src: logo.dataUrl, alt: '' }) : null, el('strong', { text: val('sName') || T.t('Dit firma', 'Your business') }), sellerLines ? '\n' + sellerLines : '']),
      ]),
      el('div', { class: 'inv-parties' }, [
        el('div', { class: 'inv-buyer' }, [el('strong', { text: val('bName') || T.t('Kundens navn', 'Customer name') }), val('bAddr') ? '\n' + val('bAddr') : '']),
        el('table', { class: 'inv-meta' }, [el('tbody', null, [
          el('tr', null, [el('td', { text: T.t('Dato', 'Date') }), el('td', { text: T.showDate(date) })]),
          el('tr', null, [el('td', { text: T.t('Betal senest', 'Pay by') }), el('td', { text: T.showDate(payBy) })]),
        ])]),
      ]),
      el('div', { class: 'rk-letter' }, intro.map(function (p) { return el('p', { text: p }); })),
      el('table', { class: 'inv-totals rk-totals' }, [el('tbody', null, lines.map(function (l) {
        return el('tr', null, [el('td', { text: l[0] }), el('td', { text: T.formatOre(l[1]) + ' kr.' })]);
      }).concat([el('tr', { class: 'inv-grand' }, [el('td', { text: T.t('I alt at betale', 'Total to pay') }), el('td', { text: T.formatOre(total) + ' kr.' })])]))]),
      small ? el('p', { class: 'rk-small', text: small }) : null,
      el('div', { class: 'inv-foot' }, [
        payText ? el('div', null, [el('p', { class: 'inv-label', text: T.t('Betaling', 'Payment') }), el('div', { text: payText })]) : null,
      ])
    );
  }

  function setWho(next) {
    who = next;
    form.querySelectorAll('[data-who]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-who') === who)); });
    render();
  }
  form.querySelectorAll('[data-who]').forEach(function (b) { b.addEventListener('click', function () { setWho(b.getAttribute('data-who')); }); });
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  form.addEventListener('input', render);
  form.addEventListener('change', render);

  var pageTitle = document.title;
  function fileName() {
    return T.t('Rykker ', 'Reminder ') + val('nr') + ' - ' + T.t('faktura ', 'invoice ') + (val('no') || '') + (val('bName') ? ' - ' + val('bName') : '');
  }
  $('rk-pdf').addEventListener('click', function () {
    render();
    window.SrathPDF.businessDoc(model).save(fileName());
  });
  $('rk-print').addEventListener('click', function () {
    document.title = fileName();
    document.body.classList.add('inv-printing');
    window.print();
  });
  window.addEventListener('afterprint', function () { document.body.classList.remove('inv-printing'); document.title = pageTitle; });

  // Your details from the invoice generator, if you let it remember them (read only).
  var saved = T.storageGet('srath-faktura');
  if (saved) {
    ['sName', 'sCvr', 'sAddr', 'sPay'].forEach(function (k) { if (typeof saved[k] === 'string') field(k).value = saved[k]; });
    if (saved.logo && saved.logo.dataUrl) logo = saved.logo;
    $('rk-from-invoice').hidden = false;
  }
  field('date').value = T.isoDate();
  T.onLang(function () { pageTitle = document.title; render(); });
  setWho('b2b');
})();
