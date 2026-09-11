// SPDX-License-Identifier: Apache-2.0
'use strict';
/**
 * constants.js — single source of truth for this package's brand-prefix
 * tokens (Konductor rebrand implementation plan, Phase 1: derive-from-config
 * refactor). Wraps constants.json (data) with the one piece of matching
 * *logic* every consumer needs: deciding whether a given agent-spec filename
 * belongs to this package.
 *
 * Why a dedicated matcher instead of a single prefix string: the naming
 * scheme has three overlapping patterns -- a bare orchestrator identifier
 * (`orchestrator_agent`), a small fixed set of orchestrator variants
 * (`orchestrator_variants`, e.g. the mux/cmux orchestrators), and every other
 * agent sharing a common `agent_prefix`. Before the rename all three happened
 * to share the same `agent_prefix` value, so a naive
 * `f.startsWith(agent_prefix)` check worked by coincidence. That coincidence
 * is now GONE: `orchestrator_agent` is the bare name `konductor` and
 * `agent_prefix` is `k-`, and `"konductor".startsWith("k-")` is false, so the
 * naive check would miss the orchestrator outright (see the rebrand plan's
 * "three-pattern risk", Decision 1). The three-way check below is what makes
 * that a non-event. Centralizing it here means a further config-only value
 * change (this file's data, not this file's code) is the entire migration --
 * no call site needs to change.
 */

const CONSTANTS = require('./constants.json');

// Every field this package's constants.json is documented to carry (see
// README.md's "Fields" table). Iterating this fixed list -- rather than
// `Object.entries(constants)`, which only sees fields already present -- is
// what lets _validateNonEmpty() below actually catch a MISSING field. Without
// it, a dropped field would pass validation silently and surface later as a
// raw runtime `TypeError` (e.g. `CONSTANTS.orchestrator_variants.includes(...)`
// on `undefined` in isAgentSpecFilename() below).
const REQUIRED_FIELDS = [
  'package_name',
  'orchestrator_agent',
  'orchestrator_variants',
  'agent_prefix',
  'skill_prefix',
  'install_prefix',
  'bench_model_env',
  'max_inline_chars_env',
  'claude_agents_dir_env',
  'plugin_namespace',
];

// Fields whose value must be an array (of non-empty strings). Every other
// field must be a non-empty string. Keying validation on each field's
// EXPECTED shape (this set), rather than the value's RUNTIME shape
// (Array.isArray(value)), is what catches a scalar field supplied as an
// array -- e.g. `"agent_prefix": ["asdlc-"]` -- which a runtime-shape check
// would accept silently (a non-empty array of non-empty strings), then
// degrade downstream by coincidence: `stem.startsWith(CONSTANTS.agent_prefix)`
// coerces the array to a string via Array.prototype.toString(), which breaks
// for anything but a single-element array (AutoSDE finding f-7e240a06).
// Symmetrically, this also catches `orchestrator_variants` supplied as a
// bare string, which would otherwise silently degrade
// isAgentSpecFilename()'s `CONSTANTS.orchestrator_variants.includes(stem)`
// from an array-membership test into a String.prototype.includes()
// SUBSTRING test. This package's internal counterpart has the identical
// class of bug for the same reason; both are fixed the same way.
//
// `retired_agent_prefixes` is OPTIONAL (deliberately absent from
// REQUIRED_FIELDS above -- most packages have never retired a prefix), but
// when present must be array-shaped for the identical reason
// `orchestrator_variants` is: this package's internal counterpart's own
// rebrand-verification gate reads it as a list of former `agent_prefix`
// values (e.g. this package's own `"retired_agent_prefixes": ["asdlc"]`,
// retired by the Konductor rebrand), and a bare-string value there would
// degrade a list-membership/iteration into a character-by-character scan
// the same way it would here.
const ARRAY_FIELDS = new Set([
  'orchestrator_variants',
  'retired_agent_prefixes',
]);

