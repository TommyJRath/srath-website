const sw = document.querySelector('.lang-switch');
const thumb = sw.querySelector('.thumb');

// Puts the pill under the pressed button. The first time (and after a resize) without animation.
function moveThumb(animate) {
  const on = sw.querySelector('[aria-pressed="true"]');
  if (!animate) thumb.classList.add('instant');
  thumb.style.width = on.offsetWidth + 'px';
  thumb.style.transform = `translateX(${on.offsetLeft - 4}px)`; // 4px: the switch's padding
  if (!animate) {
    thumb.offsetWidth; // apply the position before turning the animation back on
    thumb.classList.remove('instant');
  }
}

// Every element with data-da and data-en swaps its text. On the real site the choice is
// also saved in localStorage, so the next page opens in the same language.
function setLanguage(lang) {
  document.documentElement.lang = lang;
  sw.querySelectorAll('[data-lang]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  });
  document.querySelectorAll('[data-da][data-en]').forEach((el) => {
    el.textContent = el.dataset[lang];
  });
  moveThumb(true);
}

sw.querySelectorAll('[data-lang]').forEach((b) => {
  b.addEventListener('click', () => setLanguage(b.dataset.lang));
});
addEventListener('resize', () => moveThumb(false));
moveThumb(false);
