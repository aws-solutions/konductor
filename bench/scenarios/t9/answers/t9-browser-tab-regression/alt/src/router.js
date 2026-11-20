const SAFE_HASH = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseSectionHash(value, allowed = []) {
  if (typeof value !== 'string') return null;
  const source = value.trim();
  if (!source.startsWith('#')) return null;

  let name;
  try {
    name = decodeURIComponent(source.slice(1)).trim().toLowerCase();
  } catch {
    return null;
  }

  return SAFE_HASH.test(name) && (allowed.length === 0 || allowed.includes(name)) ? name : null;
}

const headingIn = (panel) => panel.querySelector('[data-section-heading]') || panel.querySelector('h1, h2, h3');
const labelOf = (panel) => panel.dataset.title || headingIn(panel)?.textContent.trim() || 'Help article';

export function setupRouter(root = document) {
  const panels = [...root.querySelectorAll('[data-section]')];
  const controls = [...root.querySelectorAll('[data-section-link]')];
  const available = panels.map((panel) => panel.dataset.section).filter(Boolean);
  const browser = root.defaultView || (typeof window === 'undefined' ? root : window);
  const pageTitle = root.documentElement?.dataset.siteTitle || 'Northstar Help Centre';
  const navigator = browser.history || (typeof history === 'undefined' ? null : history);

  if (!panels.length || !controls.length) return { render: () => {} };
  const panelByName = new Map(panels.map((panel) => [panel.dataset.section, panel]));

  const focusPanel = (panel) => {
    const heading = headingIn(panel);
    if (!heading) return;
    if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  };

  function paint(requested, focus = true) {
    const chosen = panelByName.has(requested) ? requested : available[0];
    const panel = panelByName.get(chosen);
    panels.forEach((candidate) => {
      candidate.hidden = candidate !== panel;
      candidate.toggleAttribute('data-active', candidate === panel);
    });
    controls.forEach((control) => {
      const selected = control.dataset.sectionLink === chosen;
      control.setAttribute('aria-selected', String(selected));
      control.classList.toggle('is-current', selected);
    });
    root.title = `${labelOf(panel)} | ${pageTitle}`;
    if (focus) focusPanel(panel);
  }

  const locationHash = () => root.location?.hash ?? (typeof window === 'undefined' ? '' : window.location.hash);
  const refresh = (focus = true) => paint(parseSectionHash(locationHash(), available) || available[0], focus);

  const choose = (event) => {
    if (event.type === 'click' && (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
    if (event.type === 'keydown' && event.key !== 'Enter') return;
    const control = event.currentTarget;
    if (!panelByName.has(control.dataset.sectionLink)) return;
    event.preventDefault();
    if (navigator?.pushState) navigator.pushState({ section: control.dataset.sectionLink }, '', `#${control.dataset.sectionLink}`);
    else if (browser.location) browser.location.hash = `#${control.dataset.sectionLink}`;
    paint(control.dataset.sectionLink);
  };

  controls.forEach((control) => {
    control.addEventListener('click', choose);
    control.addEventListener('keydown', choose);
  });
  const restoreSelection = () => {
    refresh(true);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => refresh(true));
  };
  browser.addEventListener?.('popstate', restoreSelection);
  refresh(false);
  return { render: paint, showFromLocation: refresh };
}

if (typeof document !== 'undefined') setupRouter(document);
