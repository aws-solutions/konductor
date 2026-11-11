// SPDX-License-Identifier: Apache-2.0
/**
 * Judge input: the one place that turns a stored answer into text a judge may see. The stored answer is
 * only read, never changed. Each answer is prepared on its own, for a judge prompt that holds only that answer
 * (each answer is scored alone). In this order:
 *
 *   1. sanitize   blinding: sanitize.js removes what says which arm wrote the answer.
 *   2. redact     the redactor (redact.js) replaces secret-shaped values, the run's canary and the exact credential
 *                 values in `literals`, so lookalike strings never reach a judge. `redacted` says the text changed.
 *   3. cap        text over `maxChars` is cut after redaction, so a cut cannot split a secret. `truncated` says so.
 *   4. leak scan  looks for narration that is still there. A hit makes the answer not eligible.
 *
 * Two more things make an answer not eligible. `removed_share` is the share of the answer's non-whitespace characters
 * the sanitizer deleted (sanitize.js counts every drop); above `maxRemovedShare` (0.25 by default) the answer is not
 * eligible with the reason "sanitizer removed N% of the answer", because a judge would score what is left of it, and
 * both arms are held to the same limit. The result carries `chars_in`, `removed_chars`, `removed_share` and
 * `removed_by_rule` for every answer, so a skewed loss between arms shows in the report.
 *
 * A hit FAILS the answer, it does not only flag it. `eligible: false` means the judge job must not send this text to a
 * judge: it leaves the judgment pending with `reason` and reports the answer as flagged. A hit fails rather than
 * flags because a judge that sees "I loaded the skill" in one answer learns the arm. Both arms are scanned the same
 * way: the without arm leaks too ("there is no such skill").
 *
 * An answer that ends inside a code fence that was never closed is not eligible either ("unclosed code fence"): the
 * sanitizer and the scan skip fenced code, so an open fence would hide the rest of the answer from both.
 *
 * The scan is a second look. It skips fenced code for narration (a code sample about a Skill tool is example content, as
 * for the sanitizer), and keeps the patterns narrow, because every false hit costs a judgment. For the word "skill"
 * it uses the sanitizer's own narration: the pattern (SKILL_NARRATION) and the clause-level rule for missing or unused
 * skills (skill-narration.js), run on the same sentences. The same sentence the sanitizer would drop is a leak if it is
 * still there, and a sentence that uses "skill" as an ordinary noun is not. A pattern for a leak it does not know
 * passes.
 *
 * ONE PROVENANCE HASH. The provenance of a judgment (provenance.judgmentInputs) takes `sanitizerVersion` and
 * `sanitizerRulesSha256` from here, and only from here: createJudgeInput(...).provenance and sanitizerProvenance(...)
 * are the same value, built by provenanceParts() below. It covers everything that can change the text a judge sees or
 * whether the answer is eligible: the sanitizer's spec (rules and their order, pipeline, normalization, settings, the
 * bundled-skill list and alias suffix, the input cap, the code-level patterns), the redactor patterns and ceiling, the
 * leak-scan patterns, the output cap and the removed-share limit. It does not cover `literals`, the exact secret
 * values of one run. Code that applies the patterns cannot be hashed; the behavior digest test pins its output.
 */
'use strict';

const { sha256 } = require('./provenance');
const {
  createRedactor,
  RULES: REDACT_RULES,
  INPUT_CEILING,
} = require('./redact');
const {
  createSanitizer,
  SANITIZER_VERSION,
  SKILL_NARRATION,
  escapeRegExp,
  agentAlternation,
  fenceMap,
} = require('./sanitize');
const { findSkillAbsenceNarration } = require('./skill-narration');
const { armSkillName } = require('./bundled-skills');

/** Characters of a judge-facing answer. Answers are a few thousand characters; this is room for a long one. */
const MAX_ANSWER_CHARS = 50000;
/**
 * The most the sanitizer may delete, as a share of the answer's non-whitespace characters, before the answer is not
 * eligible. Narration is a sentence or two in an answer of a few thousand characters, so it stays well under a tenth.
 * A quarter means the rules took out several sentences of real content too, or the answer was mostly narration.
 */
const MAX_REMOVED_SHARE = 0.25;
const SAMPLE_CHARS = 60;

