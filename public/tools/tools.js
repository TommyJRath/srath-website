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
    if (q) return q[1];
    var saved = storageGet(LANG_KEY);
    if (saved === 'da' || saved === 'en') return saved;
    return /^da\b|^nb\b|^nn\b|^no\b/i.test(navigator.language || 'da') ? 'da' : 'en';
  })();

  function t(da, en) { return lang === 'en' ? en : da; }

  function applyLang(root) {
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
      }
      // Links between tools keep the chosen language.
      document.querySelectorAll('a[href^="/tools/"]').forEach(function (a) {
        a.setAttribute('href', a.getAttribute('href').split('?')[0] + (lang === 'en' ? '?lang=en' : ''));
      });
    }
  }

  function setLang(next) {
    if (next === lang) return;
    lang = next;
    storageSet(LANG_KEY, lang);
    if (/[?&]lang=/.test(location.search) && history.replaceState) {
      history.replaceState(null, '', location.pathname + (lang === 'en' ? '?lang=en' : '') + location.hash);
    }
    applyLang();
    document.dispatchEvent(new CustomEvent('srath:lang', { detail: lang }));
  }

  document.querySelectorAll('[data-set-lang]').forEach(function (b) {
    b.addEventListener('click', function () { setLang(b.getAttribute('data-set-lang')); });
  });
  applyLang();

  window.SrathTools = {
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
