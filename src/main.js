// Progressive enhancement only: the site works fully without JavaScript.
// The home page hero's interactive workbench lives in /bench.js and is only loaded there.
(function () {
  document.addEventListener('DOMContentLoaded', hideOldNews);

  // The news banner is built with the site; hide it once the item is older than its limit (see build.mjs).
  function hideOldNews() {
    var bar = document.querySelector('.news-bar[data-date]');
    if (!bar) return;
    var age = (Date.now() - Date.parse(bar.getAttribute('data-date') + 'T00:00:00Z')) / 86400000;
    if (age > Number(bar.getAttribute('data-days') || 30)) bar.hidden = true;
  }
})();
