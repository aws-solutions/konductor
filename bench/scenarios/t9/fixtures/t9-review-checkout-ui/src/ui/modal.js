export function openModal(root, title, message) {
  root.innerHTML = `<div class="modal-backdrop" role="presentation"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><h2 id="modal-title">${title}</h2><p>${message}</p><button data-close>Close</button></section></div>`;
  root.querySelector('[data-close]').addEventListener('click', () => closeModal(root));
  root.querySelector('[data-close]').focus();
}

export function closeModal(root) { root.replaceChildren(); }
