'use strict';

const defaults = Object.freeze({ dataFile: 'data/entries.json', weekStartsOn: 'monday' });

function settings(overrides = {}) {
  return { ...defaults, ...overrides };
}

module.exports = { defaults, settings };
