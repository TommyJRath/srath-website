// Web design page: code tabs (with arrow keys), copy buttons, demo frames that size themselves to their
// content, and the table of contents marking the example in view.
(function () {
  'use strict';

  // Tabs ------------------------------------------------------------------------------
  document.querySelectorAll('[data-code]').forEach(function (box) {
    var tabs = Array.prototype.slice.call(box.querySelectorAll('[role="tab"]'));
    var panels = Array.prototype.slice.call(box.querySelectorAll('[role="tabpanel"]'));
    function select(i, focus) {
      tabs.forEach(function (t, j) {
        t.setAttribute('aria-selected', String(i === j));
        t.tabIndex = i === j ? 0 : -1;
        panels[j].hidden = i !== j;
      });
      if (focus) tabs[i].focus();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(i); });
      t.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') { e.preventDefault(); select((i + 1) % tabs.length, true); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); select((i - 1 + tabs.length) % tabs.length, true); }
      });
    });

    // Copy the code of the open tab.
    var copy = box.querySelector('[data-copy]');
    copy.addEventListener('click', function () {
      var open = panels.filter(function (p) { return !p.hidden; })[0];
      var text = open.textContent;
      var done = function () {
        copy.textContent = 'Copied';
        setTimeout(function () { copy.textContent = 'Copy'; }, 1500);
      };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, function () {});
      else {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* nothing to do */ }
        ta.remove();
      }
    });
  });

  // Demo frames follow the height of their content: each demo posts its height (see DEMO_SIZER in build.mjs).
  var frames = Array.prototype.slice.call(document.querySelectorAll('.design-demo iframe'));
  window.addEventListener('message', function (e) {
    var h = e.data && e.data.srathDemoHeight;
    if (typeof h !== 'number' || !(h > 0) || h > 4000) return;
    frames.forEach(function (f) { if (f.contentWindow === e.source) f.style.height = h + 'px'; });
  });

  // Mark the example in view in the table of contents --------------------------------------------
  var links = {};
  document.querySelectorAll('.design-toc a').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        Object.keys(links).forEach(function (k) { links[k].setAttribute('aria-current', String(k === e.target.id)); });
      });
    }, { rootMargin: '-30% 0px -60% 0px' });
    document.querySelectorAll('.design-item').forEach(function (s) { io.observe(s); });
  }
})();
