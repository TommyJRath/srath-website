// Shared helpers for the free tools under /tools/. Plain JavaScript, no dependencies.
// Amounts are handled in øre (whole numbers) wherever money is added up, so rounding never drifts.
(function () {
  'use strict';

  /**
   * Parses a number typed the Danish or the English way: "1.234,50", "1234,5", "1,234.50", "1234.50", "12 500".
   * Returns NaN for empty or invalid input.
   */
  function parseNumber(value) {
    var s = String(value == null ? '' : value).trim().replace(/[\s ]|kr\.?|dkk|%/gi, '');
    if (!s) return NaN;
    var neg = /^-/.test(s);
    s = s.replace(/^[-+]/, '');
    var lastComma = s.lastIndexOf(',');
    var lastDot = s.lastIndexOf('.');
    if (lastComma !== -1 && lastDot !== -1) {
      // Both used: the last one is the decimal separator.
      var dec = lastComma > lastDot ? ',' : '.';
      var thou = dec === ',' ? '.' : ',';
      s = s.split(thou).join('').replace(dec, '.');
    } else if (lastComma !== -1) {
      // Only commas: a decimal comma in Danish, unless it can only be thousands ("1,234,567").
      // In English "1,234" is one thousand two hundred and thirty-four.
      var commaThousands = lang === 'en' ? /^\d{1,3}(,\d{3})+$/ : /^\d{1,3}(,\d{3}){2,}$/;
      s = commaThousands.test(s) ? s.split(',').join('') : s.replace(/,(?=[^,]*$)/, '.').split(',').join('');
    } else if (lastDot !== -1) {
      // Only dots: "1.234" is thousands in Danish but a decimal point in English; "1.234.567" is thousands in both.
      var dotThousands = lang === 'en' ? /^\d{1,3}(\.\d{3}){2,}$/ : /^\d{1,3}(\.\d{3})+$/;
      if (dotThousands.test(s)) s = s.split('.').join('');
    }
    if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return NaN;
    var n = parseFloat(s);
    return neg ? -n : n;
  }

  /** Kroner (number) to øre (integer), rounded half away from zero. */
  function toOre(kr) {
    var sign = kr < 0 ? -1 : 1;
    return sign * Math.round(Math.abs(kr) * 100 + 1e-9);
  }

  // Numbers follow the chosen language: 1.234,50 in Danish, 1,234.50 in English. `lang` is set below.
  function locale() { return lang === 'en' ? 'en-GB' : 'da-DK'; }
  function formatNumber(n, decimals) {
    return new Intl.NumberFormat(locale(), { minimumFractionDigits: decimals || 0, maximumFractionDigits: decimals || 0 }).format(n);
  }
  /** Formats øre as "1.234,50" / "1,234.50". */
  function formatOre(ore) { return formatNumber(ore / 100, 2); }
  /** Formats kroner as "1.234,50 kr." (decimals = 0 rounds to whole kroner). */
  function formatKr(kr, decimals) { return (decimals === 0 ? formatNumber(Math.round(kr), 0) : formatNumber(kr, 2)) + ' kr.'; }

  /** Copies text to the clipboard, falling back to a hidden textarea on older browsers. */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }

  /** Briefly changes a button's label to confirm an action. */
  function flash(button, text) {
    // While a flash is showing, keep the label from before it, not the flash text.
    var old = button._flash ? button._flashOld : button.textContent;
    button._flashOld = old;
    button.textContent = text;
    clearTimeout(button._flash);
    button._flash = setTimeout(function () {
      button._flash = null;
      // Only restore if nothing else changed the label in the meantime.
      if (button.textContent === text) button.textContent = old;
    }, 1600);
  }

  function storageGet(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }

  // Language (Danish / English) ----------------------------------------------------------
  // Static text: an element with data-en="..." swaps its text; data-en-html swaps its HTML;
  // data-en-placeholder / data-en-aria-label / data-en-title swap attributes; [data-lang="da|en"]
  // blocks are shown only in their language. Scripts use t(da, en) and listen for "srath:lang".
  var LANG_KEY = 'srath-tools-lang';
  var ATTRS = ['placeholder', 'aria-label', 'title'];
  var lang = (function () {
    var q = /[?&]lang=(da|en)\b/.exec(location.search);
    // A ?lang= link is a choice too: remember it, so the next tool opens in the same language.
    if (q) { storageSet(LANG_KEY, q[1]); return q[1]; }
    var saved = storageGet(LANG_KEY);
    if (saved === 'da' || saved === 'en') return saved;
    return /^da\b|^nb\b|^nn\b|^no\b/i.test(navigator.language || 'da') ? 'da' : 'en';
  })();

  function t(da, en) { return lang === 'en' ? en : da; }

  function applyLang(root, animate) {
    root = root || document;
    root.querySelectorAll('[data-en]').forEach(function (el) {
      if (!el.hasAttribute('data-da')) el.setAttribute('data-da', el.textContent);
      el.textContent = el.getAttribute('data-' + lang);
    });
    root.querySelectorAll('[data-en-html]').forEach(function (el) {
      if (!el.hasAttribute('data-da-html')) el.setAttribute('data-da-html', el.innerHTML);
      el.innerHTML = el.getAttribute('data-' + lang + '-html');
    });
    ATTRS.forEach(function (a) {
      root.querySelectorAll('[data-en-' + a + ']').forEach(function (el) {
        if (!el.hasAttribute('data-da-' + a)) el.setAttribute('data-da-' + a, el.getAttribute(a) || '');
        el.setAttribute(a, el.getAttribute('data-' + lang + '-' + a));
      });
    });
    root.querySelectorAll('[data-lang]').forEach(function (el) { el.hidden = el.getAttribute('data-lang') !== lang; });
    if (root === document) {
      document.documentElement.lang = lang;
      var sw = document.querySelector('.lang-switch');
      if (sw) {
        sw.querySelectorAll('[data-set-lang]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-set-lang') === lang)); });
        var title = sw.getAttribute('data-title-' + lang);
        if (title) document.title = title;
        moveThumb(sw, !!animate);
      }
      // Links between tools keep the chosen language.
      document.querySelectorAll('a[href^="/tools/"]').forEach(function (a) {
        a.setAttribute('href', a.getAttribute('href').split('?')[0] + (lang === 'en' ? '?lang=en' : ''));
      });
    }
  }

  // The switch's amber highlight is one element that slides to the chosen language (see .lang-thumb in
  // tools.css). The first placement, and any after a resize, happen without animation.
  function moveThumb(sw, animate) {
    var thumb = sw.querySelector('.lang-thumb');
    if (!thumb) {
      thumb = document.createElement('span');
      thumb.className = 'lang-thumb';
      thumb.setAttribute('aria-hidden', 'true');
      sw.insertBefore(thumb, sw.firstChild);
      sw.classList.add('has-thumb');
      animate = false;
    }
    var on = sw.querySelector('[aria-pressed="true"]');
    if (!on) return;
    if (!animate) thumb.classList.add('is-instant');
    thumb.style.width = on.offsetWidth + 'px';
    thumb.style.transform = 'translateX(' + (on.offsetLeft - 4) + 'px)'; // 4px: the switch's padding
    if (!animate) { void thumb.offsetWidth; thumb.classList.remove('is-instant'); }
  }
  window.addEventListener('resize', function () {
    var sw = document.querySelector('.lang-switch');
    if (sw) moveThumb(sw, false);
  });

  function setLang(next) {
    if (next === lang) return;
    lang = next;
    storageSet(LANG_KEY, lang);
    if (/[?&]lang=/.test(location.search) && history.replaceState) {
      history.replaceState(null, '', location.pathname + (lang === 'en' ? '?lang=en' : '') + location.hash);
    }
    applyLang(document, true);
    document.dispatchEvent(new CustomEvent('srath:lang', { detail: lang }));
  }

  document.querySelectorAll('[data-set-lang]').forEach(function (b) {
    b.addEventListener('click', function () { setLang(b.getAttribute('data-set-lang')); });
  });
  applyLang();

  // Hand lines over to the invoice generator (from the time tracker or the quote calculator). The data waits
  // in this browser's storage only until the invoice page picks it up, and is then deleted.
  var IMPORT_KEY = 'srath-faktura-import';

  /**
   * Looks up a Danish company with CVR API (https://cvrapi.dk), from the visitor's own browser. Accepts a CVR
   * number (with or without "DK" and spaces) or a name. Resolves to { name, address, vat } or rejects with an
   * error code: NOT_FOUND, INVALID_VAT, QUOTA_EXCEEDED, BANNED or NETWORK.
   */
  function cvrLookup(text) {
    var raw = String(text || '').trim();
    var digits = raw.replace(/^dk/i, '').replace(/[\s-]/g, '');
    var q = /^\d+$/.test(digits) ? digits : raw;
    return fetch('https://cvrapi.dk/api?search=' + encodeURIComponent(q) + '&country=dk', { headers: { Accept: 'application/json' } })
      .then(function (res) { return res.json(); }, function () { throw new Error('NETWORK'); })
      .then(function (d) {
        if (!d || d.error) throw new Error((d && d.error) || 'NOT_FOUND');
        var address = [d.addressco ? 'c/o ' + d.addressco : '', d.address, [d.zipcode, d.city].filter(Boolean).join(' ')].filter(Boolean).join('\n');
        return { name: d.name || '', address: address, vat: String(d.vat || '') };
      });
  }
  function sendToInvoice(payload) {
    storageSet(IMPORT_KEY, { doc: payload.doc || 'faktura', lines: payload.lines || [], discount: payload.discount || '', from: payload.from || '', at: Date.now() });
    location.href = '/tools/faktura/' + (lang === 'en' ? '?lang=en' : '');
  }
  function takeInvoiceImport() {
    var data = storageGet(IMPORT_KEY);
    storageSet(IMPORT_KEY, null);
    // Ignore anything older than ten minutes: it was not meant for this visit.
    return data && Date.now() - (data.at || 0) < 10 * 60 * 1000 ? data : null;
  }

  /** ISO date (yyyy-mm-dd) in local time. */
  function isoDate(d) {
    d = d || new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  /** "23.11.2026" in Danish, "23 Nov 2026" in English. */
  function showDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
    var p = iso.split('-');
    if (lang !== 'en') return Number(p[2]) + '.' + Number(p[1]) + '.' + p[0];
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  /** Saves a text file (CSV, calendar) through a temporary download link. */
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  /** One CSV cell, quoted when needed. Danish Excel expects ";" between cells. */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Danish income tax for a sole trader. Tax model (estimate), 2026 rates from https://skat.dk/hjaelp/satser and
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
  // Update these every January.
  var R = {
    am: 0.08, bund: 0.1201, persfradrag: 54100,
    beskPct: 0.1275, beskMax: 63300,
    mellem: 0.075, mellemGraense: 641200,
    top: 0.075, topGraense: 777900,
    toptop: 0.05, toptopGraense: 2592700,
    loft: 0.4457,
  };

  /** Tax for a yearly profit (kroner). k and c are the municipal and church rates as fractions. */
  function danishTax(profit, k, c) {
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


  window.SrathTools = {
    danishTax: danishTax,
    TAX_YEAR: 2026,
    cvrLookup: cvrLookup,
    sendToInvoice: sendToInvoice,
    takeInvoiceImport: takeInvoiceImport,
    isoDate: isoDate,
    showDate: showDate,
    download: download,
    csvCell: csvCell,
    lang: function () { return lang; },
    t: t,
    applyLang: applyLang,
    onLang: function (fn) { document.addEventListener('srath:lang', function () { fn(lang); }); },
    parseNumber: parseNumber,
    toOre: toOre,
    formatOre: formatOre,
    formatKr: formatKr,
    formatNumber: formatNumber,
    copyText: copyText,
    flash: flash,
    storageGet: storageGet,
    storageSet: storageSet,
  };
})();
