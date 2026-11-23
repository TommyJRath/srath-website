// Momsberegner: adds or extracts 25 % Danish VAT. All sums are in øre.
(function () {
  'use strict';
  var T = window.SrathTools;
  var $ = function (id) { return document.getElementById(id); };
  var mode = 'ex';
  var last = { ex: 0, vat: 0, inc: 0 };

  /** Splits an amount (øre) into ex / vat / inc for the current mode. */
  function split(ore) {
    if (mode === 'ex') {
      var vat = Math.round(ore * 0.25);
      return { ex: ore, vat: vat, inc: ore + vat };
    }
    var exc = Math.round(ore / 1.25);
    return { ex: exc, vat: ore - exc, inc: ore };
  }

  function update() {
    var input = $('mb-amount');
    var raw = input.value;
    var n = T.parseNumber(raw);
    var bad = raw.trim() !== '' && isNaN(n);
    input.setAttribute('aria-invalid', bad ? 'true' : 'false');
    $('mb-error').hidden = !bad;
    if (bad) $('mb-error').textContent = T.t('Det ligner ikke et beløb. Skriv fx 1.250,00 eller 1250.', 'That does not look like an amount. Type for example 1,250.00 or 1250.');
    var r = split(isNaN(n) ? 0 : T.toOre(n));
    last = r;
    document.querySelector('[data-copy="ex"]').textContent = T.formatOre(r.ex) + ' kr.';
    document.querySelector('[data-copy="vat"]').textContent = T.formatOre(r.vat) + ' kr.';
    document.querySelector('[data-copy="inc"]').textContent = T.formatOre(r.inc) + ' kr.';
    $('mb-hero-label').textContent = mode === 'ex' ? T.t('Beløb med moms', 'Amount with VAT') : T.t('Beløb uden moms', 'Amount without VAT');
    $('mb-hero').textContent = T.formatOre(mode === 'ex' ? r.inc : r.ex) + ' kr.';

    // List: each line is split on its own and rounded, as it would be on separate receipts.
    var lines = $('mb-list').value.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    $('mb-list-result').hidden = !lines.length;
    $('mb-list-note').textContent = mode === 'ex'
      ? T.t('Beløbene tæller som uden moms, ligesom feltet ovenfor.', 'The amounts count as without VAT, like the field above.')
      : T.t('Beløbene tæller som med moms, ligesom feltet ovenfor.', 'The amounts count as with VAT, like the field above.');
    if (lines.length) {
      var sum = { ex: 0, vat: 0, inc: 0 }, badLines = [];
      lines.forEach(function (l, i) {
        var v = T.parseNumber(l);
        if (isNaN(v)) { badLines.push(i + 1); return; }
        var s = split(T.toOre(v));
        sum.ex += s.ex; sum.vat += s.vat; sum.inc += s.inc;
      });
      $('mb-list-title').textContent = T.t('Sum af ', 'Total of ') + (lines.length - badLines.length) + T.t(' beløb', ' amounts');
      $('mb-l-ex').textContent = T.formatOre(sum.ex) + ' kr.';
      $('mb-l-vat').textContent = T.formatOre(sum.vat) + ' kr.';
      $('mb-l-inc').textContent = T.formatOre(sum.inc) + ' kr.';
      $('mb-l-error').hidden = !badLines.length;
      $('mb-l-error').textContent = badLines.length ? T.t('Sprunget over (ikke et beløb): linje ', 'Skipped (not an amount): line ') + badLines.join(', ') + '.' : '';
    }
  }

  document.querySelectorAll('[data-mode]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      mode = btn.getAttribute('data-mode');
      document.querySelectorAll('[data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
      update();
    });
  });
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var ore = last[btn.getAttribute('data-copy')];
      T.copyText(T.formatOre(ore)).then(function () { T.flash(btn, T.t('Kopieret', 'Copied')); }, function () {});
    });
  });
  $('mb-amount').addEventListener('input', update);
  $('mb-list').addEventListener('input', update);
  T.onLang(update);
  update();
})();
