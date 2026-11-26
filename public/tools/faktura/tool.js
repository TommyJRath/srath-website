// Faktura- og tilbudsgenerator: a Danish invoice or quote, laid out in HTML and saved as PDF with the
// browser's print dialog. Stored in this browser only: the sender's own details and the next number (only
// when "Husk mine oplysninger" is ticked) and customers the user saves with "Gem kunde". Lines are never stored.
// VAT: 25 % Danish VAT, none, or an EU business customer (reverse charge for services, VAT-exempt goods), with
// the wording skat.dk asks for on the invoice.
(function () {
  'use strict';
  var T = window.SrathTools;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'srath-faktura';
  var CUSTOMERS_KEY = 'srath-faktura-kunder';
  var DRAFT_KEY = 'srath-faktura-kladde'; // sessionStorage: the invoice you are working on, until the tab closes
  var CUSTOMER_FIELDS = ['bName', 'bCvr', 'bAddr', 'bRef'];
  var SELLER = ['sName', 'sCvr', 'sAddr', 'sEmail', 'sPhone', 'sPay'];
  var form = $('inv-form');
  var paper = $('inv-paper');
  var doc = 'faktura';
  var model = null;  // what the preview shows; also what the PDF is built from
  var logo = null;   // { dataUrl, width, height }, a JPEG made in the browser

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
  function addLine(desc, qty, price, noVat) {
    var row = el('div', { class: 'tl-row inv-line' }, [
      el('textarea', { class: 'tl-textarea', rows: '1', 'aria-label': T.t('Beskrivelse', 'Description'), 'data-l': 'desc', style: 'min-height:42px' }),
      el('input', { class: 'tl-input tl-num', inputmode: 'decimal', 'aria-label': T.t('Antal', 'Quantity'), 'data-l': 'qty' }),
      el('input', { class: 'tl-input tl-num', inputmode: 'decimal', 'aria-label': T.t('Pris pr. stk. uden moms', 'Unit price without VAT'), 'data-l': 'price' }),
      el('label', { class: 'inv-line-vat', title: T.t('Moms på denne linje', 'VAT on this line') }, [
        el('input', { type: 'checkbox', 'data-l': 'vat', 'aria-label': T.t('Moms på denne linje', 'VAT on this line') }),
      ]),
      el('button', { type: 'button', class: 'tl-icon-btn', 'aria-label': T.t('Fjern linje', 'Remove line'), title: T.t('Fjern linje', 'Remove line'), text: '×' }),
    ]);
    row.querySelector('[data-l="desc"]').value = desc || '';
    row.querySelector('[data-l="qty"]').value = qty == null ? '1' : qty;
    row.querySelector('[data-l="price"]').value = price || '';
    row.querySelector('[data-l="vat"]').checked = !noVat;
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
      return { desc: desc, qty: qty, price: price, total: T.toOre(qty * price), vat: row.querySelector('[data-l="vat"]').checked };
    }).filter(function (l) { return l.desc || l.total; });
  }

  // Preview ----------------------------------------------------------------------
  function render() {
    var isInvoice = doc === 'faktura';
    var mode = $('inv-vatmode').value;
    var vat = mode === 'dk';
    var eu = mode === 'eu-services' || mode === 'eu-goods';
    var lines = readLines();
    var date = val('date') || isoToday();
    var gross = lines.reduce(function (s, l) { return s + l.total; }, 0);
    // A discount in percent on the whole amount, shown as its own line before VAT.
    var discEl = field('discount');
    var discPct = T.parseNumber(discEl.value);
    var discOk = discEl.value.trim() === '' || (!isNaN(discPct) && discPct >= 0 && discPct <= 100);
    discEl.setAttribute('aria-invalid', discOk ? 'false' : 'true');
    if (!discOk || isNaN(discPct)) discPct = 0;
    // With Danish VAT each line can be VAT-free (for example an outlay paid on the customer's behalf).
    var grossVat = lines.reduce(function (s, l) { return s + (l.vat ? l.total : 0); }, 0);
    var grossFree = gross - grossVat;
    var discVat = Math.round(grossVat * discPct / 100), discFree = Math.round(grossFree * discPct / 100);
    var discount = discVat + discFree;
    var sub = gross - discount;
    var subVat = grossVat - discVat;
    var subFree = sub - subVat;
    var mixed = vat && subFree !== 0;
    var vatOre = vat ? Math.round(subVat * 0.25) : 0;
    form.classList.toggle('inv-vat-lines', vat);
    var title = isInvoice ? T.t('Faktura', 'Invoice') : T.t('Tilbud', 'Quote');
    var terms = parseInt(val('terms'), 10);
    var valid = parseInt(val('valid'), 10);

    var sellerLines = [val('sAddr'), val('sCvr') && 'CVR ' + val('sCvr'), val('sEmail'), val('sPhone')].filter(Boolean).join('\n');
    var buyerNo = val('bCvr') && (eu ? T.t('Momsnr. ', 'VAT no. ') : 'CVR ') + val('bCvr');
    var buyerLines = [val('bAddr'), buyerNo, val('bRef') && T.t('Att.: ', 'Attn.: ') + val('bRef')].filter(Boolean).join('\n');
    $('inv-vat-warn').hidden = !(eu && !val('bCvr'));
    $('inv-bcvr-label').textContent = eu ? T.t('Momsnummer', 'VAT number') : T.t('CVR-nummer', 'CVR number');
    $('inv-bcvr-hint').textContent = eu ? T.t('· kræves, fx DE123456789', '· required, e.g. DE123456789') : T.t('· hvis erhverv', '· if a business');

    var meta = [[isInvoice ? T.t('Fakturanr.', 'Invoice no.') : T.t('Tilbudsnr.', 'Quote no.'), val('no') || '–'], [isInvoice ? T.t('Fakturadato', 'Invoice date') : T.t('Dato', 'Date'), showDate(date)]];
    if (isInvoice && val('delivery')) meta.push([T.t('Leveringsdato', 'Delivery date'), showDate(val('delivery'))]);
    if (isInvoice && terms >= 0) meta.push([T.t('Forfaldsdato', 'Due date'), showDate(addDays(date, terms))]);
    if (!isInvoice && valid > 0) meta.push([T.t('Gælder til', 'Valid until'), showDate(addDays(date, valid))]);

    var payText = val('sPay') + (terms >= 0 ? T.t('\nBetales senest ', '\nPlease pay by ') + showDate(addDays(date, terms)) + T.t('. Angiv fakturanr. ', '. Please quote invoice no. ') + (val('no') || '') + T.t(' ved betaling.', ' with your payment.') : '');
    var foot = [];
    if (isInvoice && val('sPay')) foot.push({ label: T.t('Betaling', 'Payment'), text: payText });
    if (mode === 'none') foot.push({ text: T.t('Der er ikke beregnet moms.', 'No VAT has been charged.') });
    // skat.dk: services to an EU business must say the supply is covered by reverse charge; goods must say
    // the supply is VAT-exempt (e.g. "momsfritaget", ML § 34, stk. 1).
    if (mode === 'eu-services') foot.push({ text: T.t('Omvendt betalingspligt – kunden afregner momsen. (Reverse charge)', 'Reverse charge – the customer accounts for the VAT. (Omvendt betalingspligt)') });
    if (mode === 'eu-goods') foot.push({ text: T.t('Momsfri levering af varer til en virksomhed i et andet EU-land, jf. momsloven § 34, stk. 1. (Intra-community supply, VAT exempt)', 'Intra-community supply of goods, VAT exempt (momsloven § 34, stk. 1).') });
    if (val('note')) foot.push({ text: val('note') });

    var totals = [];
    if (discount) {
      totals.push([T.t('Subtotal', 'Subtotal'), T.formatOre(gross) + ' kr.']);
      totals.push([T.t('Rabat ', 'Discount ') + T.formatNumber(discPct, discPct % 1 ? 1 : 0) + ' %', '−' + T.formatOre(discount) + ' kr.']);
    }
    if (mixed) {
      totals.push([T.t('Momspligtigt beløb', 'Amount subject to VAT'), T.formatOre(subVat) + ' kr.']);
      totals.push([T.t('Momsfrit beløb', 'Amount not subject to VAT'), T.formatOre(subFree) + ' kr.']);
      totals.push([T.t('Moms 25 % af ', 'VAT 25 % of ') + T.formatOre(subVat), T.formatOre(vatOre) + ' kr.']);
    } else if (vat) {
      totals.push([T.t('Beløb uden moms', 'Subtotal without VAT'), T.formatOre(sub) + ' kr.']);
      totals.push([T.t('Moms 25 %', 'VAT 25 %'), T.formatOre(vatOre) + ' kr.']);
    }
    totals.push([isInvoice ? T.t('At betale', 'Amount due') : T.t('Pris i alt', 'Total price'), T.formatOre(sub + vatOre) + ' kr.', true]);

    // One model for both the preview and the PDF, so they always match.
    model = {
      title: title, logo: logo,
      seller: { name: val('sName') || T.t('Dit firma', 'Your business'), lines: sellerLines },
      buyer: { label: isInvoice ? T.t('Faktureres til', 'Bill to') : T.t('Tilbud til', 'Quote for'), name: val('bName') || T.t('Kundens navn', 'Customer name'), lines: buyerLines },
      meta: meta,
      table: {
        head: [T.t('Beskrivelse', 'Description'), T.t('Antal', 'Qty'), T.t('Pris', 'Price'), T.t('Beløb', 'Amount')],
        rows: lines.map(function (l) { return [l.desc + (mixed && !l.vat ? T.t(' (momsfri)', ' (no VAT)') : ''), T.formatNumber(l.qty, l.qty % 1 ? 2 : 0), T.formatOre(T.toOre(l.price)), T.formatOre(l.total)]; }),
      },
      totals: totals,
      foot: foot,
    };

    var rows = model.table.rows.length ? model.table.rows.map(function (r) {
      return el('tr', null, [el('td', { text: r[0] }), el('td', { class: 'r', text: r[1] }), el('td', { class: 'r', text: r[2] }), el('td', { class: 'r', text: r[3] })]);
    }) : [el('tr', null, [el('td', { colspan: '4', class: 'inv-empty', text: T.t('Tilføj en linje til venstre.', 'Add a line on the left.') })])];

    paper.replaceChildren(
      el('div', { class: 'inv-head' }, [
        el('div', null, [el('h2', { text: title }), el('div', { class: 'inv-accent' })]),
        el('div', { class: 'inv-seller' }, [
          logo ? el('img', { class: 'inv-logo-img', src: logo.dataUrl, alt: '' }) : null,
          el('strong', { text: model.seller.name }), document.createTextNode(sellerLines ? '\n' + sellerLines : ''),
        ]),
      ]),
      el('div', { class: 'inv-parties' }, [
        el('div', null, [
          el('p', { class: 'inv-label', text: model.buyer.label }),
          el('div', { class: 'inv-buyer' }, [el('strong', { text: model.buyer.name }), document.createTextNode(buyerLines ? '\n' + buyerLines : '')]),
        ]),
        el('table', { class: 'inv-meta' }, [el('tbody', null, meta.map(function (m) {
          return el('tr', null, [el('td', { text: m[0] }), el('td', { text: m[1] })]);
        }))]),
      ]),
      el('table', { class: 'inv-table' }, [
        el('thead', null, [el('tr', null, model.table.head.map(function (h, i) { return el('th', i ? { class: 'r', text: h } : { text: h }); }))]),
        el('tbody', null, rows),
      ]),
      el('table', { class: 'inv-totals' }, [el('tbody', null, totals.map(function (t) {
        return el('tr', t[2] ? { class: 'inv-grand' } : null, [el('td', { text: t[0] }), el('td', { text: t[1] })]);
      }))]),
      foot.length ? el('div', { class: 'inv-foot' }, foot.map(function (f) {
        return el('div', null, [f.label ? el('p', { class: 'inv-label', text: f.label }) : null, el('div', { text: f.text })]);
      })) : null
    );
    save();
    saveDraft();
  }

  // Remember (opt-in) ----------------------------------------------------------------
  function save() {
    if (!$('inv-remember').checked) return;
    var data = { terms: val('terms'), vatMode: $('inv-vatmode').value, no: val('no') };
    SELLER.forEach(function (k) { data[k] = field(k).value; });
    data.logo = logo;
    T.storageSet(KEY, data);
  }
  function restore() {
    var data = T.storageGet(KEY);
    if (!data) return;
    $('inv-remember').checked = true;
    SELLER.forEach(function (k) { if (typeof data[k] === 'string') field(k).value = data[k]; });
    if (data.terms) field('terms').value = data.terms;
    if (data.no) field('no').value = data.no;
    if (data.logo && data.logo.dataUrl) setLogo(data.logo);
    if (data.vatMode) $('inv-vatmode').value = data.vatMode;
    else if (typeof data.vat === 'boolean') $('inv-vatmode').value = data.vat ? 'dk' : 'none'; // saved before vatMode existed
  }

  // Saved customers (only when the user clicks "Gem kunde") ------------------------------------------
  function customers() { return T.storageGet(CUSTOMERS_KEY) || []; }
  function fillCustomerList(selectName) {
    var sel = $('inv-customers');
    var first = sel.options[0];
    sel.replaceChildren(first);
    customers().forEach(function (c, i) {
      sel.appendChild(el('option', { value: String(i), text: c.bName || '?' }));
      if (selectName && c.bName === selectName) sel.value = String(i);
    });
    $('inv-delete-customer').hidden = sel.value === '';
  }
  $('inv-customers').addEventListener('change', function () {
    var c = customers()[Number(this.value)];
    $('inv-delete-customer').hidden = !c;
    if (!c) return;
    CUSTOMER_FIELDS.forEach(function (k) { field(k).value = c[k] || ''; });
    render();
  });
  $('inv-save-customer').addEventListener('click', function () {
    if (!val('bName')) { field('bName').focus(); return; }
    var name = val('bName');
    var list = customers().filter(function (c) { return c.bName !== name; });
    var c = {};
    CUSTOMER_FIELDS.forEach(function (k) { c[k] = k === 'bName' ? name : field(k).value; });
    list.push(c);
    list.sort(function (a, b) { return a.bName.localeCompare(b.bName, 'da'); });
    T.storageSet(CUSTOMERS_KEY, list);
    fillCustomerList(name);
    T.flash(this, T.t('Gemt', 'Saved'));
  });
  $('inv-delete-customer').addEventListener('click', function () {
    var i = Number($('inv-customers').value);
    var list = customers();
    if (!list[i]) return;
    list.splice(i, 1);
    T.storageSet(CUSTOMERS_KEY, list.length ? list : null);
    fillCustomerList();
  });

  // Lines handed over from the time tracker or the quote calculator.
  function takeImport() {
    var data = T.takeInvoiceImport();
    if (!data || !data.lines || !data.lines.length) return false;
    $('inv-lines').replaceChildren();
    data.lines.forEach(function (l) { addLine(l.desc, l.qty, l.price, l.noVat); });
    field('discount').value = data.discount || '';
    var from = { timer: T.t('tidsregistreringen', 'the time tracker'), tilbud: T.t('tilbudsberegneren', 'the quote calculator') }[data.from] || '';
    var note = $('inv-import-note');
    note.textContent = T.t('Linjerne er hentet fra ', 'The lines come from ') + from + T.t('. Tjek dem, og udfyld kunden.', '. Check them and fill in the customer.');
    note.hidden = !from;
    setDoc(data.doc === 'tilbud' ? 'tilbud' : 'faktura');
    return true;
  }

  // Logo ------------------------------------------------------------------------------------------
  function setLogo(l) {
    logo = l;
    var img = $('inv-logo-preview');
    img.hidden = !l;
    if (l) img.src = l.dataUrl; else img.removeAttribute('src');
    $('inv-logo-remove').hidden = !l;
    $('inv-logo-pick-label').textContent = l ? T.t('Skift billede', 'Change image') : T.t('Vælg et billede', 'Choose an image');
  }
  $('inv-logo-file').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    window.SrathPDF.toJpeg(file, 600, function (l) {
      $('inv-logo-error').hidden = !!l;
      if (!l) return;
      setLogo(l);
      render();
    });
  });
  $('inv-logo-remove').addEventListener('click', function () { setLogo(null); render(); });

  function fileName() {
    return (doc === 'faktura' ? T.t('Faktura ', 'Invoice ') : T.t('Tilbud ', 'Quote ')) + (val('no') || '') + (val('bName') ? ' - ' + val('bName') : '');
  }

  // Draft --------------------------------------------------------------------------------------------
  // Kept in sessionStorage while the tab is open, so going to another page and back (or reloading) doesn't
  // lose the invoice. It is deleted when the tab is closed.
  function saveDraft() {
    var fields = {};
    form.querySelectorAll('[data-f]').forEach(function (e) { fields[e.getAttribute('data-f')] = e.value; });
    var lines = Array.prototype.map.call($('inv-lines').children, function (row) {
      return { desc: row.querySelector('[data-l="desc"]').value, qty: row.querySelector('[data-l="qty"]').value, price: row.querySelector('[data-l="price"]').value, noVat: !row.querySelector('[data-l="vat"]').checked };
    });
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ doc: doc, vatMode: $('inv-vatmode').value, fields: fields, lines: lines, logo: logo })); } catch (e) { /* storage full or blocked */ }
  }
  function restoreDraft() {
    var d;
    try { d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { d = null; }
    if (!d || !d.fields) return false;
    Object.keys(d.fields).forEach(function (k) { var e = field(k); if (e) e.value = d.fields[k]; });
    if (d.vatMode) $('inv-vatmode').value = d.vatMode;
    if (d.logo && d.logo.dataUrl) setLogo(d.logo);
    $('inv-lines').replaceChildren();
    (d.lines && d.lines.length ? d.lines : [{ desc: '', qty: '1', price: '' }]).forEach(function (l) { addLine(l.desc, l.qty, l.price, l.noVat); });
    setDoc(d.doc === 'tilbud' ? 'tilbud' : 'faktura');
    return true;
  }

  // Find the customer in CVR, without leaving the page --------------------------------------------
  $('inv-cvr').addEventListener('click', function () {
    var btn = this, note = $('inv-cvr-note');
    // A Danish CVR number if there is one; an EU VAT number (other country prefix) can't be looked up, so use the name.
    var no = val('bCvr');
    var q = no && !/^[a-z]{2}/i.test(no.replace(/^dk/i, '')) ? no : val('bName');
    if (!q) {
      note.textContent = T.t('Skriv først et CVR-nummer eller et navn.', 'Type a CVR number or a name first.');
      field('bName').focus();
      return;
    }
    btn.disabled = true;
    btn.textContent = T.t('Søger …', 'Searching …');
    T.cvrLookup(q).then(function (c) {
      field('bName').value = c.name;
      field('bAddr').value = c.address;
      if ($('inv-vatmode').value === 'dk' || $('inv-vatmode').value === 'none') field('bCvr').value = c.vat;
      note.textContent = T.t('Hentet fra CVR: ', 'Found in CVR: ') + c.name + ', CVR ' + c.vat + '.';
      render();
    }, function (e) {
      var code = e && e.message;
      note.textContent = {
        NOT_FOUND: T.t('Ingen virksomhed fundet. Tjek stavningen eller nummeret.', 'No company found. Check the spelling or the number.'),
        INVALID_VAT: T.t('Et CVR-nummer har 8 cifre.', 'A CVR number has 8 digits.'),
        QUOTA_EXCEEDED: T.t('De gratis CVR-opslag for i dag er brugt på din internetforbindelse. Prøv igen i morgen.', 'The free CVR lookups for today have been used on your internet connection. Try again tomorrow.'),
        NETWORK: T.t('Kunne ikke kontakte CVR API. Tjek din forbindelse.', 'Could not reach CVR API. Check your connection.'),
      }[code] || T.t('Opslaget mislykkedes.', 'The lookup failed.');
    }).then(function () {
      btn.disabled = false;
      btn.textContent = T.t('Find i CVR', 'Find in CVR');
    });
  });

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
  $('inv-pdf').addEventListener('click', function () {
    render();
    window.SrathPDF.businessDoc(model).save(fileName().trim());
  });
  $('inv-print').addEventListener('click', function () {
    document.title = fileName().trim(); // Most browsers use the page title as the suggested PDF file name.
    document.body.classList.add('inv-printing');
    window.print();
  });
  window.addEventListener('afterprint', function () {
    document.body.classList.remove('inv-printing');
    document.title = pageTitle;
  });
  $('inv-new').addEventListener('click', function () {
    ['bName', 'bCvr', 'bAddr', 'bRef', 'note', 'delivery', 'discount'].forEach(function (k) { field(k).value = ''; });
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
      var v = row.querySelector('[data-l="vat"]');
      v.setAttribute('aria-label', T.t('Moms på denne linje', 'VAT on this line'));
      v.parentNode.setAttribute('title', T.t('Moms på denne linje', 'VAT on this line'));
      var b = row.querySelector('button');
      b.setAttribute('aria-label', T.t('Fjern linje', 'Remove line'));
      b.setAttribute('title', T.t('Fjern linje', 'Remove line'));
    });
    fillCustomerList(val('bName'));
    setLogo(logo);
    setDoc(doc);
  });
  field('date').value = isoToday();
  restore();
  fillCustomerList();
  if (!takeImport() && !restoreDraft()) {
    addLine('', '1', '');
    setDoc('faktura');
  }
})();
