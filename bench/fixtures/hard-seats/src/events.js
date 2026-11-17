'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** The events of config/events.json (or of `file`), keyed by event id. */
function loadEvents(file = path.join(__dirname, '..', 'config', 'events.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = { loadEvents };
