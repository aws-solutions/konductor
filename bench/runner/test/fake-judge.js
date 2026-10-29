#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Test double for a judge model. Contract used by --judge-cmd: argv[2] is the
// model id, stdin is the prompt, stdout is the reply. FAKE_JUDGE_MODE picks a behavior.
const fs = require('node:fs');

const prompt = fs.readFileSync(0, 'utf8');
const mode = process.env.FAKE_JUDGE_MODE || 'good';
if (mode === 'sleep') {
  fs.writeFileSync(`${process.env.FAKE_JUDGE_PIDFILE}`, String(process.pid));
  setTimeout(() => {}, 60000);
  return;
}
if (mode === 'crash') { console.error('boom'); process.exit(3); }
if (mode === 'prose') { console.log('I think it is fine.'); process.exit(0); }
const ids = [...prompt.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]);
if (!prompt.includes('=== RESPONSE A ===')) {
  console.log(JSON.stringify({ criteria: ids.map((id) => ({ id, verdict: 'pass', evidence: 'a.txt' })) }));
} else {
  console.log(JSON.stringify({ winner: 'A', reason: 'first looked better' }));
}
