// SPDX-License-Identifier: Apache-2.0
/**
 * The judge prompt. Every judge on the panel sees this text with the two answers filled in as A
 * and B, in both orders. The judge has no tools and must answer with one JSON object. The wording
 * lives in a plain template file per judge scale (judge-scale.js SCALES: `templateFile`,
 * `promptVersion`) under bench/judging/; this module loads and renders it. See
 * bench/judging/README.md for how to edit it.
 *
 * `judgePrompt(task, a, b, options)` returns `{ prompt, nonce }`. `a` and `b` are the two arms'
 * stored results, each `{ answer, start, final }`: the reply text and the workspace snapshots the
 * run started from and ended in. Callers pass raw stored values; this module does the cleaning.
 * A task that changes no files passes `{}` for both snapshots. `options`:
 *   context  required. The sanitizer context (see sanitize.js): the skill name and aliases.
 *   scale    a judge-scale.js id. Defaults to the default scale.
 *   template a loadTemplate result. Overrides `scale`; this is how a draft is previewed.
 *   limits   workspaceChanges limits, applied to both arms alike.
 *   nonce    the per-call marker id, 1-64 characters of A-Z a-z 0-9 _ -. Random by default.
 * The nonce is in the rendered prompt and is also returned on its own. A caller stores it with
 * the judgment and leaves it out of the digest that finds a stored reply, because a random value
 * in that digest would make every prompt new.
 *
 * Placeholders, each replaced in a single pass (substituted text is never scanned again):
 *   {{task}}      the task's request text
 *   {{rubric}}    the task's rubric as a numbered list ("1. ...\n2. ...")
 *   {{answer_a}}  the reply shown first, sanitized by sanitize.js, then cleaned (control
 *                 characters stripped, overlong text cut)
 *   {{answer_b}}  the reply shown second, same cleaning
 *   {{files_a}}   the "Changed files" section of the first answer (see below)
 *   {{files_b}}   the same for the second answer
 *   {{marker}}    the per-call id in the answer marker lines
 *
 * Changed files. For each arm, `workspaceChanges(start, final, limits)` lists the added, edited
 * and deleted files. The section has a header per file (path and change) and the final text in a
 * code fence one backtick longer than any run of backticks in the text, so the text cannot close
 * its own fence. A deleted file shows its path and "deleted". An arm with no changes says so. A
 * file cut at a limit says so, and a file past a limit shows its path and change only. Every path
 * and all content go through `sanitizeAnswer`, the same cleaner as the reply, because a path or a
 * file can name the skill as easily as a reply can. A path that the cleaner empties is shown as
 * "(unnamed file)". The cleaner works on the text after a limit has cut it, so a cut can leave a
 * fragment of a name. The two files sections sit inside their answer's marker lines.
 *
 * What a judge may see. Of a task, only `task.task` and `task.rubric` (JUDGE_VISIBLE_FIELDS).
 * `visibleTask` reads exactly those two fields and `assertAllowListed` refuses any other, so a
 * new field on a task record cannot reach a judge by being added to a file. Nothing else about a
 * task or a pair reaches the prompt: not the id, the skill, the kind, the target section, the
 * fixtures, the checks, the reference solution or the arm labels.
 *
 * The answers are untrusted: they are model output from the runs under test, so one could
 * contain instructions, a forged `<<<END_ANSWER_A id=...>>>` line, or a fake JSON verdict.
 * Defences:
 *  - each answer sits between the marker lines `<<<ANSWER_A id={{marker}}>>>` and
 *    `<<<END_ANSWER_A id={{marker}}>>>` (B likewise). The id is random per call, so the answer
 *    cannot close its own block and speak as the prompt. A template must keep that pattern;
 *  - the template says before and after the answers that their content is data only;
 *  - control characters are stripped and a runaway reply is cut at MAX_ANSWER_CHARS and
 *    MAX_ANSWER_BYTES.
 *
 * A judgment stores the template's version (the scale's `promptVersion`) and its sha (sha256 of
 * the template file). A judgment made with another version, sha or scale is stale.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { sanitizeAnswer } = require('./sanitize');
const { resolveScale } = require('./judge-scale');
const { workspaceChanges } = require('./workspace-changes');

const JUDGING_DIR = path.join(__dirname, '..', 'judging');

/** A reply is cut at this many characters ... */
const MAX_ANSWER_CHARS = 20000;
/** ... and at this many UTF-8 bytes, whichever comes first. */
const MAX_ANSWER_BYTES = 40000;

