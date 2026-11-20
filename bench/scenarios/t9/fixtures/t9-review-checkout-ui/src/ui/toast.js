export function mountToast(root, message) {
  root.textContent = message;
  const announce = () => { root.dataset.connection = navigator.onLine ? 'online' : 'offline'; };
  window.addEventListener('online', announce);
  window.addEventListener('offline', announce);
  setTimeout(() => { root.textContent = ''; }, 4500);
}
