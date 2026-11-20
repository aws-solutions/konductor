const itemQuery = '[data-roving-item]';

function unavailable(value) {
  if (!value) return true;
  if (value.disabled === true || value.ariaDisabled === true) return true;
  return Boolean(value.getAttribute && (
    value.getAttribute('aria-disabled') === 'true'
    || value.getAttribute('data-disabled') === 'true'
    || value.hasAttribute('disabled')
  ));
}

function usableAt(list, from) {
  if (!list.length) return -1;
  const pivot = Math.max(0, Math.min(from, list.length - 1));
  for (let distance = 0; distance < list.length; distance += 1) {
    const right = pivot + distance;
    if (right < list.length && !unavailable(list[right])) return right;
    if (distance) {
      const left = pivot - distance;
      if (left >= 0 && !unavailable(list[left])) return left;
    }
  }
  return -1;
}

function cycleTo(list, at, increment) {
  if (!list.length) return -1;
  const step = increment < 0 ? -1 : 1;
  for (let count = 1; count <= list.length; count += 1) {
    const candidate = (at + step * count + list.length * 2) % list.length;
    if (!unavailable(list[candidate])) return candidate;
  }
  return -1;
}

function isUnavailable(item) {
  return unavailable(item);
}

function findEnabledIndex(items, preferredIndex = 0) {
  return usableAt(items, preferredIndex);
}

function nextEnabledIndex(items, currentIndex, direction = 1) {
  return cycleTo(items, currentIndex, direction);
}

function reconcileRoving(items, preferredIndex = 0) {
  const activeIndex = usableAt(items, preferredIndex);
  return {
    activeIndex,
    items: items.map((item, index) => ({ ...item, tabIndex: index === activeIndex ? 0 : -1, selected: index === activeIndex })),
  };
}

function createRoving(container, options = {}) {
  const query = options.itemSelector || itemQuery;
  const all = () => [...container.querySelectorAll(query)];
  let current = all().find((node) => node.tabIndex === 0) || all()[0] || null;
  let remembered = current ? all().indexOf(current) : 0;

  const settle = () => {
    const nodes = all();
    const oldPosition = current ? nodes.indexOf(current) : -1;
    const state = reconcileRoving(nodes, oldPosition < 0 ? remembered : oldPosition);
    current = state.activeIndex < 0 ? null : nodes[state.activeIndex];
    if (current) remembered = state.activeIndex;
    nodes.forEach((node, index) => {
      node.tabIndex = index === state.activeIndex ? 0 : -1;
      if (node.hasAttribute('aria-selected')) node.setAttribute('aria-selected', `${index === state.activeIndex}`);
    });
    return current;
  };

  const choose = (node, focus = false) => {
    if (!all().includes(node) || unavailable(node)) return null;
    current = node;
    settle();
    if (focus && current) current.focus();
    return current;
  };
  const key = (event) => {
    const nodes = all();
    const owner = event.target.closest(query);
    if (!owner || !nodes.includes(owner)) return;
    settle();
    const here = nodes.indexOf(current);
    let destination = -1;
    if (event.key === 'Home') destination = usableAt(nodes, 0);
    else if (event.key === 'End') destination = usableAt(nodes, nodes.length - 1);
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') destination = cycleTo(nodes, here, 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') destination = cycleTo(nodes, here, -1);
    if (destination < 0 || destination === here) return;
    event.preventDefault();
    current = nodes[destination];
    settle();
    current.focus();
  };
  const focus = (event) => {
    const owner = event.target.closest(query);
    if (owner) choose(owner);
  };
  const click = (event) => {
    const owner = event.target.closest(query);
    if (owner && !unavailable(owner)) choose(owner);
  };
  container.addEventListener('keydown', key);
  container.addEventListener('focusin', focus);
  container.addEventListener('click', click);
  const watcher = new MutationObserver(settle);
  watcher.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-disabled', 'data-disabled', 'disabled'] });
  settle();
  return { refresh: settle, activeItem: () => current, focusActive: () => current?.focus(), destroy() { watcher.disconnect(); container.removeEventListener('keydown', key); container.removeEventListener('focusin', focus); container.removeEventListener('click', click); } };
}

const rovingApi = { isUnavailable, findEnabledIndex, nextEnabledIndex, reconcileRoving, createRoving };
if (typeof module !== 'undefined' && module.exports) module.exports = rovingApi;
if (typeof globalThis !== 'undefined') globalThis.NorthstarRoving = rovingApi;
