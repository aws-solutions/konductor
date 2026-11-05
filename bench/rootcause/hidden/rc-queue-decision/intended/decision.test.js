'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const text = () => fs.readFileSync(path.join(__dirname, '..', 'docs', 'decision.md'), 'utf8');

const OPTION = {
  stream: /stream|option 2|event log|log-based/i,
  queue: /queue|option 1/i,
  broker: /broker|option 3|self-hosted/i,
};
const VERB = /\b(recommend\w*|decision|decide\w*|choose|chosen|choice|selected|select|go with|go for|pick|adopt|use|prefer\w*)\b/i;

function firstOption(text) {
  const found = Object.entries(OPTION)
    .map(([name, re]) => ({ name, at: text.search(re) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at);
  return found.length ? found[0].name : null;
}

// The option named right after the first decision verb; for a heading, the option in the next two lines.
function chosen(t) {
  const lines = t.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = VERB.exec(lines[i]);
    if (!m) continue;
    const here = firstOption(lines[i].slice(m.index + m[0].length));
    if (here) return here;
    if (/^\s*#/.test(lines[i])) {
      const next = lines.slice(i + 1).filter((l) => l.trim()).slice(0, 2).join(' ');
      const there = firstOption(next);
      if (there) return there;
    }
  }
  return null;
}

function near(t, anchor, wanted, width = 300) {
  const re = new RegExp(anchor.source, 'gi');
  for (const m of t.matchAll(re)) {
    const s = t.slice(Math.max(0, m.index - width), m.index + m[0].length + width);
    if (wanted.test(s)) return true;
  }
  return false;
}

test('the recommendation is the managed event stream', () => {
  assert.equal(chosen(text()), 'stream');
});

test('events are keyed by customer so each customer stays in order', () => {
  assert.match(text(), /(?:partition|key|order\w*)[^\n]{0,80}customer|customer[^\n]{0,80}(?:partition|key|order\w*)/i);
});

test('retention of at least 7 days is tied to replay', () => {
  const t = text();
  assert.ok(near(t, /7[- ]days?|seven days|one week|1 week|168 hours/, /replay|retention|retain|re-?read|reprocess/i), 'a 7-day window next to replay or retention');
});

test('the self-hosted broker is rejected because of the operations burden', () => {
  const t = text();
  assert.ok(near(t, /broker|self-hosted|option 3/, /operat|on-call|maintain|patch|team|engineers|managed|burden|upgrade/i), 'broker discussed with operations');
  assert.notEqual(chosen(t), 'broker');
});

test('the queue is rejected because it gives no replay or ordering', () => {
  const t = text();
  assert.ok(near(t, /queue|option 1/, /replay|retention|re-?read|delet|acknowledg|ordering|in order|fifo|consumed/i), 'queue discussed with replay or ordering');
  assert.notEqual(chosen(t), 'queue');
});