// The leak patterns as data, so the provenance hash covers them. Tokens are filled per call from the settings and the
// skill. `prose` patterns skip fenced code; `all` patterns do not. An entry with a `matcher` also reports every sentence
// its function accepts (LEAK_MATCHERS); the function's own words and windows are hashed through the sanitizer's spec.
const PLUGIN_TOKEN = '__PLUGIN__';
const SCRATCH_TOKEN = '__SCRATCH__';
const AGENTS_TOKEN = '__AGENTS__';
const NAMES_TOKEN = '__NAMES__';
const LEAK_TABLE = Object.freeze([
  {
    id: 'plugin-name',
    where: 'all',
    flags: 'i',
    source: `\\b${PLUGIN_TOKEN}:[a-z0-9]`,
  },
  {
    id: 'skill-name',
    where: 'all',
    flags: 'i',
    source: `(?<![A-Za-z0-9-])(?:${NAMES_TOKEN})(?![A-Za-z0-9-])`,
  },
  {
    id: 'agent-id',
    where: 'all',
    flags: 'i',
    source: `(?<![A-Za-z0-9-])(?:${AGENTS_TOKEN})(?![A-Za-z0-9-])`,
  },
  {
    id: 'harness-path',
    where: 'all',
    flags: 'i',
    source: `/${SCRATCH_TOKEN}-(?:subject|arms|judge)-|scripts/bench(?![\\w-])|\\.claude-plugin\\b`,
  },
  {
    id: 'arm-label',
    where: 'all',
    flags: 'i',
    source:
      '\\bwith2\\b|\\b(?:with|without)[-_]skill\\b|\\bcondition[\\s-]+ii\\b',
  },
  {
    id: 'arm-label-caps',
    where: 'all',
    flags: '',
    source: '\\b(?:WITH|WITHOUT)[-_ ]ARM\\b',
  },
  // One leak id for all skill narration: the pattern shapes (SKILL_NARRATION) and the clause-level rule for missing or
  // unused skills, which is the sanitizer's own function run on each sentence of the prose.
  {
    id: 'skill-word',
    where: 'prose',
    flags: 'i',
    matcher: 'skill-absence',
    source: SKILL_NARRATION,
  },
  {
    id: 'guidance-narration',
    where: 'prose',
    flags: 'i',
    source:
      '\\b(?:i|we)\\s+(?:loaded|ignored|followed)\\s+(?:the\\s+)?(?:loaded\\s+|provided\\s+)?(?:guidance|instructions?|directives?)\\b(?!\\s+(?:of|in|from|on|at|by|published|issued)\\b)|\\b(?:loaded|preloaded)\\s+(?:guidance|directives?)\\b',
  },
  {
    id: 'skill-file',
    where: 'all',
    flags: '',
    source: '\\bSKILL\\.md\\b',
  },
  {
    id: 'tool-marker',
    where: 'prose',
    flags: 'i',
    source: '\\btool_(?:use|result)\\b|\\bSkill execution\\b',
  },
]);

/** The functions a LEAK_TABLE `matcher` names: text in, the sentences to report out. */
const LEAK_MATCHERS = Object.freeze({
  'skill-absence': findSkillAbsenceNarration,
});

/** The leak patterns for one skill and one set of sanitizer settings: [{ id, where, source, flags }]. */
function buildLeakRules(skill, settings) {
  // A one-word name (git, debug) is its own plain words after sanitizing, so it cannot be told from ordinary text.
  const skillNameAlternatives = skill
    ? [...new Set([skill, armSkillName(skill)])]
        .filter((name) => /[-_]/.test(name))
        // Hyphens and underscores are the same separator in a name.
        .map((name) => escapeRegExp(name).replace(/[-_]/g, '[-_]'))
        .join('|')
    : '';
  return LEAK_TABLE.map((entry) => ({
    ...entry,
    source: entry.source
      .split(PLUGIN_TOKEN)
      .join(escapeRegExp(settings.plugin))
      .split(SCRATCH_TOKEN)
      .join(escapeRegExp(settings.scratchPrefix))
      .split(AGENTS_TOKEN)
      .join(agentAlternation(settings))
      .split(NAMES_TOKEN)
      .join(skillNameAlternatives),
  })).filter((entry) => entry.id !== 'skill-name' || skillNameAlternatives);
}

/**
 * Remaining narration in already sanitized text: [{ id, count, sample }], empty when clean. Works on either arm's
 * answer. `sample` is the first match, cut to a few characters; the text is already redacted. `settings` are the
 * sanitizer settings the text was sanitized with (createSanitizer(...).settings).
 */
function scanLeaks(text, { skill = '', settings } = {}) {
  // No default: a caller that forgot the settings would scan for the default names while it sanitized for others.
  if (!settings || typeof settings !== 'object')
    throw new TypeError(
      'scanLeaks: options.settings is required (the sanitizer settings)',
    );
  const lines = String(text).split('\n');
  const { fenced } = fenceMap(lines);
  const proseLines = lines.filter((_line, i) => !fenced[i]);
  const views = { all: String(text), prose: proseLines.join('\n') };
  const hits = [];
  for (const { id, where, source, flags, matcher } of buildLeakRules(
    skill,
    settings,
  )) {
    const matches = views[where].match(new RegExp(source, `${flags}g`)) || [];
    if (matcher) {
      const findSentences = LEAK_MATCHERS[matcher];
      if (!findSentences)
        throw new Error(`unknown leak scan matcher ${matcher}`);
      // A loop, not push(...spread): the number of sentences is not bounded by the stack.
      for (const sentence of findSentences(views[where]))
        matches.push(sentence);
    }
    if (matches.length)
      hits.push({
        id,
        count: matches.length,
        sample: matches[0].slice(0, SAMPLE_CHARS),
      });
  }
  return hits;
}

