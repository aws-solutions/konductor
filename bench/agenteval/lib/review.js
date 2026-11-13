// SPDX-License-Identifier: Apache-2.0
'use strict';

// Renders review.md: a header the reviewer reads first, then one table row per candidate.

const INPUT_CHARS = 100;

const NO_TRAJECTORY_WARNING = '**Warning: no trajectories were generated; status ok does not mean tool use was checked.** The experiment uses a trajectory rubric, but no case has an expected trajectory. Generate them through the Python API (include_expected_trajectory=True, see the README) or write them in by hand.';

const cell = (text) => String(text).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
const counts = (obj) => Object.entries(obj).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
const clip = (text) => (text.length > INPUT_CHARS ? `${text.slice(0, INPUT_CHARS)}...` : text);

function coverage(tools, candidates) {
  const used = (list) => new Set(list.flatMap((c) => c.proposedTools));
  const all = used(candidates);
  const kept = used(candidates.filter((c) => c.status !== 'reject'));
  const missing = (set) => tools.filter((t) => !set.has(t));
  const line = (label, list) => `- ${label}: ${list.length ? list.join(', ') : 'none'}`;
  return [
    line('Declared tools that never appear in any proposed trajectory', missing(all)),
    line('Declared tools that appear only in rejected candidates, or nowhere', missing(kept)),
  ];
}

function provenanceLines(source) {
  if (!source.hasGeneration) return ['- Provenance: not recorded (no --generation file was given), so the fields below are null.'];
  return [`- Provenance: recorded in ${source.generationFile}.`];
}

/**
 * @param {{candidates: object[], summary: object}} built output of buildCandidates
 * @param {{tools: string[], source: object, trajectoryWarning?: boolean}} meta trajectoryWarning: a trajectory rubric was used but no case has a trajectory
 */
function renderReview(built, { tools, source, trajectoryWarning = false }) {
  const { candidates, summary } = built;
  const show = (v) => (v == null ? 'null' : v);
  const lines = [
    '# Candidate review',
    '',
    `Imported from \`${source.experiment}\` by agenteval import-strands.`,
    '',
    '**Warning: every expected output, trajectory and rubric here was written by a model. They are proposals only. Read each candidate before it becomes a scenario.**',
    '',
    ...(trajectoryWarning ? [NO_TRAJECTORY_WARNING, ''] : []),
    `- Candidates: ${summary.total}`,
    `- By status: ${counts(summary.byStatus)}`,
    `- By reason code: ${counts(summary.byReason)}`,
    `- By trajectory quality: ${counts(summary.byQuality)}`,
    ...provenanceLines(source),
    `  - generator version: ${show(source.version)}`,
    `  - model: ${show(source.model)}`,
    `  - context sha256: ${show(source.contextSha256)}`,
    `  - task description: ${show(source.taskDescription)}`,
    `- Declared tools (${tools.length}): ${tools.join(', ')}`,
    ...coverage(tools, candidates),
    ...(candidates.length && candidates.every((c) => c.proposedTools.length === 0)
      ? ['- Note: no candidate proposes a tool call. The generator may not have written expected trajectories (see the README); status ok then does not mean the right tools were checked.']
      : []),
    '',
    '| id | status | reasons | trajectory | proposed tools | input | duplicateOf |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...candidates.map((c) => `| ${[c.id, c.status, c.reasons.map((r) => r.code).join(', '), c.trajectoryQuality, c.proposedTools.join(', '), clip(c.input), c.duplicateOf ?? ''].map(cell).join(' | ')} |`),
    '',
  ];
  return lines.join('\n');
}

module.exports = { renderReview, INPUT_CHARS };
