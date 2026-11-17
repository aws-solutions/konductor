// SPDX-License-Identifier: Apache-2.0
// The page's only script. Steps open and close as native <details> without it. It adds: Expand all and Collapse all,
// a "more" button that copies the hidden, already escaped extras block named by data-d into the side panel (Close or
// Escape hides it), and the theme button. It reads no data and fetches nothing.
(function () {
  var panel = document.getElementById('drawer');
  var body = document.getElementById('drawer-body');
  var more = document.querySelectorAll('button.more[data-d]');
  function show(button) {
    var src = document.getElementById(button.getAttribute('data-d'));
    if (!src) return;
    body.replaceChildren.apply(body, Array.prototype.map.call(src.childNodes, function (n) { return n.cloneNode(true); }));
    more.forEach(function (b) { b.classList.toggle('sel', b === button); });
    panel.hidden = false;
  }
  function hide() {
    panel.hidden = true;
    more.forEach(function (b) { b.classList.remove('sel'); });
  }
  more.forEach(function (b) { b.addEventListener('click', function () { show(b); }); });
  document.getElementById('drawer-close').addEventListener('click', hide);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  function setAll(open) {
    document.querySelectorAll('details.step, details.agent').forEach(function (d) { d.open = open; });
  }
  document.getElementById('expand-all').addEventListener('click', function () { setAll(true); });
  document.getElementById('collapse-all').addEventListener('click', function () { setAll(false); });
  var root = document.documentElement;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) root.setAttribute('data-theme', 'light');
  document.getElementById('theme').addEventListener('click', function () {
    root.setAttribute('data-theme', root.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  });
})();
