'use strict';

const events = require('../analytics/events.json');

function eventNames() { return events.map((event) => event.name); }

module.exports = { eventNames };
