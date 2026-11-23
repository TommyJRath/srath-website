// Timeprisberegner: the hourly rate a Danish sole trader needs for a given take-home pay.
//
// Tax model (estimate), 2026 rates from https://skat.dk/hjaelp/satser and
// https://skat.dk/hjaelp/bundskat-mellemskat-topskat-og-toptopskat:
//   - The whole profit is personal income (no virksomhedsordning, no capital income, no pension).
//   - am-bidrag 8 % of the profit; personlig indkomst = profit − am-bidrag.
//   - beskæftigelsesfradrag 12,75 % of the profit, max 63.300 kr., deducted in skattepligtig indkomst.
//   - personfradrag 54.100 kr. against bundskat, kommuneskat and kirkeskat.
//   - bundskat 12,01 % of personlig indkomst.
//   - mellemskat 7,5 % above 641.200 kr., topskat 7,5 % above 777.900 kr.,
//     toptopskat 5 % above 2.592.700 kr. (all of personlig indkomst after am-bidrag).
//   - skatteloft 44,57 %: kommuneskat + bundskat + mellemskat may not exceed it, so mellemskat is reduced
//     in municipalities with a high rate. Kirkeskat and am-bidrag are outside the ceiling, and topskat
//     and toptopskat come on top of it.
(function () {
  'use strict';
  var T = window.SrathTools;
  var $ = function (id) { return document.getElementById(id); };

  var R = {
    am: 0.08, bund: 0.1201, persfradrag: 54100,
    beskPct: 0.1275, beskMax: 63300,
    mellem: 0.075, mellemGraense: 641200,
    top: 0.075, topGraense: 777900,
    toptop: 0.05, toptopGraense: 2592700,
    loft: 0.4457,
  };

  /** Tax for a yearly profit (kroner). k and c are the municipal and church rates as fractions. */
  function tax(profit, k, c) {
    var p = Math.max(0, profit);
    var am = R.am * p;
    var pi = p - am;
    var besk = Math.min(R.beskPct * p, R.beskMax);
    var skattepligtig = Math.max(0, pi - besk);
    var bund = R.bund * Math.max(0, pi - R.persfradrag);
    var kom = k * Math.max(0, skattepligtig - R.persfradrag);
    var kirke = c * Math.max(0, skattepligtig - R.persfradrag);
    var mellemRate = Math.max(0, Math.min(R.mellem, R.loft - k - R.bund));
    var mellem = mellemRate * Math.max(0, pi - R.mellemGraense);
    var top = R.top * Math.max(0, pi - R.topGraense) + R.toptop * Math.max(0, pi - R.toptopGraense);
    var total = am + bund + kom + kirke + mellem + top;
    return { am: am, bund: bund, kom: kom, kirke: kirke, mellem: mellem, top: top, total: total };
  }

  /** The profit that leaves exactly `net` after tax (binary search; take-home rises with profit). */
  function profitFor(net, k, c) {
    var lo = 0, hi = 20000000;
    for (var i = 0; i < 80; i++) {
      var mid = (lo + hi) / 2;
      if (mid - tax(mid, k, c).total < net) lo = mid; else hi = mid;
    }
    return hi;
  }

  var fields = ['tp-net', 'tp-exp', 'tp-hours', 'tp-weeks', 'tp-sick', 'tp-share', 'tp-kom', 'tp-kirke'];

  function read(id, min, max) {
    var el = $(id);
    var n = T.parseNumber(el.value);
    var ok = !isNaN(n) && n >= min && n <= max;
    el.setAttribute('aria-invalid', ok ? 'false' : 'true');
    return ok ? n : NaN;
  }

  function kr(n) { return T.formatKr(n, 0); }

  function update() {
    var net = read('tp-net', 0, 2000000);
    var exp = read('tp-exp', 0, 100000000);
    var hours = read('tp-hours', 1, 100);
    var weeks = read('tp-weeks', 0, 40);
    var sick = read('tp-sick', 0, 100);
    var share = read('tp-share', 1, 100);
    var k = read('tp-kom', 0, 40);
    var c = read('tp-kirke', 0, 3);
    var values = [net, exp, hours, weeks, sick, share, k, c];
    var err = $('tp-error');
    if (values.some(isNaN)) {
      err.hidden = false;
      err.textContent = T.t('Tjek de røde felter: skriv et tal i hvert felt (fakturerbar andel 1–100 %, kommuneskat 0–40 %, kirkeskat 0–3 %).', 'Check the red fields: type a number in each (billable share 1–100 %, municipal tax 0–40 %, church tax 0–3 %).');
      return;
    }
    k /= 100; c /= 100;
    var workHours = (52 - weeks) * hours - sick * (hours / 5);
    var billable = workHours * share / 100;
    if (billable <= 0) {
      err.hidden = false;
      err.textContent = T.t('Med de tal er der ingen timer tilbage at fakturere.', 'With those numbers there are no hours left to bill.');
      return;
    }
    err.hidden = true;

    var netYear = net * 12;
    var profit = profitFor(netYear, k, c);
    var t = tax(profit, k, c);
    var revenue = profit + exp;
    var rate = revenue / billable;

    $('tp-rate').textContent = T.formatKr(Math.ceil(rate), 0);
    $('tp-rate-inc').textContent = T.t('uden moms · ', 'without VAT · ') + T.formatKr(Math.ceil(rate) * 1.25, 0) + T.t(' med 25 % moms', ' with 25 % VAT');
    $('tp-billable').textContent = T.formatNumber(billable, 0) + T.t(' timer', ' hours');
    $('tp-revenue').textContent = kr(revenue);
    $('tp-r-exp').textContent = kr(exp);
    $('tp-profit').textContent = kr(profit);
    $('tp-am').textContent = kr(t.am);
    $('tp-bund').textContent = kr(t.bund);
    $('tp-kom-label').textContent = T.t('Kommuneskat ', 'Municipal tax ') + T.formatNumber(k * 100, 2).replace(/[,.]?0+$/, '') + ' %';
    $('tp-bund-label').textContent = T.t('Bundskat ', 'Bottom tax ') + T.formatNumber(12.01, 2) + ' %';
    $('tp-komskat').textContent = kr(t.kom);
    $('tp-kirkeskat').textContent = kr(t.kirke);
    $('tp-row-kirke').hidden = t.kirke < 0.5;
    $('tp-mellem').textContent = kr(t.mellem);
    $('tp-row-mellem').hidden = t.mellem < 0.5;
    $('tp-top').textContent = kr(t.top);
    $('tp-row-top').hidden = t.top < 0.5;
    $('tp-tax').textContent = kr(t.total);
    $('tp-taxpct').textContent = profit > 0 ? '· ' + T.formatNumber(t.total / profit * 100, 1) + T.t(' % af overskuddet', ' % of the profit') : '';
    $('tp-netyear').textContent = kr(profit - t.total);

    var bars = $('tp-bar').children;
    var parts = [profit - t.total, t.total, exp];
    parts.forEach(function (v, i) { bars[i].style.width = (revenue > 0 ? v / revenue * 100 : 0) + '%'; });
  }

  function note() {
    $('tp-note').textContent = T.t(
      'Skøn efter Skattestyrelsens satser for 2026 for en enkeltmandsvirksomhed uden virksomhedsordning, med personfradrag (54.100 kr.) og beskæftigelsesfradrag (12,75 %, højst 63.300 kr.). Uden pension, kapitalindkomst og andre fradrag.',
      'An estimate using the Danish Tax Agency’s 2026 rates for a sole proprietorship outside the business tax scheme, with the personal allowance (54,100 kr.) and the employment allowance (12.75 %, at most 63,300 kr.). Without pension, capital income and other deductions.'
    );
  }

  fields.forEach(function (id) { $(id).addEventListener('input', update); });
  T.onLang(function () { note(); update(); });
  note();
  update();
})();
