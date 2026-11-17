// SPDX-License-Identifier: Apache-2.0
// The page's only script. It reads no data: a click copies the hidden, already escaped detail block named by data-d into
// the side panel, and the theme button flips data-theme. Nothing is fetched.
(function () {
  var drawer = document.getElementById('drawer-body');
  var cells = document.querySelectorAll('td[data-d]');
  function show(id) {
    var src = document.getElementById(id);
    if (!src) return;
    drawer.replaceChildren.apply(drawer, Array.prototype.map.call(src.childNodes, function (n) { return n.cloneNode(true); }));
    cells.forEach(function (c) { c.classList.toggle('sel', c.getAttribute('data-d') === id); });
  }
  cells.forEach(function (c) {
    c.addEventListener('click', function () { show(c.getAttribute('data-d')); });
    if (c.hasAttribute('tabindex')) c.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(c.getAttribute('data-d')); } });
  });
  var root = document.documentElement;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) root.setAttribute('data-theme', 'light');
  document.getElementById('theme').addEventListener('click', function () {
    root.setAttribute('data-theme', root.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  });
})();
