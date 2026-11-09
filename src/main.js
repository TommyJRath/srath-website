// Progressive enhancement only: the site works fully without JavaScript.
(function () {
  var root = document.documentElement;
  if (!('IntersectionObserver' in window)) return;
  root.classList.add('js');

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.reveal').forEach(function (el, i) {
      el.style.transitionDelay = Math.min(i % 6, 5) * 60 + 'ms';
      observer.observe(el);
    });
    heroSpotlight();
    heroLitCells();
  });

  // Clicking (or tapping) an empty spot in the hero lights that grid cell; clicking it again turns it off.
  function heroLitCells() {
    var hero = document.querySelector('.hero');
    if (!hero) return;
    var CELL = 48;
    var layer = document.createElement('div');
    layer.className = 'hero-lit';
    layer.setAttribute('aria-hidden', 'true');
    hero.insertBefore(layer, hero.querySelector('.hero-inner'));
    var lit = {};

    hero.addEventListener('click', function (e) {
      if (e.target.closest('a, button') || String(window.getSelection())) return;
      var rect = hero.getBoundingClientRect();
      var col = Math.floor((e.clientX - rect.left) / CELL);
      var row = Math.floor((e.clientY - rect.top) / CELL);
      var key = col + ',' + row;
      var cell = lit[key];
      if (cell) {
        delete lit[key];
        cell.classList.add('is-off');
        cell.addEventListener('animationend', function () { cell.remove(); });
        return;
      }
      cell = document.createElement('span');
      cell.className = 'lit-cell';
      cell.style.setProperty('--x', col * CELL + 1 + 'px');
      cell.style.setProperty('--y', row * CELL + 1 + 'px');
      layer.appendChild(cell);
      lit[key] = cell;
    });
  }

  // Grid spotlight in the home page hero. Mouse/trackpad only, and off for reduced motion.
  function heroSpotlight() {
    var hero = document.querySelector('.hero');
    var spot = hero && hero.querySelector('.hero-spot');
    if (!spot || !window.matchMedia('(hover: hover) and (pointer: fine)').matches ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var CELL = 48;
    var target = { x: 0, y: 0 };
    var pos = null;
    var frame = 0;

    function tick() {
      // Ease towards the pointer so the light trails slightly behind it.
      pos.x += (target.x - pos.x) * 0.18;
      pos.y += (target.y - pos.y) * 0.18;
      spot.style.setProperty('--mx', pos.x + 'px');
      spot.style.setProperty('--my', pos.y + 'px');
      var settled = Math.abs(target.x - pos.x) < 0.5 && Math.abs(target.y - pos.y) < 0.5;
      frame = settled ? 0 : requestAnimationFrame(tick);
    }

    hero.addEventListener('pointermove', function (e) {
      var rect = hero.getBoundingClientRect();
      target.x = e.clientX - rect.left;
      target.y = e.clientY - rect.top;
      if (!pos) pos = { x: target.x, y: target.y };
      spot.style.setProperty('--cx', Math.floor(target.x / CELL) * CELL + 1 + 'px');
      spot.style.setProperty('--cy', Math.floor(target.y / CELL) * CELL + 1 + 'px');
      hero.classList.add('is-pointing');
      if (!frame) frame = requestAnimationFrame(tick);
    });
    hero.addEventListener('pointerleave', function () {
      hero.classList.remove('is-pointing');
    });
  }
})();