const PLACEHOLDERS = Object.freeze([
  'task',
  'rubric',
  'answer_a',
  'answer_b',
  'files_a',
  'files_b',
  'marker',
]);
const PLACEHOLDER_RE = /\{\{([A-Za-z0-9_]+)\}\}/g;
const NONCE_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The fields of a task a judge may see. Every other field of a task stays out. */
const JUDGE_VISIBLE_FIELDS = Object.freeze(['task', 'rubric']);

/**
 * Strips control characters (keeps \n and \t) and cuts an overlong reply at `max` characters and
 * `maxBytes` UTF-8 bytes, saying so inside the text.
 */
function cleanAnswer(text, max = MAX_ANSWER_CHARS, maxBytes = MAX_ANSWER_BYTES) {
  const full = String(text === null || text === undefined ? '' : text).replace(
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
    '',
  );
  let kept = full.length > max ? full.slice(0, max) : full;
  if (Buffer.byteLength(kept, 'utf8') > maxBytes) {
    kept = Buffer.from(kept, 'utf8').subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/, '');
  }
  if (kept.length === full.length) return full;
  const hidden = full.length - kept.length;
  return `${kept}\n[... answer cut here: ${hidden} more characters were not shown ...]`;
}

/**
 * Loads a template file. `text` is the file content without its one trailing newline (so an
 * editor that adds a final newline does not change the prompt); `sha256` is the hash of the file
 * bytes as stored. Throws when a placeholder is missing, unknown or malformed, so a typo cannot
 * reach a paid call.
 */
function loadTemplate(file) {
  const raw = fs.readFileSync(file);
  const text = raw.toString('utf8').replace(/\n$/, '');
  const names = [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);
  const unknown = [...new Set(names.filter((n) => !PLACEHOLDERS.includes(n)))];
  const show = (list) => list.map((n) => `{{${n}}}`).join(', ');
  if (unknown.length) {
    throw new Error(
      `${file}: unknown placeholder(s) ${show(unknown)}; allowed: ${show(PLACEHOLDERS)}`,
    );
  }
  const missing = PLACEHOLDERS.filter((n) => !names.includes(n));
  if (missing.length) throw new Error(`${file}: missing placeholder(s) ${show(missing)}`);
  if (text.replace(PLACEHOLDER_RE, '').includes('{{')) {
    throw new Error(
      `${file}: malformed placeholder (a stray "{{"); ` +
        'write them as {{name}} with letters, digits or _',
    );
  }
  return { path: file, text, sha256: crypto.createHash('sha256').update(raw).digest('hex') };
}

/** Single-pass substitution: substituted text is never scanned for placeholders again. */
function renderTemplate(templateText, vars) {
  return templateText.replace(PLACEHOLDER_RE, (_, name) => {
    if (!Object.hasOwn(vars, name)) throw new Error(`no value for placeholder {{${name}}}`);
    return vars[name];
  });
}

const templateCache = new Map();
/** The loaded template of a scale, read once per process. */
function templateForScale(scaleId) {
  const scale = resolveScale(scaleId);
  if (!templateCache.has(scale.id)) {
    templateCache.set(scale.id, loadTemplate(path.join(JUDGING_DIR, scale.templateFile)));
  }
  return templateCache.get(scale.id);
}

/**
 * Throws unless `fields` has exactly the allow-listed task fields: a missing one would leave a
 * hole, an extra one would be a leak.
 */
function assertAllowListed(fields) {
  const keys = Object.keys(fields);
  const extra = keys.filter((k) => !JUDGE_VISIBLE_FIELDS.includes(k));
  const missing = JUDGE_VISIBLE_FIELDS.filter((k) => !keys.includes(k));
  if (extra.length) {
    throw new Error(`judge input has fields outside the allow-list: ${extra.join(', ')}`);
  }
  if (missing.length) {
    throw new Error(`judge input is missing allow-listed fields: ${missing.join(', ')}`);
  }
  return fields;
}

