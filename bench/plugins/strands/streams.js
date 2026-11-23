// SPDX-License-Identifier: Apache-2.0
'use strict';

// The Strands trace readers (runner/lib/harness/streams.js, FW-17). The stream is the launcher's JSONL trace.
// Strands has no trace and takes no --stop-on, so there is no timeline or stopEvent. Its plant reader stays in core
// (runner/lib/plant/stream-match.js): the plant scorer's readers are bench code a plugin cannot replace.

const { aggregateEvents } = require('./parse.js');

module.exports = {
  finalText: (events) => aggregateEvents(events).finalText,
};