// Of the two ARRAY_FIELDS, only `retired_agent_prefixes` may be an EMPTY
// array when present -- `orchestrator_variants` is a REQUIRED_FIELDS entry
// consumed directly by isAgentSpecFilename()'s membership test, so an empty
// array there is never a meaningful declaration of "this package has no
// orchestrator variants" (a package with none simply doesn't set variant
// spec files in the first place; requiring the array be non-empty when the
// field is required at all catches an author writing the field but
// forgetting its contents). `retired_agent_prefixes` is different: it is
// OPTIONAL (see the comment above) and read only by this package's internal
// counterpart's verify_rebrand.py, whose own declared_agent_prefixes()
// already treats an empty list identically to an omitted field -- an author
// explicitly writing `"retired_agent_prefixes": []` (e.g. as a placeholder,
// or to document "we checked, nothing is retired yet") is a natural, useful
// thing to write and gains nothing from being rejected: a present-but-empty
// list and an absent field mean the exact same thing to every consumer.
// Previously this field was validated by the SAME non-empty rule as
// orchestrator_variants, so `"retired_agent_prefixes": []` threw at this
// module's own `require()` time -- and because generate-agent-files.js
// requires this module at the top level, that crashed agent-file generation
// entirely, for a value with no consumer that treats empty specially (see
// agent_match.py's `_validate_optional_field`, which already accepts an
// empty list here). Rejecting it served no real purpose; this set carries
// the one field allowed to relax that rule, so a future field added to
// ARRAY_FIELDS defaults to the stricter, non-empty behavior unless it is
// deliberately added here too.
const ARRAY_FIELDS_ALLOWING_EMPTY = new Set(['retired_agent_prefixes']);

/**
 * Rejects a missing field, then rejects an explicitly empty value for any
 * field EXCEPT those in ARRAY_FIELDS_ALLOWING_EMPTY (see that constant's own
 * comment for why `retired_agent_prefixes` specifically is exempted). An
 * empty string or an empty array (for any other field) passes JSON parsing
 * and a plain `field in data` presence check with no error, then silently
 * widens every glob or path derived from it (e.g. an empty `agent_prefix`
 * turns a `${agentPrefix}*` glob into `*`, matching everything). Throws,
 * naming the offending field; callers must let this propagate (fail loud at
 * module load), never swallow it.
 */
function _validateNonEmpty(constants) {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in constants)) {
      throw new Error(`constants.json is missing required field '${field}'`);
    }
  }
  for (const [field, value] of Object.entries(constants)) {
    if (ARRAY_FIELDS.has(field)) {
      const allowEmpty = ARRAY_FIELDS_ALLOWING_EMPTY.has(field);
      if (
        !Array.isArray(value) ||
        (!allowEmpty && value.length === 0) ||
        value.some((v) => typeof v !== 'string' || v === '')
      ) {
        const shape = allowEmpty
          ? 'an array of non-empty strings'
          : 'a non-empty array of non-empty strings';
        throw new Error(`constants.json field '${field}' must be ${shape}`);
      }
    } else if (typeof value !== 'string' || value === '') {
      throw new Error(
        `constants.json field '${field}' must be a non-empty string`,
      );
    }
  }
}
_validateNonEmpty(CONSTANTS);

const AGENT_SPEC_SUFFIX = '.agent-spec.json';

/**
 * True if `filename` (e.g. a name matching `<agent_prefix>developer.agent-spec.json`)
 * names one of this package's agents: the bare orchestrator, one of its
 * orchestrator variants, or any agent matching the regular `agent_prefix`.
 * Type comes from this explicit check, never from a bare prefix glob alone.
 */
function isAgentSpecFilename(filename) {
  if (!filename.endsWith(AGENT_SPEC_SUFFIX)) return false;
  const stem = filename.slice(0, -AGENT_SPEC_SUFFIX.length);
  return (
    stem === CONSTANTS.orchestrator_agent ||
    CONSTANTS.orchestrator_variants.includes(stem) ||
    stem.startsWith(CONSTANTS.agent_prefix)
  );
}

module.exports = { CONSTANTS, isAgentSpecFilename, AGENT_SPEC_SUFFIX };
