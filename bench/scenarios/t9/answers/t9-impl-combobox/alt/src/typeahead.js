const externalSorter = '__countryPickerRank';

export function installCountrySearch(field, codeField, menu, announcement) {
  const countries = globalThis.harborCountries || [];
  const arrange = globalThis.harborRank;
  const state = { choices: [], cursor: -1 };
  const sorter = () => typeof window[externalSorter] === 'function' ? window[externalSorter] : arrange;

  const collapse = () => {
    menu.hidden = true;
    field.setAttribute('aria-expanded', 'false');
    field.removeAttribute('aria-activedescendant');
    state.cursor = -1;
  };

  const highlight = (position) => {
    if (!state.choices.length) return;
    state.cursor = (position + state.choices.length) % state.choices.length;
    [...menu.children].forEach((node, index) => node.setAttribute('aria-selected', String(index === state.cursor)));
    field.setAttribute('aria-activedescendant', menu.children[state.cursor].id);
  };

  const select = (country) => {
    field.value = country.name;
    codeField.value = country.code;
    [...menu.children].forEach((node) => node.setAttribute('aria-selected', String(node.dataset.country === country.code)));
    announcement.textContent = `${country.name} selected.`;
    collapse();
    [...menu.children].forEach((node) => node.setAttribute('aria-selected', String(node.dataset.country === country.code)));
  };

  const refresh = () => {
    state.choices = [];
    state.cursor = -1;
    menu.replaceChildren();
    field.removeAttribute('aria-activedescendant');
    const query = field.value.trim();
    if (!query) {
      collapse();
      announcement.textContent = 'Start typing to search countries.';
      return;
    }
    const found = sorter()(query, countries);
    state.choices = Array.isArray(found) ? found.slice(0, 8) : [];
    if (!state.choices.length) {
      collapse();
      announcement.textContent = 'No countries match that search.';
      return;
    }
    state.choices.forEach((country, index) => {
      const node = document.createElement('div');
      node.id = `${menu.id}-choice-${index}`;
      node.dataset.country = country.code;
      node.setAttribute('role', 'option');
      node.setAttribute('aria-selected', 'false');
      node.textContent = country.name;
      node.addEventListener('mousedown', (event) => event.preventDefault());
      node.addEventListener('click', () => select(country));
      menu.append(node);
    });
    menu.hidden = false;
    field.setAttribute('aria-expanded', 'true');
    announcement.textContent = `${state.choices.length} countries available.`;
  };

  field.setAttribute('role', 'combobox');
  field.setAttribute('aria-autocomplete', 'list');
  field.setAttribute('aria-controls', menu.id);
  field.setAttribute('aria-expanded', 'false');
  field.addEventListener('input', () => { codeField.value = ''; refresh(); });
  field.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (menu.hidden) refresh();
      if (state.choices.length) highlight(event.key === 'ArrowDown' ? state.cursor + 1 : (state.cursor < 0 ? state.choices.length - 1 : state.cursor - 1));
    } else if (event.key === 'Enter' && state.cursor >= 0 && !menu.hidden) {
      event.preventDefault();
      select(state.choices[state.cursor]);
    } else if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault();
      collapse();
    }
  });
  field.addEventListener('blur', () => window.setTimeout(() => { if (!menu.contains(document.activeElement)) collapse(); }, 0));
  return { refresh, collapse };
}

if (typeof module !== 'undefined') module.exports = { installCountrySearch };
if (typeof globalThis !== 'undefined') globalThis.installCountrySearch = installCountrySearch;
