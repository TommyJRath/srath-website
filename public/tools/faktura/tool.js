// Faktura- og tilbudsgenerator: a Danish invoice or quote, laid out in HTML and saved as PDF with the
// browser's print dialog. Only the sender's own details and the next number are ever stored, and only
// when "Husk mine oplysninger" is ticked. The customer and the lines are never stored.
(function () {
  'use strict';
  var T = window.SrathTools;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'srath-faktura';
  var SELLER = ['sName', 'sCvr', 'sAddr', 'sEmail', 'sPhone', 'sPay'];
  var form = $('inv-form');
  var paper = $('inv-paper');
  var doc = 'faktura';

  function field(name) { return form.querySelector('[data-f="' + name + '"]'); }
  function val(name) { return field(name).value.trim(); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k]; else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function isoToday() {
    var d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function addDays(iso, days) {
    var d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
  /** "23.11.2026" in Danish, "23 Nov 2026" in English. */
  function showDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    var p = iso.split('-');
    if (T.lang() !== 'en') return Number(p[2]) + '.' + Number(p[1]) + '.' + p[0];
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Lines ----------------------------------------------------------------------
  function addLine(desc, qty, price) {
    var row = el('div', { class: 'tl-row inv-line' }, [
      el('textarea', { class: 'tl-textarea', rows: '1', 'aria-label': T.t('Beskrivelse', 'Description'), 'data-l': 'desc', style: 'min-height:42px' }),
      el('input', { class: 'tl-input tl-num', inputmode: 'decimal', 'aria-label': T.t('Antal', 'Quantity'), 'data-l': 'qty' }),
      el('input', { class: 'tl-input tl-num', inputmode: 'decimal', 'aria-label': T.t('Pris pr. stk. uden moms', 'Unit price without VAT'), 'data-l': 'price' }),
      el('button', { type: 'button', class: 'tl-icon-btn', 'aria-label': T.t('Fjern linje', 'Remove line'), title: T.t('Fjern linje', 'Remove line'), text: '×' }),
    ]);
    row.querySelector('[data-l="desc"]').value = desc || '';
    row.querySelector('[data-l="qty"]').value = qty == null ? '1' : qty;
    row.querySelector('[data-l="price"]').value = price || '';
    row.querySelector('button').addEventListener('click', function () {
      row.remove();
      if (!$('inv-lines').children.length) addLine();
      render();
    });
    $('inv-lines').appendChild(row);
    return row;
  }

  function readLines() {
    return Array.prototype.map.call($('inv-lines').children, function (row) {
      var desc = row.querySelector('[data-l="desc"]').value.trim();
      var qtyEl = row.querySelector('[data-l="qty"]');
      var priceEl = row.querySelector('[data-l="price"]');
      var qty = T.parseNumber(qtyEl.value);
      var price = T.parseNumber(priceEl.value);
      qtyEl.setAttribute('aria-invalid', qtyEl.value.trim() && isNaN(qty) ? 'true' : 'false');
      priceEl.setAttribute('aria-invalid', priceEl.value.trim() && isNaN(price) ? 'true' : 'false');
      if (isNaN(qty)) qty = 0;
      if (isNaN(price)) price = 0;
      return { desc: desc, qty: qty, price: price, total: T.toOre(qty * price) };
    }).filter(function (l) { return l.desc || l.total; });
  }

  // Preview ----------------------------------------------------------------------
  function render() {
    var isInvoice = doc === 'faktura';
    var vat = $('inv-vat').checked;
    var lines = readLines();
    var date = val('date') || isoToday();
    var sub = lines.reduce(function (s, l) { return s + l.total; }, 0);
    var vatOre = vat ? Math.round(sub * 0.25) : 0;
    var title = isInvoice ? T.t('Faktura', 'Invoice') : T.t('Tilbud', 'Quote');
    var terms = parseInt(val('terms'), 10);
    var valid = parseInt(val('valid'), 10);

    var sellerLines = [val('sAddr'), val('sCvr') && 'CVR ' + val('sCvr'), val('sEmail'), val('sPhone')].filter(Boolean).join('\n');
    var buyerLines = [val('bAddr'), val('bCvr') && 'CVR ' + val('bCvr'), val('bRef') && T.t('Att.: ', 'Attn.: ') + val('bRef')].filter(Boolean).join('\n');

    var meta = [[isInvoice ? T.t('Fakturanr.', 'Invoice no.') : T.t('Tilbudsnr.', 'Quote no.'), val('no') || '–'], [isInvoice ? T.t('Fakturadato', 'Invoice date') : T.t('Dato', 'Date'), showDate(date)]];
    if (isInvoice && val('delivery')) meta.push([T.t('Leveringsdato', 'Delivery date'), showDate(val('delivery'))]);
    if (isInvoice && terms >= 0) meta.push([T.t('Forfaldsdato', 'Due date'), showDate(addDays(date, terms))]);
    if (!isInvoice && valid > 0) meta.push([T.t('Gælder til', 'Valid until'), showDate(addDays(date, valid))]);

    var rows = lines.length ? lines.map(function (l) {
      return el('tr', null, [
        el('td', { text: l.desc }),
        el('td', { class: 'r', text: T.formatNumber(l.qty, l.qty % 1 ? 2 : 0) }),
        el('td', { class: 'r', text: T.formatOre(T.toOre(l.price)) }),
        el('td', { class: 'r', text: T.formatOre(l.total) }),
      ]);
    }) : [el('tr', null, [el('td', { colspan: '4', class: 'inv-empty', text: T.t('Tilføj en linje til venstre.', 'Add a line on the left.') })])];

    var totals = [];
    if (vat) {
      totals.push(el('tr', null, [el('td', { text: T.t('Beløb uden moms', 'Subtotal without VAT') }), el('td', { text: T.formatOre(sub) + ' kr.' })]));
      totals.push(el('tr', null, [el('td', { text: T.t('Moms 25 %', 'VAT 25 %') }), el('td', { text: T.formatOre(vatOre) + ' kr.' })]));
    }
    totals.push(el('tr', { class: 'inv-grand' }, [el('td', { text: isInvoice ? T.t('At betale', 'Amount due') : T.t('Pris i alt', 'Total price') }), el('td', { text: T.formatOre(sub + vatOre) + ' kr.' })]));

    var foot = [];
    if (isInvoice && val('sPay')) {
      foot.push(el('div', null, [el('p', { class: 'inv-label', text: T.t('Betaling', 'Payment') }), el('div', {
        text: val('sPay') + (terms >= 0 ? T.t('\nBetales senest ', '\nPlease pay by ') + showDate(addDays(date, terms)) + T.t('. Angiv fakturanr. ', '. Please quote invoice no. ') + (val('no') || '') + T.t(' ved betaling.', ' with your payment.') : ''),
      })]));
    }
    if (!vat) foot.push(el('div', { text: T.t('Der er ikke beregnet moms.', 'No VAT has been charged.') }));
    if (val('note')) foot.push(el('div', { text: val('note') }));

    paper.replaceChildren(
      el('div', { class: 'inv-head' }, [
        el('div', null, [el('h2', { text: title }), el('div', { class: 'inv-accent' })]),
        el('div', { class: 'inv-seller' }, [el('strong', { text: val('sName') || T.t('Dit firma', 'Your business') }), document.createTextNode(sellerLines ? '\n' + sellerLines : '')]),
      ]),
      el('div', { class: 'inv-parties' }, [
        el('div', null, [
          el('p', { class: 'inv-label', text: isInvoice ? T.t('Faktureres til', 'Bill to') : T.t('Tilbud til', 'Quote for') }),
          el('div', { class: 'inv-buyer' }, [el('strong', { text: val('bName') || T.t('Kundens navn', 'Customer name') }), document.createTextNode(buyerLines ? '\n' + buyerLines : '')]),
        ]),
        el('table', { class: 'inv-meta' }, [el('tbody', null, meta.map(function (m) {
          return el('tr', null, [el('td', { text: m[0] }), el('td', { text: m[1] })]);
        }))]),
      ]),
      el('table', { class: 'inv-table' }, [
        el('thead', null, [el('tr', null, [
          el('th', { text: T.t('Beskrivelse', 'Description') }), el('th', { class: 'r', text: T.t('Antal', 'Qty') }),
          el('th', { class: 'r', text: T.t('Pris', 'Price') }), el('th', { class: 'r', text: T.t('Beløb', 'Amount') }),
        ])]),
        el('tbody', null, rows),
      ]),
      el('table', { class: 'inv-totals' }, [el('tbody', null, totals)]),
      foot.length ? el('div', { class: 'inv-foot' }, foot) : null
    );
    save();
  }

  // Remember (opt-in) ----------------------------------------------------------------
  function save() {
    if (!$('inv-remember').checked) return;
    var data = { terms: val('terms'), vat: $('inv-vat').checked, no: val('no') };
    SELLER.forEach(function (k) { data[k] = field(k).value; });
    T.storageSet(KEY, data);
  }
  function restore() {
    var data = T.storageGet(KEY);
    if (!data) return;
    $('inv-remember').checked = true;
    SELLER.forEach(function (k) { if (typeof data[k] === 'string') field(k).value = data[k]; });
    if (data.terms) field('terms').value = data.terms;
    if (data.no) field('no').value = data.no;
    if (typeof data.vat === 'boolean') $('inv-vat').checked = data.vat;
  }

  function nextNumber(no) {
    // Keeps any prefix and zero padding: "2026-007" becomes "2026-008".
    var m = /^(.*?)(\d+)$/.exec(no);
    if (!m) return no;
    var n = String(Number(m[2]) + 1);
    while (n.length < m[2].length) n = '0' + n;
    return m[1] + n;
  }

  function setDoc(next) {
    doc = next;
    var isInvoice = doc === 'faktura';
    form.querySelectorAll('[data-doc]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-doc') === doc)); });
    $('inv-meta-title').textContent = isInvoice ? T.t('Faktura', 'Invoice') : T.t('Tilbud', 'Quote');
    $('inv-no-label').textContent = isInvoice ? T.t('Fakturanummer', 'Invoice number') : T.t('Tilbudsnummer', 'Quote number');
    $('inv-f-delivery').hidden = !isInvoice;
    $('inv-f-terms').hidden = !isInvoice;
    $('inv-f-valid').hidden = isInvoice;
    $('inv-new').textContent = isInvoice ? T.t('Ny faktura', 'New invoice') : T.t('Nyt tilbud', 'New quote');
    render();
  }

  // Events ------------------------------------------------------------------
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  form.addEventListener('input', render);
  form.addEventListener('change', render);
  form.querySelectorAll('[data-doc]').forEach(function (b) {
    b.addEventListener('click', function () { setDoc(b.getAttribute('data-doc')); });
  });
  $('inv-add').addEventListener('click', function () { addLine().querySelector('textarea').focus(); render(); });
  $('inv-remember').addEventListener('change', function () {
    if (!this.checked) T.storageSet(KEY, null);
    render();
  });
  $('inv-print').addEventListener('click', function () {
    var name = (doc === 'faktura' ? T.t('Faktura ', 'Invoice ') : T.t('Tilbud ', 'Quote ')) + (val('no') || '') + (val('bName') ? ' - ' + val('bName') : '');
    document.title = name.trim(); // Most browsers use the page title as the suggested PDF file name.
    document.body.classList.add('inv-printing');
    window.print();
  });
  window.addEventListener('afterprint', function () {
    document.body.classList.remove('inv-printing');
    document.title = pageTitle;
  });
  $('inv-new').addEventListener('click', function () {
    ['bName', 'bCvr', 'bAddr', 'bRef', 'note', 'delivery'].forEach(function (k) { field(k).value = ''; });
    field('no').value = nextNumber(val('no'));
    field('date').value = isoToday();
    $('inv-lines').replaceChildren();
    addLine();
    render();
    field('bName').focus();
  });

  // Start -------------------------------------------------------------------
  var pageTitle = document.title;
  T.onLang(function () {
    pageTitle = document.title;
    // Line inputs are built by this script, so their labels are refreshed here.
    Array.prototype.forEach.call($('inv-lines').children, function (row) {
      row.querySelector('[data-l="desc"]').setAttribute('aria-label', T.t('Beskrivelse', 'Description'));
      row.querySelector('[data-l="qty"]').setAttribute('aria-label', T.t('Antal', 'Quantity'));
      row.querySelector('[data-l="price"]').setAttribute('aria-label', T.t('Pris pr. stk. uden moms', 'Unit price without VAT'));
      var b = row.querySelector('button');
      b.setAttribute('aria-label', T.t('Fjern linje', 'Remove line'));
      b.setAttribute('title', T.t('Fjern linje', 'Remove line'));
    });
    setDoc(doc);
  });
  field('date').value = isoToday();
  restore();
  addLine('', '1', '');
  setDoc('faktura');
})();
