// SPDX-License-Identifier: Apache-2.0
'use strict';

// The runtimes the cap commands accept, and what cap needs to know about each, read from the harness descriptors
// (`capabilities`, `armPrefix`, `costUnit`; runner/lib/harness/CONTRACT.md). No cap module compares to a runtime id.

const { DESCRIPTORS } = require('../runner/lib/harness/descriptors.js');
const { costUnitOf, DEFAULT_RUNTIME } = require('../runner/lib/harness/runtime.js');

/** Descriptors with `capabilities` (exactly those with `supports.capCommands`), in registry order. */
const CAP_RUNTIMES = Object.freeze(DESCRIPTORS.filter((d) => d.capabilities));
const CAP_RUNTIME_IDS = Object.freeze(CAP_RUNTIMES.map((d) => d.id));
/** The cap runtime whose reach comes from the acting agent's spec: a registry entry's `expect.<it>.actingAgents`. */
const ACTING_RUNTIME = CAP_RUNTIMES.find((d) => d.capabilities.actingAgents).id;
/** Per cap runtime: the tool a skill, SOP, agent or context unit is expected to be used through. */
const EXPECTED_TOOL = Object.freeze(Object.fromEntries(CAP_RUNTIMES.map((d) => [d.id, d.capabilities.tools])));
/** The runtime `cap skill-study`, selection and the nudge arm drive: the one descriptor with `supports.skillStudy`. */
const STUDY_RUNTIME = (() => {
  const study = DESCRIPTORS.filter((d) => d.supports.skillStudy);
  if (study.length !== 1) throw new Error(`exactly one runtime supports skillStudy, found ${study.length}`);
  return study[0].id;
})();
/** The cap runtime whose proxy reads `surface` (`'agent-filter'` or `'skill-index'`). */
const runtimeOfSurface = (surface) => CAP_RUNTIMES.find((d) => d.capabilities.surface === surface).id;
/** The cap descriptor of runtime `id`, or null when cap does not accept it. */
const capRuntime = (id) => CAP_RUNTIMES.find((d) => d.id === id) ?? null;
/** The run flag that caps a live run's spend on runtime `id`. */
const budgetFlagOf = (id) => (costUnitOf(id) === 'usd' ? 'budget-usd' : 'budget-credits');

/** "a or b", "a, b or c". */
const orList = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`);

/**
 * The `--harness` value `value` (default: the default runtime), checked. `both` also allows the word "both".
 * Throws naming the accepted values.
 */
function capHarness(value, { both = false } = {}) {
  const harness = value === undefined || value === true || value === '' ? (both ? 'both' : DEFAULT_RUNTIME) : String(value);
  const ok = [...CAP_RUNTIME_IDS, ...(both ? ['both'] : [])];
  if (!ok.includes(harness)) throw new Error(`--harness takes ${orList(ok)}`);
  return harness;
}

module.exports = { CAP_RUNTIMES, CAP_RUNTIME_IDS, ACTING_RUNTIME, STUDY_RUNTIME, EXPECTED_TOOL, capRuntime, runtimeOfSurface, budgetFlagOf, capHarness, orList };
