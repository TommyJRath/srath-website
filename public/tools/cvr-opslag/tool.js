// CVR-opslag: looks up a Danish company with CVR API (https://cvrapi.dk), called from the visitor's own
// browser and only when they press Søg / Search. Free use is limited to 50 lookups a day per IP address.
(function () {
  'use strict';
  var T = window.SrathTools;
  var $ = function (id) { return document.getElementById(id); };
  var API = 'https://cvrapi.dk/api';
  var VIRK = 'https://datacvr.virk.dk/';
  var busy = false;
  var current = null;   // the last company found, so it can be shown again in the other language
  var lastError = null; // [da, en] of the last error, for the same reason

  var ERRORS = {
    NOT_FOUND: ['Ingen virksomhed fundet. Tjek stavningen eller nummeret.', 'No company found. Check the spelling or the number.'],
    INVALID_VAT: ['Et CVR-nummer har 8 cifre.', 'A CVR number has 8 digits.'],
    QUOTA_EXCEEDED: ['De gratis opslag for i dag er brugt på din internetforbindelse. Prøv igen i morgen, eller søg i det officielle register.', 'The free lookups for today have been used on your internet connection. Try again tomorrow, or search the official register.'],
    BANNED: ['CVR API afviser opslag fra din internetforbindelse lige nu.', 'CVR API is refusing lookups from your internet connection right now.'],
  };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k]; else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }

  function showError(pair) {
    lastError = pair;
    var box = $('cvr-error');
    if (!pair) { box.hidden = true; return; }
    box.replaceChildren(T.t(pair[0], pair[1]) + ' ', el('a', { href: VIRK, rel: 'noopener noreferrer', text: T.t('Søg på datacvr.virk.dk', 'Search datacvr.virk.dk') }));
    box.hidden = false;
  }

  /** "28/11 - 1931" (the API's format) to "28.11.1931" or "28/11/1931". */
  function apiDate(s) {
    var m = /^(\d{1,2})\/(\d{1,2})\s*-\s*(\d{4})$/.exec(String(s || '').trim());
    if (!m) return s || '';
    var sep = T.lang() === 'en' ? '/' : '.';
    return Number(m[1]) + sep + Number(m[2]) + sep + m[3];
  }

  function address(c) {
    return [c.addressco ? 'c/o ' + c.addressco : '', c.address, [c.zipcode, c.city].filter(Boolean).join(' ')].filter(Boolean).join('\n');
  }

  function render(c) {
    var ended = Boolean(c.enddate) || c.creditbankrupt;
    var status = c.creditbankrupt ? T.t('Konkurs', 'Bankrupt') : c.enddate ? T.t('Ophørt', 'Closed') : T.t('Aktiv', 'Active');
    var addr = address(c);
    var block = [c.name, addr, 'CVR ' + c.vat].filter(Boolean).join('\n');

    // Company type and industry come from the register in Danish.
    var rows = [
      [T.t('CVR-nummer', 'CVR number'), String(c.vat)],
      [T.t('Adresse', 'Address'), addr.replace(/\n/g, ', ')],
      c.companydesc && [T.t('Virksomhedsform', 'Company type'), c.companydesc],
      c.industrydesc && [T.t('Branche', 'Industry'), c.industrydesc + (c.industrycode ? ' (' + c.industrycode + ')' : '')],
      c.startdate && [T.t('Startdato', 'Start date'), apiDate(c.startdate)],
      c.enddate && [T.t('Ophørsdato', 'End date'), apiDate(c.enddate)],
      c.protected && [T.t('Reklamebeskyttet', 'Protected from marketing'), T.t('Ja', 'Yes')],
      c.productionunits && c.productionunits.length > 1 && [T.t('Produktionsenheder', 'Production units'), String(c.productionunits.length)],
    ].filter(Boolean);

    var copied = T.t('Kopieret', 'Copied');
    var copyBtn = el('button', { type: 'button', class: 'btn btn-ghost tl-btn-sm', text: T.t('Kopier navn og adresse', 'Copy name and address') });
    copyBtn.addEventListener('click', function () {
      T.copyText(block).then(function () { T.flash(copyBtn, copied); }, function () {});
    });
    var copyCvr = el('button', { type: 'button', class: 'btn btn-ghost tl-btn-sm', text: T.t('Kopier CVR-nummer', 'Copy CVR number') });
    copyCvr.addEventListener('click', function () {
      T.copyText(String(c.vat)).then(function () { T.flash(copyCvr, copied); }, function () {});
    });

    return el('li', { class: 'cvr-item' }, [
      el('h3', null, [c.name || T.t('Uden navn', 'No name'), el('span', { class: 'cvr-badge ' + (ended ? 'is-ended' : 'is-active'), text: status })]),
      el('dl', { class: 'tl-result' }, rows.map(function (r) { return el('div', null, [el('dt', { text: r[0] }), el('dd', { text: r[1], style: 'white-space:normal' })]); })),
      el('div', { class: 'tl-actions' }, [
        copyBtn, copyCvr,
        el('a', { class: 'btn btn-ghost tl-btn-sm', href: '/tools/faktura/' + (T.lang() === 'en' ? '?lang=en' : ''), text: T.t('Til fakturagenerator', 'Go to invoice generator') }),
      ]),
      c.protected ? el('p', { class: 'tl-note', text: T.t('Virksomheden er reklamebeskyttet: oplysningerne må ikke bruges til markedsføring.', 'The company is protected from marketing: the details must not be used for marketing.') }) : null,
    ]);
  }

  function show() {
    $('cvr-results').replaceChildren.apply($('cvr-results'), current ? [render(current)] : []);
    showError(lastError);
    $('cvr-go').textContent = busy ? T.t('Søger …', 'Searching …') : T.t('Søg', 'Search');
  }

  $('cvr-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    var raw = $('cvr-q').value.trim();
    if (!raw) return;
    var digits = raw.replace(/^dk/i, '').replace(/[\s-]/g, '');
    var q = /^\d+$/.test(digits) ? digits : raw;
    current = null;
    lastError = null;
    busy = true;
    show();
    fetch(API + '?search=' + encodeURIComponent(q) + '&country=dk', { headers: { Accept: 'application/json' } })
      .then(function (res) { return res.json().catch(function () { throw new Error('bad'); }); })
      .then(function (data) {
        if (!data || data.error) {
          var code = String((data && data.error) || 'unknown');
          lastError = ERRORS[code] || ['Opslaget mislykkedes (' + code + ').', 'The lookup failed (' + code + ').'];
          return;
        }
        current = data;
      })
      .catch(function () { lastError = ['Kunne ikke kontakte CVR API. Tjek din forbindelse, eller prøv igen om lidt.', 'Could not reach CVR API. Check your connection, or try again in a moment.']; })
      .then(function () { busy = false; show(); });
  });

  T.onLang(show);
})();
