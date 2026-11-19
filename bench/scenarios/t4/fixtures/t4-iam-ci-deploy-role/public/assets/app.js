(() => {
  const link = document.querySelector('.button');
  if (link) link.addEventListener('click', () => document.body.dataset.navigation = 'started');
})();
