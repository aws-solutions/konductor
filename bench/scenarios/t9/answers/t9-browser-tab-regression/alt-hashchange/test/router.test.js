import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSectionHash, setupRouter } from '../src/router.js';

test('parseSectionHash accepts a simple section hash', () => {
  assert.equal(parseSectionHash('#billing'), 'billing');
  assert.equal(parseSectionHash('  #getting-started  '), 'getting-started');
});

test('parseSectionHash decodes safe names and checks known sections', () => {
  assert.equal(parseSectionHash('#GETTING-STARTED', ['getting-started']), 'getting-started');
  assert.equal(parseSectionHash('#unknown', ['billing', 'security']), null);
  assert.equal(parseSectionHash('billing', ['billing']), null);
});

test('parseSectionHash rejects malformed values', () => {
  assert.equal(parseSectionHash(''), null);
  assert.equal(parseSectionHash('#two words'), null);
  assert.equal(parseSectionHash('#bad%2Fpath'), null);
  assert.equal(parseSectionHash(null), null);
});

class FakeClassList {
  toggle() {}
}

class FakeHeading {
  constructor(page, text) { this.page = page; this.textContent = text; this.attributes = new Set(); }
  hasAttribute(name) { return this.attributes.has(name); }
  set tabIndex(value) { this.attributes.add('tabindex'); this.tabIndexValue = value; }
  focus() { this.page.activeElement = this; }
}

class FakeSection {
  constructor(page, slug, label) {
    this.dataset = { section: slug, title: label };
    this.hidden = false;
    this.heading = new FakeHeading(page, label);
  }
  querySelector(selector) { return selector === '[data-section-heading]' ? this.heading : null; }
  toggleAttribute() {}
}

class FakeLink {
  constructor(slug) {
    this.dataset = { sectionLink: slug };
    this.values = new Map();
    this.classList = new FakeClassList();
    this.listeners = new Map();
  }
  setAttribute(name, value) { this.values.set(name, value); }
  getAttribute(name) { return this.values.get(name); }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
}

function makePage() {
  const page = {
    title: '',
    location: { hash: '#getting-started' },
    documentElement: { dataset: { siteTitle: 'Northstar Help Centre' } },
    activeElement: null,
  };
  page.sections = ['getting-started', 'billing'].map((slug) => new FakeSection(
    page,
    slug,
    slug === 'getting-started' ? 'Getting started' : 'Billing',
  ));
  page.links = ['getting-started', 'billing'].map((slug) => new FakeLink(slug));
  page.defaultView = {
    listeners: new Map(),
    history: { pushState: (_state, _title, hash) => { page.location.hash = hash; } },
    addEventListener(type, handler) { this.listeners.set(type, handler); },
  };
  page.querySelectorAll = (selector) => selector === '[data-section]' ? page.sections : page.links;
  return page;
}

test('history restoration updates the complete shared view', () => {
  const page = makePage();
  setupRouter(page);
  page.location.hash = '#billing';
  page.defaultView.listeners.get('hashchange')({ type: 'hashchange' });

  assert.equal(page.sections[0].hidden, true);
  assert.equal(page.sections[1].hidden, false);
  assert.equal(page.links[0].getAttribute('aria-selected'), 'false');
  assert.equal(page.links[1].getAttribute('aria-selected'), 'true');
  assert.equal(page.title, 'Billing | Northstar Help Centre');
  assert.equal(page.activeElement, page.sections[1].heading);
});
