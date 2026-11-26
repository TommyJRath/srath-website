const input = document.getElementById('rate');
const error = document.getElementById('rate-error');
const out = document.getElementById('with-vat');
const money = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Accepts "1,250.50", "1250.5" and "1 250"; anything else is not a number.
function parse(text) {
  const s = text.replace(/[\s,]/g, '');
  return /^\d*\.?\d+$/.test(s) ? Number(s) : NaN;
}

input.addEventListener('input', () => {
  const value = parse(input.value);
  const bad = input.value.trim() !== '' && Number.isNaN(value);
  input.setAttribute('aria-invalid', String(bad));
  error.hidden = !bad;
  out.textContent = Number.isNaN(value) ? '–' : money.format(value * 1.25) + ' kr.';
});
