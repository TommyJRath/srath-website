// A demo login form: nothing is sent anywhere. The character's eyes follow what you type in the email
// field, its hands cover its eyes while you are at the password, and when you show the password it peeks
// between its fingers, its eye following what you type.
const buddy = document.querySelector('.buddy');
const form = document.querySelector('.login-form');
const email = document.getElementById('email');
const password = document.getElementById('password');
const show = document.getElementById('show');
const note = document.getElementById('note');

// Eyes: look at the text cursor in the field you are typing in. The pupils move along the line from
// the eyes to the caret, up to a few units in the drawing (a little less while peeking through the fingers).
function look(x, y) {
  buddy.style.setProperty('--look-x', x + 'px');
  buddy.style.setProperty('--look-y', y + 'px');
}
const measure = document.createElement('canvas').getContext('2d');
function caretPoint(input) {
  const style = getComputedStyle(input);
  measure.font = style.font;
  const pos = input.selectionStart ?? input.value.length;
  const text = input.type === 'password' ? '•'.repeat(pos) : input.value.slice(0, pos);
  const box = input.getBoundingClientRect();
  const x = box.left + parseFloat(style.paddingLeft) + measure.measureText(text).width - input.scrollLeft;
  return { x: Math.min(Math.max(x, box.left), box.right), y: box.top + box.height / 2 };
}
function followCaret() {
  const peeking = buddy.classList.contains('is-peeking');
  const input = document.activeElement === email ? email : peeking ? password : null;
  if (!input) return;
  const box = buddy.getBoundingClientRect();
  const eyes = { x: box.left + box.width / 2, y: box.top + box.height * 104 / 200 }; // between the eyes
  const caret = caretPoint(input);
  const dx = caret.x - eyes.x, dy = caret.y - eyes.y;
  const dist = Math.hypot(dx, dy) || 1;
  const reach = peeking ? 4 : 5;
  look(dx / dist * reach, dy / dist * reach);
}

// Hands: cover while the password field or its Show button has focus; peek while the password is shown.
function update() {
  const atPassword = document.activeElement === password || document.activeElement === show;
  const shown = password.type === 'text';
  buddy.classList.toggle('is-covering', atPassword);
  buddy.classList.toggle('is-peeking', atPassword && shown);
  if (document.activeElement === email || (atPassword && shown)) followCaret();
  else look(0, 0);
}

for (const input of [email, password]) {
  input.addEventListener('input', followCaret);
  input.addEventListener('keyup', followCaret);
  input.addEventListener('click', followCaret);
}
form.addEventListener('focusin', update);
form.addEventListener('focusout', () => setTimeout(update)); // after focus has moved on

show.addEventListener('click', () => {
  const showing = password.type === 'password';
  password.type = showing ? 'text' : 'password';
  show.setAttribute('aria-pressed', String(showing));
  show.textContent = showing ? 'Hide' : 'Show';
  password.focus(); // back to typing (and Safari doesn't focus a clicked button)
  update();
});

form.addEventListener('submit', (e) => {
  e.preventDefault(); // a demo: nothing is sent anywhere
  note.textContent = 'Demo only. Nothing is sent anywhere.';
  buddy.classList.remove('is-nodding');
  void buddy.getBoundingClientRect(); // restart the nod
  buddy.classList.add('is-nodding');
});
buddy.addEventListener('animationend', (e) => {
  if (e.animationName === 'nod') buddy.classList.remove('is-nodding');
});
