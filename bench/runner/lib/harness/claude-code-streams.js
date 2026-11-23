// SPDX-License-Identifier: Apache-2.0
'use strict';

// The Claude Code stream readers (harness/streams.js, FW-17). The stream is `claude -p --output-format stream-json`.
// Claude Code arms take no --stop-on, so there is no stopEvent. trace.js is required at call time.

const parse = require('./claude-code-parse.js');

const blank = (t) => typeof t !== 'string' || !t.trim();

module.exports = {
  // The last result line's text, else (also when that text is blank) the last assistant text of the main session.
  finalText(events) {
    const a = parse.aggregateEvents(events);
    if (!blank(a.finalText)) return a.finalText;
    return blank(a.lastText) ? a.finalText ?? a.lastText : a.lastText;
  },
  timeline: (events) => require('../trace.js').claudeTimeline(events),
};
