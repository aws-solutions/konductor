const SECTION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Return the usable section name from a location hash.
 * This function deliberately has no DOM dependency so content checks can use it.
 */
export function parseSectionHash(value, allowed = []) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed.startsWith('#')) return null;

  let section;
  try {
    section = decodeURIComponent(trimmed.slice(1)).trim().toLowerCase();
  } catch {
    return null;
  }

  if (!SECTION_PATTERN.test(section)) return null;
  if (allowed.length > 0 && !allowed.includes(section)) return null;
  return section;
}

function headingFor(section) {
  return section.querySelector('[data-section-heading]') || section.querySelector('h1, h2, h3');
}

function sectionTitle(section) {
  return section.dataset.title || headingFor(section)?.textContent.trim() || 'Help article';
}

/**
 * Connect the page's section links to its hash-addressed sections.
 */
export function setupRouter(root = document) {
  const sections = [...root.querySelectorAll('[data-section]')];
  const links = [...root.querySelectorAll('[data-section-link]')];
  const names = sections.map((section) => section.dataset.section).filter(Boolean);
  const siteTitle = root.documentElement?.dataset.siteTitle || 'Northstar Help Centre';

  if (sections.length === 0 || links.length === 0) return { render: () => {} };

  const byName = new Map(sections.map((section) => [section.dataset.section, section]));

  function setPageTitle(section) {
    const title = sectionTitle(section);
    root.title = `${title} | ${siteTitle}`;
  }

  function moveFocus(section) {
    const heading = headingFor(section);
    if (!heading) return;
    if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }

  function render(name, shouldFocus = true) {
    const activeName = byName.has(name) ? name : names[0];
    const activeSection = byName.get(activeName);

    sections.forEach((section) => {
      const isActive = section === activeSection;
      section.hidden = !isActive;
      section.toggleAttribute('data-active', isActive);
    });

    links.forEach((link) => {
      const isActive = link.dataset.sectionLink === activeName;
      link.setAttribute('aria-selected', String(isActive));
      link.classList.toggle('is-current', isActive);
    });

    setPageTitle(activeSection);
    if (shouldFocus) moveFocus(activeSection);
  }

  function showFromLocation(shouldFocus = true) {
    const name = parseSectionHash(root.location?.hash ?? window.location.hash, names) || names[0];
    render(name, shouldFocus);
  }

  function activate(event) {
    if (event.type === 'click') {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    }
    if (event.type === 'keydown' && event.key !== 'Enter') return;

    const link = event.currentTarget;
    const name = link.dataset.sectionLink;
    if (!byName.has(name)) return;
    event.preventDefault();
    history.pushState({ section: name }, '', `#${name}`);
    render(name, false);
  }

  links.forEach((link) => {
    link.addEventListener('click', activate);
    link.addEventListener('keydown', activate);
  });

  if (typeof window !== 'undefined') window.addEventListener('hashchange', () => showFromLocation());
  showFromLocation(false);

  return { render, showFromLocation };
}

if (typeof document !== 'undefined') {
  setupRouter(document);
}
