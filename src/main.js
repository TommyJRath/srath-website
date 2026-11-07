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
  });
})();
