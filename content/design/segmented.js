const buttons = document.querySelectorAll('.seg button');

buttons.forEach((button) => {
  button.addEventListener('click', () => {
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    document.querySelector('.out strong').textContent = button.textContent;
  });
});
