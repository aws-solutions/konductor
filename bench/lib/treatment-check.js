// SPDX-License-Identifier: Apache-2.0
/**
 * Treatment check for a control skill: did the with-arm run take the direction the control gives
 * it?
 *
 * Why it exists. A control that is wrong on purpose should read `prune`. A capable subject often
 * sees that a direction is wrong and does the right thing anyway, sometimes saying so. A pair like
 * that measures the subject's judgment, not a harmful skill, so counting it would make the control
 * answer a different question than the one it claims to. A control pair therefore counts only when
 * the with-arm run shows it took the direction.
 *
 * Specs. A spec is a JSON file named `<skill>.json` in the spec directory (`SPEC_DIR`, by default
 * `bench/controls/treatment/`). It is keyed by the task's `target_section`, because a direction
 * belongs to a section of the skill and not to one task:
 *
 *   {
 *     "refused_any": [pattern, ...],             refusal wording that applies to every section
 *     "sections": {
 *       "<heading of the skill>": {
 *         "directive": "text",                   what the section tells the subject (for readers)
 *         "followed":  [pattern, ...],           text that shows the direction was taken
 *         "refused":   [pattern, ...]            text that shows it was set aside
 *       }
 *     }
 *   }
 *
 * Patterns are regular expression sources, matched case-insensitively. A pattern that does not
 * compile throws when the spec is loaded, so a typo cannot silently match nothing.
 *
 * Rules, applied in this order by `checkTreatment`:
 *  - A skill with no spec has no check: `required` is false and the pair counts. This is the case
 *    for every real skill, where taking the skill's guidance is what is measured, not a
 *    precondition for measuring it.
 *  - A section named in no spec is not checked either.
 *  - Empty text does not adhere.
 *  - A refusal marker wins over a followed marker, so an answer that shows the wrong form as a
 *    counter-example and then does the right thing has not taken the treatment. The error goes
 *    in one direction: a doubtful pair is dropped, so the control loses sample size and never
 *    gains a false signal.
 *  - No followed marker means no adherence.
 *
 * What is read. `treatmentText(pair)` joins the stored reply with the final text of every file the
 * run changed, because the judge sees both. It reads the stored reply as it is, never the
 * sanitized one. The sanitizer removes narration about the guidance (a blinding rule), and a
 * refusal it removed from the judge's view must still count here.
 *
 * Digest. `specSha256` hashes every spec file by name. decision-rule.js folds it into
 * `decisionRuleSha256()`, so editing a spec makes stored results stale and they re-aggregate from
 * stored judgments. No answer is run again and no judgment is made again.
 */
const fs = require('node:fs');
const path = require('node:path');

const { sha256 } = require('./provenance');
const { assertSlug } = require('./slug');

/** Where the specs live unless a caller passes another directory. */
const SPEC_DIR = path.join(__dirname, '..', 'controls', 'treatment');

/** The longest piece of a matched marker that is kept in a record. */
const MAX_MATCH_CHARS = 80;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Compiles pattern sources. Throws on a source that is not a string or does not compile. */
function compile(sources, where) {
  if (sources === undefined || sources === null) return [];
  if (!Array.isArray(sources) || !sources.every((s) => typeof s === 'string')) {
    throw new Error(`${where}: expected an array of pattern strings`);
  }
  return sources.map((source) => {
    try {
      return new RegExp(source, 'i');
    } catch (err) {
      throw new Error(`${where}: bad pattern ${JSON.stringify(source)}: ${err.message}`);
    }
  });
}

/**
 * The spec of `skill` in `dir`, or null when it has none. The skill name must be a slug, so it
 * cannot point outside `dir`. Sections sit on an object with no prototype, so a heading such as
 * `constructor` or `__proto__` is an ordinary key.
 */
