// SPDX-License-Identifier: Apache-2.0
// Ported from Michael Lin's scripts/bench/lib/judge-input.js (aws-solutions/konductor pull request #234, head 62e20c6f), same
// repository and Apache-2.0 licence. The redact step uses cap's own credential scrubber (runner/lib/scrub.js) in place of
// his redactor, so the secret masks and the cut marker below differ from his; nothing else changes.
/**
 * Judge input: the one place that turns a stored answer into text a judge may see. The stored answer is
 * only read, never changed. Each answer is prepared on its own, for a judge prompt that holds only that answer
 * (each answer is scored alone). In this order:
 *
 *   1. sanitize   blinding: sanitize.js removes what says which arm wrote the answer.
 *   2. redact     the scrubber (runner/lib/scrub.js) replaces secret-shaped values and the exact credential values in
 *                 `literals` with `<redacted>`, so lookalike strings never reach a judge. `redacted` says the text changed.
 *   3. cap        text over `maxChars` is cut after redaction, so a cut cannot split a secret. `truncated` says so.
 *                 The cut never lands inside a surrogate pair (one character outside the Basic Multilingual Plane, such
 *                 as an emoji, takes two UTF-16 units): it moves back one unit, so the kept text is never longer than
 *                 `maxChars` and never ends in half a character.
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
 * The scan is a second look. It reads a paragraph that is wrapped over several lines as one text, and the cells of a table
 * one by one, so narration cannot hide in either. It skips fenced code for narration (a code sample about a Skill tool is example content, as
 * for the sanitizer). It does not look for a skill name or an agent id inside what the sanitizer's name rewrites leave
 * alone (fenced code, URLs, paths, file names and commands), because there the name is the content and not a mention.
 * It keeps the patterns narrow, because every false hit costs a judgment. For narration it runs the sanitizer's own check
 * (findNarration: a sentence with a skill word and a cue word) with the request, so a sentence the sanitizer dropped is a
 * leak if it is still there, and a sentence the request guard kept is not. A pattern for a leak it does not know passes.
 *
 * ONE PROVENANCE HASH. The provenance of a judgment (provenance.judgmentInputs) takes `sanitizerVersion` and
 * `sanitizerRulesSha256` from here, and only from here: createJudgeInput(...).provenance and sanitizerProvenance(...)
 * are the same value, built by provenanceParts() below. It covers everything that can change the text a judge sees or
 * whether the answer is eligible: the sanitizer's spec (rules and their order, pipeline, normalization, settings, the
 * input cap, the code-level patterns), the redactor patterns and ceiling, the
 * leak-scan patterns, the output cap and the removed-share limit. It does not cover `literals`, the exact secret
 * values of one run. Code that applies the patterns cannot be hashed; the behavior digest test pins its output.
 */
'use strict';

const { argsSha256: sha256 } = require('../runner/lib/plant/canonical.js');
const { scrubString, SHAPES, MASK } = require('../runner/lib/scrub.js');
const {
  createSanitizer,
  SANITIZER_VERSION,
  findNarration,
  normalizeText,
  escapeRegExp,
  agentAlternation,
  fenceMap,
  maskProtected,
} = require('./sanitize.js');

/** Characters of a judge-facing answer. Answers are a few thousand characters; this is room for a long one. */
const MAX_ANSWER_CHARS = 50000;
/**
 * The most the sanitizer may delete, as a share of the answer's non-whitespace characters, before the answer is not
 * eligible. Narration is a sentence or two in an answer of a few thousand characters, so it stays well under a tenth.
 * A quarter means the rules took out several sentences of real content too, or the answer was mostly narration.
 */
const MAX_REMOVED_SHARE = 0.25;
const SAMPLE_CHARS = 60;
const isHighSurrogate = (unit) => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit) => unit >= 0xdc00 && unit <= 0xdfff;

/**
 * How many UTF-16 units of `text` to keep when it is cut to at most `limit`: `limit`, or one less when the cut would
 * fall between the two halves of a surrogate pair. A high surrogate with no low one after it (a lone unit already in
 * the text) is not half of a pair, so the cut stays where it is.
 */
function cutLength(text, limit) {
  return isHighSurrogate(text.charCodeAt(limit - 1)) &&
    isLowSurrogate(text.charCodeAt(limit))
    ? limit - 1
    : limit;
}

/** `text` cut to at most `limit` units (never inside a surrogate pair) with a marker that says how much was dropped. */
function capText(text, limit) {
  if (text.length <= limit) return text;
  const keep = cutLength(text, limit);
  return `${text.slice(0, keep)}[truncated ${text.length - keep} characters]`;
}

