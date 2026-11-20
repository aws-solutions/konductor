const DEFAULT_ITEM_SELECTOR = '[data-roving-item]';

function isUnavailable(item) {
  if (!item) return true;
  if (typeof item.disabled === 'boolean' && item.disabled) return true;
  if (item.getAttribute) {
    return item.getAttribute('aria-disabled') === 'true'
      || item.getAttribute('data-disabled') === 'true'
      || item.hasAttribute('disabled');
  }
  return Boolean(item.ariaDisabled);
}

function findEnabledIndex(items, preferredIndex = 0) {
  if (!items.length) return -1;
  const start = Math.min(Math.max(preferredIndex, 0), items.length - 1);
  if (!isUnavailable(items[start])) return start;
  for (let distance = 1; distance < items.length; distance += 1) {
    const forward = start + distance;
    if (forward < items.length && !isUnavailable(items[forward])) return forward;
    const backward = start - distance;
    if (backward >= 0 && !isUnavailable(items[backward])) return backward;
  }
  return -1;
}

function nextEnabledIndex(items, currentIndex, direction = 1) {
  if (!items.length) return -1;
  const step = direction < 0 ? -1 : 1;
  for (let distance = 1; distance <= items.length; distance += 1) {
    const index = (currentIndex + step * distance + items.length * 2) % items.length;
    if (!isUnavailable(items[index])) return index;
  }
  return -1;
}

function reconcileRoving(items, preferredIndex = 0) {
  const activeIndex = findEnabledIndex(items, preferredIndex);
  return {
    activeIndex,
    items: items.map((item, index) => ({
      ...item,
      tabIndex: index === activeIndex ? 0 : -1,
      selected: index === activeIndex,
    })),
  };
}

function createRoving(container, options = {}) {
  const itemSelector = options.itemSelector || DEFAULT_ITEM_SELECTOR;
  const getItems = () => [...container.querySelectorAll(itemSelector)];
  let active = getItems().find((item) => item.tabIndex === 0) || getItems()[0] || null;
  let lastPosition = active ? getItems().indexOf(active) : 0;

  function sync() {
    const items = getItems();
    const currentPosition = active ? items.indexOf(active) : -1;
    const preferred = currentPosition >= 0 ? currentPosition : lastPosition;
    const state = reconcileRoving(items, preferred);
    active = state.activeIndex >= 0 ? items[state.activeIndex] : null;
    if (active) lastPosition = state.activeIndex;
    items.forEach((item, index) => {
      item.tabIndex = index === state.activeIndex ? 0 : -1;
      if (item.hasAttribute('aria-selected')) item.setAttribute('aria-selected', String(index === state.activeIndex));
    });
    return active;
  }

  function activate(item, shouldFocus = false) {
    const items = getItems();
    if (!items.includes(item) || isUnavailable(item)) return null;
    active = item;
    sync();
    if (shouldFocus) active.focus();
    return active;
  }

  function onKeydown(event) {
    const items = getItems();
    const current = event.target.closest(itemSelector);
    if (!current || !items.includes(current)) return;
    sync();
    const currentIndex = items.indexOf(active);
    let next = -1;
    if (event.key === 'Home') next = findEnabledIndex(items, 0);
    if (event.key === 'End') next = findEnabledIndex(items, items.length - 1);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = nextEnabledIndex(items, currentIndex, 1);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = nextEnabledIndex(items, currentIndex, -1);
    if (next < 0 || next === currentIndex) return;
    event.preventDefault();
    active = items[next];
    sync();
    active.focus();
  }

  function onFocusin(event) {
    const item = event.target.closest(itemSelector);
    if (item) activate(item);
  }

  function onClick(event) {
    const item = event.target.closest(itemSelector);
    if (item && !isUnavailable(item)) activate(item);
  }

  container.addEventListener('keydown', onKeydown);
  container.addEventListener('focusin', onFocusin);
  container.addEventListener('click', onClick);
  const observer = new MutationObserver(() => sync());
  observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-disabled', 'data-disabled', 'disabled'] });
  sync();

  return {
    refresh: sync,
    activeItem: () => active,
    focusActive: () => { if (active) active.focus(); },
    destroy() {
      observer.disconnect();
      container.removeEventListener('keydown', onKeydown);
      container.removeEventListener('focusin', onFocusin);
      container.removeEventListener('click', onClick);
    },
  };
}

const rovingApi = { isUnavailable, findEnabledIndex, nextEnabledIndex, reconcileRoving, createRoving };
if (typeof module !== 'undefined' && module.exports) module.exports = rovingApi;
if (typeof globalThis !== 'undefined') globalThis.NorthstarRoving = rovingApi;
