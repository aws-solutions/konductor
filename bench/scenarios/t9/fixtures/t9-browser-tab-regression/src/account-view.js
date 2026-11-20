export function prepareAccountStatus() {
  const status = document.querySelector('[data-account-status]');
  if (!status) return;

  requestAnimationFrame(() => {
    if (document.activeElement === document.body) {
      status.focus({ preventScroll: true });
    }
  });
}

if (typeof document !== 'undefined') prepareAccountStatus();
