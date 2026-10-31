// SPDX-License-Identifier: Apache-2.0
'use strict';

// `report --verdict platform`: builds the verdict data from one or more run directories and writes verdict.md,
// verdict.html, verdict.json and charts/verdict-quality.svg.

const { buildVerdict } = require('./verdict.js');
const { buildVerdictDocument } = require('./verdictdoc.js');
const { writeOutputs, outPaths, formatOf } = require('./generate.js');

const KINDS = ['platform'];

function generateVerdict({ kind, dirs, benchDir, extraDirs, baseline, out, format, scoringFile, profile }) {
  if (!KINDS.includes(kind)) throw new Error(`--verdict takes ${KINDS.join(' or ')} (got ${JSON.stringify(kind)})`);
  const v = buildVerdict({ dirs, benchDir, extraDirs, baseline, scoringFile, profile });
  const doc = buildVerdictDocument(v);
  const { dir } = outPaths(out, v.dirs[0].dir);
  const written = writeOutputs({ dir, name: 'verdict', blocks: doc.blocks, charts: doc.charts, title: doc.title, format: formatOf(format), json: v });
  return { v, written };
}

module.exports = { generateVerdict, KINDS };
