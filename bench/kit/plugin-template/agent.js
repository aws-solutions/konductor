#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// The template "agent": stands in for your agent CLI. It takes the prompt as its last argument and prints one JSON
// event per line, the shape the template harness reads (harness.js parseEvents). Replace it with your agent's command.
//   node agent.js --model <model> <prompt>
const args = process.argv.slice(2);
const model = args[args.indexOf('--model') + 1] ?? 'fake';
const prompt = args.at(-1) ?? '';
const line = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
line({ type: 'start', sessionId: 'tpl-session-1', model });
line({ type: 'tool_use', name: 'read' });
line({ type: 'usage', input: prompt.length, output: 4, costUsd: 0 });
line({ type: 'end', status: 'success', stopReason: 'end_turn', text: 'done' });