function loadSpec(skill, dir = SPEC_DIR) {
  assertSlug(skill, 'skill name');
  const file = path.join(dir, `${skill}.json`);
  if (!fs.existsSync(file)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file}: not valid JSON: ${err.message}`);
  }
  if (!isObject(raw)) throw new Error(`${file}: expected an object`);
  const listed = raw.sections === undefined ? {} : raw.sections;
  if (!isObject(listed)) throw new Error(`${file}: sections must be an object`);
  const sections = Object.create(null);
  for (const [name, section] of Object.entries(listed)) {
    if (!isObject(section)) throw new Error(`${file} sections[${name}]: expected an object`);
    sections[name] = {
      directive: typeof section.directive === 'string' ? section.directive : '',
      followed: compile(section.followed, `${file} sections[${name}].followed`),
      refused: compile(section.refused, `${file} sections[${name}].refused`),
    };
  }
  if (Object.keys(sections).length === 0) throw new Error(`${file}: no sections`);
  return {
    skill,
    file,
    refusedAny: compile(raw.refused_any, `${file} refused_any`),
    sections,
  };
}

/** Digest of every spec file in `dir`, by file name, so an edit to any spec changes it. */
function specSha256(dir = SPEC_DIR) {
  const files = {};
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        files[entry.name] = sha256(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
      }
    }
  }
  return sha256({ files });
}

const firstMatch = (patterns, text) => {
  for (const re of patterns) {
    const found = text.match(re);
    if (found) return found[0].slice(0, MAX_MATCH_CHARS);
  }
  return null;
};

/**
 * Whether one with-arm run took its control's direction. `answerText` is the stored text to read
 * (see `treatmentText`). Returns
 *
 *   { required, adhered, followed, refused, reason, section }
 *
 * `required` false means the skill or the section has no check; then `adhered` is true and the
 * pair counts. `followed` and `refused` are the first marker found of each kind, or null.
 */
function checkTreatment({ skill, targetSection, answerText, dir = SPEC_DIR }) {
  const section = typeof targetSection === 'string' ? targetSection : null;
  const unchecked = (reason) => ({
    required: false,
    adhered: true,
    followed: null,
    refused: null,
    reason,
    section,
  });
  const spec = loadSpec(skill, dir);
  if (!spec) return unchecked('no treatment check');
  const rules = section !== null && Object.hasOwn(spec.sections, section) ? spec.sections[section] : null;
  if (!rules) return unchecked('section has no treatment check');

  const verdict = (adhered, followed, refused, reason) => ({
    required: true,
    adhered,
    followed,
    refused,
    reason,
    section,
  });
  const text = typeof answerText === 'string' ? answerText : '';
  if (text === '') return verdict(false, null, null, 'no answer text');
  const refused = firstMatch(spec.refusedAny, text) || firstMatch(rules.refused, text);
  const followed = firstMatch(rules.followed, text);
  if (refused) {
    return verdict(false, followed, refused, `answer did not take the directive (${refused})`);
  }
  if (!followed) return verdict(false, null, null, 'answer shows no sign of the directive');
  return verdict(true, followed, null, `answer took the directive (${followed})`);
}

/**
 * The text of one stored with-arm pair that the treatment check reads: the reply, then the final
 * text of every file whose content changed during the run.
 */
function treatmentText(pair) {
  const start = isObject(pair && pair.start) ? pair.start : {};
  const final = isObject(pair && pair.final) ? pair.final : {};
  const parts = [typeof (pair && pair.answer) === 'string' ? pair.answer : ''];
  for (const [file, text] of Object.entries(final)) {
    if (typeof text === 'string' && (!Object.hasOwn(start, file) || start[file] !== text)) parts.push(text);
  }
  return parts.join('\n');
}

/**
 * `checkTreatment` for a whole task set: `{ [taskId]: record }`. `textOf(taskId)` returns the
 * text of that task's with-arm run. The result is what `aggregateSkill` takes as `treatment`.
 */
function treatmentFor(skill, taskSet, textOf, dir = SPEC_DIR) {
  if (!taskSet || !Array.isArray(taskSet.tasks)) throw new Error('treatmentFor: taskSet.tasks must be an array');
  const out = {};
  for (const task of taskSet.tasks) {
    out[task.id] = checkTreatment({
      skill,
      targetSection: task.target_section,
      answerText: textOf(task.id),
      dir,
    });
  }
  return out;
}

module.exports = {
  SPEC_DIR,
  compile,
  loadSpec,
  specSha256,
  checkTreatment,
  treatmentText,
  treatmentFor,
};
