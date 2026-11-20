'use strict';
// Retained for importers that still display the first-generation label set.
const labels = new Map([['NEW', 'New'], ['RECEIVED', 'Received'], ['REFUNDED', 'Refunded']]);
function displayState(state) { return labels.get(state) || 'Unknown'; }
module.exports = { displayState };
