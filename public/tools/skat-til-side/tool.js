// Skat til side: how much of a payment to put aside for VAT and income tax. The income tax uses the marginal
// rate at the expected yearly profit (SrathTools.danishTax, 2026 rates), so the extra profit from this payment
// is taxed at the rate it really meets. Nothing is stored.
(function () {
  'use strict';
  var T = window.SrathTools;
  var $ = function (id) { return document.getElementById(id); };
  var vatMode = 'inc';

  function read(id, min, max) {
    var el = $(id), n = T.parseNumber(el.value);
    var ok = !isNaN(n) && n >= min && n <= max;
    el.setAttribute('aria-invalid', ok ? 'false' : 'true');
    return ok ? n : NaN;
  }

  function update() {
    var amount = read('st-amount', 0, 100000000);
    var expPct = read('st-exp', 0, 100);
    var profit = read('st-profit', 0, 100000000);
    var k = read('st-kom', 0, 40);
    var c = read('st-kirke', 0, 3);
    var bad = [amount, expPct, profit, k, c].some(isNaN);
    $('st-error').hidden = !bad;
    $('st-error').textContent = bad ? T.t('Tjek de røde felter.', 'Check the red fields.') : '';
    if (bad) return;
    k /= 100; c /= 100;

    var ex = vatMode === 'inc' ? amount / 1.25 : amount;
    var vat = vatMode === 'inc' ? amount - ex : 0;
    var expenses = ex * expPct / 100;
    var gain = ex - expenses;
    // Marginal tax: the tax on (profit + this gain) minus the tax on (profit), with this payment counted as
    // part of the year's profit (the top of it).
    var base = Math.max(0, profit - gain);
    var tax = T.danishTax(base + gain, k, c).total - T.danishTax(base, k, c).total;
    var rate = gain > 0 ? tax / gain : 0;
    var aside = vat + tax;

    $('st-aside').textContent = T.formatKr(aside, 0);
    $('st-aside-sub').textContent = T.formatNumber(amount > 0 ? aside / amount * 100 : 0, 0) + T.t(' % af beløbet', ' % of the amount');
    $('st-vat').textContent = T.formatKr(vat, 0);
    $('st-tax-label').textContent = T.t('Indkomstskat (', 'Income tax (') + T.formatNumber(rate * 100, 1) + T.t(' % af overskuddet)', ' % of the profit)');
    $('st-tax').textContent = T.formatKr(tax, 0);
    $('st-expenses').textContent = T.formatKr(expenses, 0);
    $('st-yours').textContent = T.formatKr(amount - aside - expenses, 0);
    $('st-note').textContent = T.t(
      'Indkomstskatten er beregnet med marginalskatten ved dit forventede overskud: am-bidrag, bundskat, kommuneskat og eventuel kirke-, mellem- og topskat, med Skattestyrelsens satser for ' + T.TAX_YEAR + '. Et skøn for en enkeltmandsvirksomhed uden virksomhedsordning; din B-skat dækker måske allerede en del af det.',
      'The income tax uses the marginal rate at your expected profit: labour market contribution, bottom tax, municipal tax and any church, middle and top tax, with the Danish Tax Agency\'s ' + T.TAX_YEAR + ' rates. An estimate for a sole proprietorship outside the business tax scheme; your preliminary tax (B-skat) may already cover part of it.');
  }

  document.querySelectorAll('[data-vat]').forEach(function (b) {
    b.addEventListener('click', function () {
      vatMode = b.getAttribute('data-vat');
      document.querySelectorAll('[data-vat]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      update();
    });
  });
  ['st-amount', 'st-exp', 'st-profit', 'st-kom', 'st-kirke'].forEach(function (id) { $(id).addEventListener('input', update); });
  T.onLang(update);
  update();
})();
