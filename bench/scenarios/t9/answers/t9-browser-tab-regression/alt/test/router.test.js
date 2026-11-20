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

class TinyHeading {
  constructor(host) { this.host = host; this.textContent = 'Billing'; this.attrs = new Set(); }
  hasAttribute(name) { return this.attrs.has(name); }
  set tabIndex(value) { this.attrs.add('tabindex'); this.tabIndexValue = value; }
  focus() { this.host.focused = this; }
}

class TinyPanel {
  constructor(host, slug) { this.dataset = { section: slug, title: slug[0].toUpperCase() + slug.slice(1) }; this.heading = new TinyHeading(host); this.hidden = false; }
  querySelector(selector) { return selector === '[data-section-heading]' ? this.heading : null; }
  toggleAttribute() {}
}

class TinyControl {
  constructor(slug) { this.dataset = { sectionLink: slug }; this.values = new Map(); this.classList = { toggle() {} }; this.callbacks = {}; }
  setAttribute(key, value) { this.values.set(key, value); }
  getAttribute(key) { return this.values.get(key); }
  addEventListener(kind, callback) { this.callbacks[kind] = callback; }
}

function testPage() {
  const host = { title: '', location: { hash: '#profile' }, documentElement: { dataset: { siteTitle: 'Northstar Help Centre' } }, focused: null };
  host.panels = ['profile', 'security'].map((slug) => new TinyPanel(host, slug));
  host.controls = ['profile', 'security'].map((slug) => new TinyControl(slug));
  host.defaultView = {
    events: {},
    addEventListener(kind, callback) { this.events[kind] = callback; },
    history: { pushState: (_state, _title, hash) => { host.location.hash = hash; } },
  };
  host.querySelectorAll = (selector) => selector === '[data-section]' ? host.panels : host.controls;
  return host;
}

test('router repaints the section restored by browser history', () => {
  const host = testPage();
  setupRouter(host);
  host.location.hash = '#security';
  host.defaultView.events.popstate();
  assert.equal(host.panels[0].hidden, true);
  assert.equal(host.panels[1].hidden, false);
  assert.equal(host.controls[0].getAttribute('aria-selected'), 'false');
  assert.equal(host.controls[1].getAttribute('aria-selected'), 'true');
  assert.equal(host.title, 'Security | Northstar Help Centre');
  assert.equal(host.focused, host.panels[1].heading);
});
