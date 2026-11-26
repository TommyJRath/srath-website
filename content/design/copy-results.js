document.querySelectorAll('.copy').forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.value);
    } catch {
      return; // no clipboard access (for example in some embedded frames): nothing to confirm
    }
    const label = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = label; }, 1400);
  });
});
