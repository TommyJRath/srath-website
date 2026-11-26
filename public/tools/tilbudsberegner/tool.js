// Tilbudsberegner: hours plus a buffer, materials at cost plus markup, an optional discount, and a button that
// sends the lines to the invoice generator as a quote. Nothing is stored.
(function () {
  'use strict';
  var T = window.SrathTools;
  var $ = function (id) { return document.getElementById(id); };

  function num(id, min, max, fallback) {
    var el = $(id), n = T.parseNumber(el.value);
    var ok = el.value.trim() === '' || (!isNaN(n) && n >= min && n <= max);
    el.setAttribute('aria-invalid', ok ? 'false' : 'true');
    return isNaN(n) || !ok ? fallback : n;
  }

  function addLine(desc, qty, cost) {
    var row = document.createElement('div');
    row.className = 'tl-row tb-line';
    row.innerHTML = '<input class="tl-input" data-l="desc"><input class="tl-input tl-num" data-l="qty" inputmode="decimal"><input class="tl-input tl-num" data-l="cost" inputmode="decimal"><button type="button" class="tl-icon-btn">×</button>';
    row.querySelector('[data-l="desc"]').value = desc || '';
    row.querySelector('[data-l="qty"]').value = qty == null ? '1' : qty;
    row.querySelector('[data-l="cost"]').value = cost || '';
    labels(row);
    row.querySelector('button').addEventListener('click', function () { row.remove(); render(); });
    row.addEventListener('input', render);
    $('tb-lines').appendChild(row);
    return row;
  }
  function labels(row) {
    row.querySelector('[data-l="desc"]').setAttribute('aria-label', T.t('Vare', 'Item'));
    row.querySelector('[data-l="qty"]').setAttribute('aria-label', T.t('Antal', 'Quantity'));
    row.querySelector('[data-l="cost"]').setAttribute('aria-label', T.t('Kostpris pr. stk. uden moms', 'Cost each without VAT'));
    row.querySelector('button').setAttribute('aria-label', T.t('Fjern vare', 'Remove item'));
  }

  function calc() {
    var hours = num('tb-hours', 0, 100000, 0);
    var rate = num('tb-rate', 0, 1000000, 0);
    var buffer = num('tb-buffer', 0, 500, 0) / 100;
    var markup = num('tb-markup', 0, 1000, 0) / 100;
    var discount = num('tb-discount', 0, 100, 0) / 100;
    var hoursWithBuffer = Math.round(hours * (1 + buffer) * 4) / 4; // to the quarter hour
    var items = Array.prototype.map.call($('tb-lines').children, function (row) {
      var q = T.parseNumber(row.querySelector('[data-l="qty"]').value), c = T.parseNumber(row.querySelector('[data-l="cost"]').value);
      q = isNaN(q) ? 0 : q; c = isNaN(c) ? 0 : c;
      var price = Math.round(c * (1 + markup) * 100) / 100;
      return { desc: row.querySelector('[data-l="desc"]').value.trim(), qty: q, cost: c, price: price };
    }).filter(function (i) { return i.desc || i.cost; });
    var labour = T.toOre(hoursWithBuffer * rate);
    var mat = items.reduce(function (s, i) { return s + T.toOre(i.qty * i.price); }, 0);
    var matCost = items.reduce(function (s, i) { return s + T.toOre(i.qty * i.cost); }, 0);
    var before = labour + mat;
    var disc = Math.round(before * discount);
    return { hours: hours, hoursWithBuffer: hoursWithBuffer, rate: rate, items: items, labour: labour, mat: mat, matProfit: mat - matCost, disc: disc, discount: discount, total: before - disc };
  }

  function row(label, ore, cls) {
    var d = document.createElement('div'); if (cls) d.className = cls;
    var dt = document.createElement('dt'); dt.textContent = label;
    var dd = document.createElement('dd'); dd.textContent = T.formatOre(ore) + ' kr.';
    d.appendChild(dt); d.appendChild(dd); return d;
  }

  function render() {
    var c = calc();
    var res = $('tb-result');
    res.replaceChildren(
      row(T.t('Arbejde: ', 'Work: ') + T.formatNumber(c.hoursWithBuffer, 2).replace(/[,.]00$/, '') + T.t(' timer à ', ' hours at ') + T.formatKr(c.rate, 0), c.labour),
      row(T.t('Materialer med avance', 'Materials with markup'), c.mat),
      c.mat ? row(T.t('heraf din avance', 'of which your markup'), c.matProfit, 'tl-sub') : null,
      c.disc ? row(T.t('Rabat ', 'Discount ') + T.formatNumber(c.discount * 100, 0) + ' %', -c.disc) : null,
      row(T.t('Pris uden moms', 'Price without VAT'), c.total, 'tl-total')
    );
    Array.prototype.forEach.call(res.children, function () {});
    $('tb-total').textContent = T.formatOre(c.total) + ' kr.';
    $('tb-total-inc').textContent = T.t('uden moms · ', 'without VAT · ') + T.formatOre(Math.round(c.total * 1.25)) + T.t(' kr. med 25 % moms', ' kr. with 25 % VAT');
    var err = !c.total ? T.t('Skriv timer og timepris, eller tilføj en vare.', 'Enter hours and an hourly rate, or add an item.') : '';
    $('tb-error').hidden = !err; $('tb-error').textContent = err;
    $('tb-send').disabled = !c.total;
  }

  $('tb-send').addEventListener('click', function () {
    var c = calc();
    if (!c.total) return;
    var f = function (n, d) { return T.formatNumber(n, d).replace(/[,.]00$/, ''); };
    var task = $('tb-task').value.trim();
    // Lines at full price; the discount goes along on its own, so the quote shows it as a line.
    var lines = [];
    if (c.labour) lines.push({ desc: (task || T.t('Arbejde', 'Work')) + T.t(' – anslået ', ' – estimated ') + f(c.hoursWithBuffer, 2) + T.t(' timer', ' hours'), qty: f(c.hoursWithBuffer, 2), price: f(c.rate, 2) });
    c.items.forEach(function (i) { lines.push({ desc: i.desc || T.t('Materialer', 'Materials'), qty: f(i.qty, 2), price: f(i.price, 2) }); });
    T.sendToInvoice({ doc: 'tilbud', lines: lines, from: 'tilbud', discount: c.discount ? f(c.discount * 100, (c.discount * 100) % 1 ? 1 : 0) : '' });
  });

  $('tb-add').addEventListener('click', function () { addLine().querySelector('input').focus(); render(); });
  ['tb-hours', 'tb-rate', 'tb-buffer', 'tb-markup', 'tb-discount', 'tb-task'].forEach(function (id) { $(id).addEventListener('input', render); });
  T.onLang(function () { Array.prototype.forEach.call($('tb-lines').children, labels); render(); });
  addLine('', '1', '');
  render();
})();
