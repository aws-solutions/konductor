// SPDX-License-Identifier: Apache-2.0
'use strict';

// Identifies the text a judge was given about a task (prompt, rubric, answer key). A record made
// against an earlier version of any of these is stale once the task is reworded, and the report
// leaves it out rather than mixing two wordings in one mean.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ANSWER_KEY } = require('../runner/lib/check-matcher.js');

function readAnswerKey(fixtureDir) {
  const file = path.join(fixtureDir, ANSWER_KEY);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function taskRevision(task) {
  const material = JSON.stringify({ prompt: task.prompt, rubric: task.rubric, answerKey: readAnswerKey(task.fixtureDir) });
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 12);
}

module.exports = { taskRevision, readAnswerKey };