/** `{ task, rubric }` of a task and nothing else (id, skill, checks, ... stay out). */
function visibleTask(task) {
  if (
    !task ||
    typeof task.task !== 'string' ||
    !Array.isArray(task.rubric) ||
    !task.rubric.every((item) => typeof item === 'string')
  ) {
    throw new Error('task needs a string "task" and an array of string "rubric" items');
  }
  return assertAllowListed({ task: task.task, rubric: [...task.rubric] });
}

/** A code fence long enough that `text` cannot close it. */
function fenceFor(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) || []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/** A path as the judge sees it: through the cleaner, and never empty. */
function displayPath(filePath, context) {
  return sanitizeAnswer(filePath, context).trim() || '(unnamed file)';
}

/** The "Changed files" section for one arm. `changes` is a workspaceChanges result. */
function changedFilesSection(changes, context) {
  if (changes.length === 0) return 'Changed files: none. This run changed no files.';
  const parts = ['Changed files:'];
  for (const change of changes) {
    const name = displayPath(change.path, context);
    if (change.change === 'deleted') {
      parts.push(`### ${name} (deleted)`);
    } else if (change.omitted) {
      parts.push(`### ${name} (${change.change}; content not shown, size limit reached)`);
    } else {
      const text = sanitizeAnswer(change.content, context);
      const fence = fenceFor(text);
      const note = change.truncated ? '; cut at the size limit' : '';
      const body = text === '' ? '' : `${text}\n`;
      let block = `### ${name} (${change.change}${note})\n${fence}\n${body}${fence}`;
      if (change.truncated) block += '\n[... file cut here: the rest was not shown ...]';
      parts.push(block);
    }
  }
  return parts.join('\n\n');
}

/** The reply and files section of one arm, or a throw that names the arm. */
function armValues(arm, label, context, limits) {
  if (!arm || typeof arm !== 'object') throw new TypeError(`answer ${label} must be an object`);
  const { answer } = arm;
  if (answer !== undefined && answer !== null && typeof answer !== 'string') {
    throw new TypeError(`answer ${label}: the reply must be a string`);
  }
  let changes;
  try {
    changes = workspaceChanges(arm.start, arm.final, limits);
  } catch (err) {
    err.message = `answer ${label}: ${err.message}`;
    throw err;
  }
  return {
    reply: cleanAnswer(sanitizeAnswer(answer ?? '', context)),
    files: changedFilesSection(changes, context),
  };
}

/**
 * Renders the prompt for one judge call and returns `{ prompt, nonce }`. See the module header
 * for the arguments.
 */
function judgePrompt(task, a, b, options = {}) {
  const { context, scale, template, limits } = options;
  const nonce = options.nonce === undefined ? crypto.randomBytes(8).toString('hex') : options.nonce;
  if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) {
    throw new Error('nonce must be 1-64 characters of A-Z a-z 0-9 _ -');
  }
  const seen = visibleTask(task);
  const first = armValues(a, 'A', context, limits);
  const second = armValues(b, 'B', context, limits);
  const chosen = template || templateForScale(scale);
  const prompt = renderTemplate(chosen.text, {
    task: seen.task,
    rubric: seen.rubric.map((item, i) => `${i + 1}. ${item}`).join('\n'),
    answer_a: first.reply,
    answer_b: second.reply,
    files_a: first.files,
    files_b: second.files,
    marker: nonce,
  });
  return { prompt, nonce };
}

module.exports = {
  judgePrompt,
  visibleTask,
  assertAllowListed,
  JUDGE_VISIBLE_FIELDS,
  loadTemplate,
  renderTemplate,
  templateForScale,
  changedFilesSection,
  cleanAnswer,
  PLACEHOLDERS,
  MAX_ANSWER_CHARS,
  MAX_ANSWER_BYTES,
  JUDGING_DIR,
};