/** How the leak scan joins the lines of a paragraph (sanitize.js dropNarration): every line, so a wrap cannot hide narration. */
const LEAK_SCAN_WRAPPED = 'any';

// The leak patterns as data, so the provenance hash covers them. Tokens are filled per call from the settings and the
// skill. `prose` patterns skip fenced code; `names` patterns skip the spans the sanitizer's name rewrites leave alone
// (fenced code, URLs, paths, file names, commands: sanitize.js PROTECTED_PATTERNS); `all` patterns skip nothing. An entry with a `matcher` also reports every sentence
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
    where: 'names',
    flags: 'i',
    source: `(?<![A-Za-z0-9-])(?:${NAMES_TOKEN})(?![A-Za-z0-9-])`,
  },
  {
    id: 'agent-id',
    where: 'names',
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
  // One leak id for skill narration: the sanitizer's own check (sanitize.js findNarration) run on the prose, with the
  // request, so a sentence the request guard kept is not a leak.
  {
    id: 'skill-word',
    where: 'prose',
    flags: 'i',
    matcher: 'skill-narration',
    source: '',
  },
  {
    id: 'tool-marker',
    where: 'prose',
    flags: 'i',
    source: '\\btool_(?:use|result)\\b|\\bSkill execution\\b',
  },
]);

/** The functions a LEAK_TABLE `matcher` names: text and { skill, settings, request } in, the sentences to report out. */
const LEAK_MATCHERS = Object.freeze({ 'skill-narration': findNarration });

/** The leak patterns for one skill and one set of sanitizer settings: [{ id, where, source, flags }]. */
function buildLeakRules(skill, settings) {
  // A one-word name (git, debug) is its own plain words after sanitizing, so it cannot be told from ordinary text.
  const skillNameAlternatives = skill
    ? [skill]
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
function scanLeaks(text, { skill = '', settings, request = '' } = {}) {
  // No default: a caller that forgot the settings would scan for the default names while it sanitized for others.
  if (!settings || typeof settings !== 'object')
    throw new TypeError(
      'scanLeaks: options.settings is required (the sanitizer settings)',
    );
  const lines = String(text).split('\n');
  const { fenced } = fenceMap(lines);
  // A fenced line is blanked, not removed, so the lines around a fence do not read as one paragraph.
  const proseLines = lines.map((line, i) => (fenced[i] ? '' : line));
  const views = {
    all: String(text),
    prose: proseLines.join('\n'),
    names: maskProtected(String(text)),
  };
  // Text the task's request holds is the user's own: the sanitizer kept it, so it is not a leak.
  const requestText = normalizeText(request).text;
  const hits = [];
  for (const { id, where, source, flags, matcher } of buildLeakRules(
    skill,
    settings,
  )) {
    const matches = (
      source ? views[where].match(new RegExp(source, `${flags}g`)) || [] : []
    ).filter((match) => !requestText.includes(match));
    if (matcher) {
      const findSentences = LEAK_MATCHERS[matcher];
      if (!findSentences)
        throw new Error(`unknown leak scan matcher ${matcher}`);
      // A loop, not push(...spread): the number of sentences is not bounded by the stack.
      // `wrapped: 'any'`: every line of a paragraph is read as one text, so narration wrapped over two lines is found
      // whatever the next line starts with, and a table cell is read cell by cell.
      for (const sentence of findSentences(views[where], {
        skill,
        settings,
        request,
        wrapped: LEAK_SCAN_WRAPPED,
      }))
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
      shapes: SHAPES.map(([pattern, replacement]) => [pattern.source, pattern.flags, replacement]),
      mask: MASK,
    },
    leak_scan: LEAK_TABLE.map((entry) => [
      entry.id,
      entry.where,
      entry.flags,
      entry.source,
      entry.matcher || '',
    ]),
    leak_scan_wrapped: LEAK_SCAN_WRAPPED,
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
  const formatPercent = (share) => `${+(share * 100).toFixed(1)}%`;

  function prepare(stored, { skill, request = '' } = {}) {
    // The skill is required, so a misspelled or missing option cannot skip the name rules. A control passes "".
    if (typeof skill !== 'string')
      throw new TypeError(
        'prepare: options.skill must be a string (the skill under test, or "" for a control)',
      );
    const sanitized = sanitizer.sanitize(stored, { skill, request });
    const redacted = scrubString(sanitized.text, literals);
    const text = capText(redacted, maxChars);
    const leaks = scanLeaks(text, {
      skill,
      settings: sanitizer.settings,
      request,
    });
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
