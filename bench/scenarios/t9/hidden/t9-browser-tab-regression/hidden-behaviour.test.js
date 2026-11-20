import test from 'node:test';
import assert from 'node:assert/strict';

const routerReady = import('./src/router.js');

test('section hashes accept trimmed safe names', async () => {
  const { parseSectionHash } = await routerReady;
  assert.equal(parseSectionHash('  #billing  '), 'billing');
  assert.equal(parseSectionHash('#GETTING-STARTED'), 'getting-started');
});

test('section hashes decode an encoded safe name', async () => {
  const { parseSectionHash } = await routerReady;
  assert.equal(parseSectionHash('#getting%2Dstarted'), 'getting-started');
});

test('section hashes reject malformed and non-hash values', async () => {
  const { parseSectionHash } = await routerReady;
  assert.equal(parseSectionHash('billing'), null);
  assert.equal(parseSectionHash('#two words'), null);
  assert.equal(parseSectionHash('#bad%2Fpath'), null);
});

test('section hashes reject names outside the allowed page sections', async () => {
  const { parseSectionHash } = await routerReady;
  assert.equal(parseSectionHash('#notifications', ['profile', 'security']), null);
  assert.equal(parseSectionHash('#security', ['profile', 'security']), 'security');
});

class ClassNames { toggle() {} }

class Heading {
  constructor(page, text) { this.page = page; this.textContent = text; this.attributes = new Set(); }
  hasAttribute(name) { return this.attributes.has(name); }
  set tabIndex(value) { this.attributes.add('tabindex'); this.tabIndexValue = value; }
  focus() { this.page.activeElement = this; }
}

class Section {
  constructor(page, slug, label) {
    this.dataset = { section: slug, title: label };
    this.heading = new Heading(page, label);
    this.hidden = false;
  }
  querySelector(selector) { return selector === '[data-section-heading]' ? this.heading : null; }
  toggleAttribute() {}
}

class Link {
  constructor(slug) { this.dataset = { sectionLink: slug }; this.values = new Map(); this.classList = new ClassNames(); this.handlers = {}; }
  setAttribute(name, value) { this.values.set(name, value); }
  getAttribute(name) { return this.values.get(name); }
  addEventListener(type, handler) { this.handlers[type] = handler; }
}

function pageFor(slugs) {
  const page = {
    title: '',
    location: { hash: `#${slugs[0]}` },
    documentElement: { dataset: { siteTitle: 'Northstar Help Centre' } },
    activeElement: null,
  };
  page.sections = slugs.map((slug) => new Section(page, slug, slug === 'getting-started' ? 'Getting started' : slug[0].toUpperCase() + slug.slice(1)));
  page.links = slugs.map((slug) => new Link(slug));
  page.defaultView = {
    listeners: {},
    history: { pushState: (_state, _title, hash) => { page.location.hash = hash; } },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    restore() { this.listeners.popstate?.({ type: 'popstate' }); },
  };
  page.querySelectorAll = (selector) => selector === '[data-section]' ? page.sections : page.links;
  return page;
}

function restore(page, hash) {
  page.location.hash = hash;
  page.defaultView.restore();
}

test('restored article changes visibility, selection, title, and focus together', async () => {
  const { setupRouter } = await routerReady;
  const page = pageFor(['getting-started', 'billing', 'security']);
  setupRouter(page);
  restore(page, '#billing');
  assert.equal(page.sections[0].hidden, true);
  assert.equal(page.sections[1].hidden, false);
  assert.equal(page.links[1].getAttribute('aria-selected'), 'true');
  assert.equal(page.title, 'Billing | Northstar Help Centre');
  assert.equal(page.activeElement, page.sections[1].heading);
});

test('restoring forward navigation selects the later article', async () => {
  const { setupRouter } = await routerReady;
  const page = pageFor(['getting-started', 'billing', 'security']);
  setupRouter(page);
  restore(page, '#billing');
  restore(page, '#security');
  assert.equal(page.sections[1].hidden, true);
  assert.equal(page.links[2].getAttribute('aria-selected'), 'true');
  assert.equal(page.title, 'Security | Northstar Help Centre');
  assert.equal(page.activeElement, page.sections[2].heading);
});

test('account sections use the same restored-state behavior', async () => {
  const { setupRouter } = await routerReady;
  const page = pageFor(['profile', 'security', 'notifications']);
  setupRouter(page);
  restore(page, '#notifications');
  assert.equal(page.sections[2].hidden, false);
  assert.equal(page.links[0].getAttribute('aria-selected'), 'false');
  assert.equal(page.title, 'Notifications | Northstar Help Centre');
  assert.equal(page.activeElement, page.sections[2].heading);
});

test('enter activation adds one history state and later restoration works', async () => {
  const { setupRouter } = await routerReady;
  const page = pageFor(['getting-started', 'billing']);
  setupRouter(page);
  let entries = 0;
  const originalPush = page.defaultView.history.pushState;
  page.defaultView.history.pushState = (...args) => { entries += 1; originalPush(...args); };
  let prevented = false;
  page.links[1].handlers.keydown({ type: 'keydown', key: 'Enter', currentTarget: page.links[1], preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(entries, 1);
  restore(page, '#getting-started');
  assert.equal(page.activeElement, page.sections[0].heading);
  assert.equal(page.links[0].getAttribute('aria-selected'), 'true');
});

test('an invalid restored hash still renders the page default consistently', async () => {
  const { setupRouter } = await routerReady;
  const page = pageFor(['getting-started', 'billing']);
  setupRouter(page);
  restore(page, '#not-a-section');
  assert.equal(page.sections[0].hidden, false);
  assert.equal(page.links[0].getAttribute('aria-selected'), 'true');
  assert.equal(page.title, 'Getting started | Northstar Help Centre');
  assert.equal(page.activeElement, page.sections[0].heading);
});

test('repeated history restores keep the shared title in step with the section', async () => {
  const { setupRouter } = await routerReady;
  const page = pageFor(['profile', 'security', 'notifications']);
  setupRouter(page);
  restore(page, '#security');
  assert.equal(page.title, 'Security | Northstar Help Centre');
  restore(page, '#profile');
  assert.equal(page.title, 'Profile | Northstar Help Centre');
  assert.equal(page.activeElement, page.sections[0].heading);
});