const checkOptions = ({
  maxChars = MAX_ANSWER_CHARS,
  maxRemovedShare = MAX_REMOVED_SHARE,
}) => {
  if (!Number.isInteger(maxChars) || maxChars < 1)
    throw new TypeError('maxChars must be a whole number, 1 or more');
  if (
    typeof maxRemovedShare !== 'number' ||
    !(maxRemovedShare > 0 && maxRemovedShare <= 1)
  )
    throw new TypeError(
      'maxRemovedShare must be a number above 0 and at most 1',
    );
  return { maxChars, maxRemovedShare };
};

/**
 * Everything the provenance hash covers, as plain data. `literals` is not an option here: per-run secrets are never part
 * of it. Exported so a test can change each part and see the hash change.
 */
function provenanceParts(options = {}) {
  const { maxChars, maxRemovedShare } = checkOptions(options);
  return {
    sanitizer: createSanitizer(options.settings).spec,
    redactor: {
      rules: REDACT_RULES.map((rule) => [
        rule.name,
        rule.pattern.source,
        rule.pattern.flags,
        rule.replacement,
      ]),
      input_ceiling: INPUT_CEILING,
    },
    leak_scan: LEAK_TABLE.map((entry) => [
      entry.id,
      entry.where,
      entry.flags,
      entry.source,
      entry.matcher || '',
    ]),
    max_chars: maxChars,
    max_removed_share: maxRemovedShare,
  };
}

/**
 * The two values a judgment records (provenance.judgmentInputs), for the same options createJudgeInput takes. This is
 * the one place the sanitizer version and rules hash come from; createJudgeInput(options).provenance is this value.
 */
function sanitizerProvenance(options = {}) {
  return {
    sanitizerVersion: SANITIZER_VERSION,
    sanitizerRulesSha256: sha256(provenanceParts(options)),
  };
}

/**
 * A judge-input builder. `prepare(storedAnswer, { skill })` returns
 *   { text, eligible, reason, redacted, truncated, leaks, changes, counts, chars_in, removed_chars, removed_share,
 *     removed_by_rule, sanitizer_version, rules_sha256 }
 * `reason` is null when eligible, else why the answer must not reach a judge. `literals` are exact secret values (the
 * credentials given to the child). `settings` are the sanitizer settings (sanitize.js DEFAULT_SETTINGS). `maxRemovedShare`
 * is the most the sanitizer may delete (a share of non-whitespace characters, above 0 and at most 1).
 */
function createJudgeInput({
  literals = [],
  maxChars = MAX_ANSWER_CHARS,
  maxRemovedShare = MAX_REMOVED_SHARE,
  settings,
} = {}) {
  const provenance = sanitizerProvenance({
    maxChars,
    maxRemovedShare,
    settings,
  });
  const sanitizer = createSanitizer(settings);
  const redactor = createRedactor({ literals });
  const formatPercent = (share) => `${+(share * 100).toFixed(1)}%`;

  function prepare(stored, { skill } = {}) {
    // The skill is required, so a misspelled or missing option cannot skip the name rules. A control passes "".
    if (typeof skill !== 'string')
      throw new TypeError(
        'prepare: options.skill must be a string (the skill under test, or "" for a control)',
      );
    const sanitized = sanitizer.sanitize(stored, { skill });
    const redacted = redactor(sanitized.text, { maxChars: Infinity });
    const text =
      redacted.length > maxChars ? redactor(redacted, { maxChars }) : redacted;
    const leaks = scanLeaks(text, { skill, settings: sanitizer.settings });
    let reason = null;
    if (sanitized.too_long) reason = 'the answer is too long to sanitize';
    else if (!text.trim()) reason = 'sanitizing left no answer';
    // An open fence hides everything after it from the narration rules and the scan, so the answer is not trusted.
    else if (fenceMap(text.split('\n')).open) reason = 'unclosed code fence';
    else if (sanitized.removed_share > maxRemovedShare)
      reason = `sanitizer removed ${formatPercent(sanitized.removed_share)} of the answer`;
    else if (leaks.length)
      reason = `narration remains after sanitizing: ${leaks.map((leak) => leak.id).join(', ')}`;
    return {
      text,
      eligible: reason === null,
      reason,
      redacted: redacted !== sanitized.text,
      truncated: text !== redacted,
      leaks,
      changes: sanitized.changes,
      counts: sanitized.counts,
      chars_in: sanitized.chars_in,
      removed_chars: sanitized.removed_chars,
      removed_share: sanitized.removed_share,
      removed_by_rule: sanitized.removed_by_rule,
      sanitizer_version: provenance.sanitizerVersion,
      rules_sha256: provenance.sanitizerRulesSha256,
    };
  }
  return {
    prepare,
    provenance,
    settings: sanitizer.settings,
    maxChars,
    maxRemovedShare,
  };
}

module.exports = {
  MAX_ANSWER_CHARS,
  MAX_REMOVED_SHARE,
  LEAK_TABLE,
  scanLeaks,
  provenanceParts,
  sanitizerProvenance,
  createJudgeInput,
};
