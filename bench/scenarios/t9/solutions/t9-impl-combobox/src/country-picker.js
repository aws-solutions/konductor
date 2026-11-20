const hook = '__countryPickerRank';

function getOrdering(query, source, supplied) {
  const custom = supplied || (typeof window !== 'undefined' && typeof window[hook] === 'function' ? window[hook] : null);
  const result = (custom || globalThis.harborRank)(query, source);
  return Array.isArray(result) ? result : [];
}

export function mountCountryPicker({ input, hidden, list, status, ranker } = {}) {
  if (!input || !hidden || !list || !status) throw new TypeError('Country picker needs its field elements');
  const countries = globalThis.harborCountries || [];
  let visibleItems = [];
  let active = -1;

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-activedescendant', '');
    active = -1;
  };

  const setActive = (next) => {
    if (!visibleItems.length) return;
    active = (next + visibleItems.length) % visibleItems.length;
    [...list.children].forEach((option, index) => option.setAttribute('aria-selected', String(index === active)));
    input.setAttribute('aria-activedescendant', list.children[active].id);
  };

  const choose = (item) => {
    input.value = item.name;
    hidden.value = item.code;
    [...list.children].forEach((option) => option.setAttribute('aria-selected', String(option.dataset.code === item.code)));
    status.textContent = `${item.name} selected.`;
    close();
    // Keep the selected option in the DOM so its state remains available to assistive technology.
    [...list.children].forEach((option) => option.setAttribute('aria-selected', String(option.dataset.code === item.code)));
  };

  const draw = (query) => {
    active = -1;
    input.setAttribute('aria-activedescendant', '');
    visibleItems = [];
    list.replaceChildren();
    const value = String(query ?? '').trim();
    if (!value) {
      close();
      status.textContent = 'Start typing to search countries.';
      return;
    }
    visibleItems = getOrdering(value, countries, ranker).slice(0, 8);
    if (!visibleItems.length) {
      close();
      status.textContent = 'No countries match that search.';
      return;
    }
    visibleItems.forEach((item, index) => {
      const option = document.createElement('li');
      option.id = `${list.id}-${item.code.toLowerCase()}`;
      option.dataset.code = item.code;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.textContent = item.name;
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => choose(item));
      list.append(option);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    status.textContent = `${visibleItems.length} ${visibleItems.length === 1 ? 'country' : 'countries'} available.`;
  };

  input.addEventListener('input', () => {
    // A new query is never allowed to submit the previous selection.
    hidden.value = '';
    draw(input.value);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (list.hidden) draw(input.value);
      if (visibleItems.length) setActive(active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) draw(input.value);
      if (visibleItems.length) setActive(active < 0 ? visibleItems.length - 1 : active - 1);
    } else if (event.key === 'Enter' && !list.hidden && active >= 0) {
      event.preventDefault();
      choose(visibleItems[active]);
    } else if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      close();
    }
  });

  input.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (!list.contains(document.activeElement)) close();
    }, 0);
  });

  return { redraw: draw, close };
}

if (typeof module !== 'undefined') module.exports = { mountCountryPicker };
if (typeof globalThis !== 'undefined') globalThis.mountCountryPicker = mountCountryPicker;
