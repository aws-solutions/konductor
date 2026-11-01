// SPDX-License-Identifier: Apache-2.0
'use strict';

// `report --verdict platform|orchestrator-pass`: builds the verdict data from one or more run directories. platform writes
// verdict.md, verdict.html, verdict.json and charts/verdict-quality.svg; orchestrator-pass writes orchestrator-pass.md, .html and .json.

const { buildVerdict } = require('./verdict.js');
const { buildVerdictDocument } = require('./verdictdoc.js');
const { buildOrchestratorPass } = require('./orchpass.js');
const { buildOrchestratorPassDocument } = require('./orchpassdoc.js');
const { writeOutputs, outPaths, formatOf } = require('./generate.js');

const KINDS = ['platform', 'orchestrator-pass'];

function generateVerdict({ kind, dirs, benchDir, extraDirs, baseline, out, format, scoringFile, profile, testArms = null, changedSkills = null, phases = null }) {
  if (!KINDS.includes(kind)) throw new Error(`--verdict takes ${KINDS.join(' or ')} (got ${JSON.stringify(kind)})`);
  if (kind === 'orchestrator-pass') {
    const v = buildOrchestratorPass({ dirs, benchDir, extraDirs, baseline, testArms, changedSkills, scoringFile, phases });
    const doc = buildOrchestratorPassDocument(v);
    const { dir } = outPaths(out, dirs[0]);
    const written = writeOutputs({ dir, name: 'orchestrator-pass', blocks: doc.blocks, charts: doc.charts, title: doc.title, format: formatOf(format), json: v });
    return { v, written };
  }
  const v = buildVerdict({ dirs, benchDir, extraDirs, baseline, scoringFile, profile });
  const doc = buildVerdictDocument(v);
  const { dir } = outPaths(out, v.dirs[0].dir);
  const written = writeOutputs({ dir, name: 'verdict', blocks: doc.blocks, charts: doc.charts, title: doc.title, format: formatOf(format), json: v });
  return { v, written };
}

module.exports = { generateVerdict, KINDS };
