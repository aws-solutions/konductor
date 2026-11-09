// SPDX-License-Identifier: Apache-2.0
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const tokens = (text) => String(text).toLowerCase().match(/[a-z0-9]+/g) ?? [];

function jaccard(a, b) {
  const x = new Set(tokens(a));
  const y = new Set(tokens(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both);
}

// A reply may wrap its JSON in a code fence or add a sentence around it.
function parseJsonReply(text) {
  const s = String(text ?? '').trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  const start = body.search(/[{[]/);
  if (start < 0) throw new Error('no JSON in the reply');
  const open = body[start];
  const end = body.lastIndexOf(open === '{' ? '}' : ']');
  if (end < start) throw new Error('unterminated JSON in the reply');
  return JSON.parse(body.slice(start, end + 1));
}

// A text-only answer cannot show a saved file or a command that ran. Requests are checked for asking for one,
// checklist items for claiming one.
const REQUEST_SIDE_EFFECT = /\b(?:(?:save|saves|write|writes|store|stores|export|exports)\b[^.\n]{0,40}\b(?:files?|disk|path|directory|folder)\b|creat(?:e|es)\s+(?:a |an |the |new )*(?:\w+ )?files?|(?:run|runs|execute|executes|invoke)\s+(?:the |a |an |my |these |those )?(?:\w+ )?(?:commands?|tests?|scripts?|builds?|linter|suite)|commit|push|install|deploy|(?:modify|edit|update)\s+(?:the |my )?(?:\w+ )?files?)\b/i;
const ITEM_SIDE_EFFECT = /\b(?:(?:saved|wrote|written|stored|exported)\b[^.\n]{0,40}\b(?:files?|disk|path|directory|folder)\b|(?:file|files|report|document)\s+(?:is|are|was|were|has been|have been)\s+(?:created|written|saved|present|on disk)|created\s+(?:a |an |the |new )*(?:\w+ )?files?|(?:ran|executed|invoked)\s+(?:the |a |an )?(?:\w+ )?(?:commands?|tests?|scripts?|builds?|linter|suite)|committed|pushed|installed|deployed|(?:modified|edited|updated)\s+(?:the )?(?:\w+ )?files?)\b/i;

module.exports = { sha256, readJson, writeJson, tokens, jaccard, parseJsonReply, REQUEST_SIDE_EFFECT, ITEM_SIDE_EFFECT };
