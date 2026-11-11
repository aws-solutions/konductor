// SPDX-License-Identifier: Apache-2.0
/**
 * Sanitizer. Turns a stored subject answer into text that does not say which arm wrote it. Pure: no file, network or
 * clock access, no state, and the same input always gives the same output.
 *
 * The rule: neutralize names, drop narration sentences, keep everything else. There are no ordered phases, only the
 * three lists below and a guard. All of them are in the spec hash. Blinding starts upstream (the `without` prompt
 * names no skill and both arms get the same answer-style line); text matching cannot hide a difference in style or
 * content that comes from the skill itself, so this is one layer, not a guarantee. Run the redactor and the leak scan
 * after it (judge-input.js).
 *
 * Every drop is counted: `removed_chars` (non-whitespace characters, by rule in `removed_by_rule`) and `removed_share`
 * of the answer, so the judge input can refuse an answer the drops emptied. A rewrite is not a removal.
 *
 * Known cost: a sentence that uses "skill" as an ordinary noun next to a cue word ("Follow the checklist to build a
 * skill that lasts.") is dropped, because it cannot be told from the arm's narration. Narration that names no skill
 * or guidance ("I answered directly.") passes. So does narration that names only "instructions" ("The provided
 * instructions were short."): the word is everyday prose ("Following instructions found in ticket content."), so it is
 * not a skill word. When a list or the code that applies it changes, bump SANITIZER_VERSION.
 */
'use strict';

const SANITIZER_VERSION = 8;
/** Input over this many characters is not scanned: the answer is dropped whole (`too_long`), never cut and passed on. */
const MAX_INPUT_CHARS = 1000000;

/**
 * The settings that change what the lists match: `plugin`, the namespace the arms install skills under ("bench:<skill>");
 * `scratchPrefix`, the start of the arms' scratch folder names; `agentPatterns`, regex sources for agent ids a judge must
 * not see (Konductor's own by default).
 */
const DEFAULT_SETTINGS = Object.freeze({
  plugin: 'bench',
  scratchPrefix: 'bench',
  agentPatterns: Object.freeze([
    'k-(?:architect|browser|developer|media-analyzer|product-manager|quality-assurance|researcher|tpm)',
    'konductor(?:-[a-z0-9]+)*',
  ]),
});

// Tokens in the lists, filled per call from the skill under test and the settings.
const [PLUGIN, SKILL, SPACED, SCRATCH, AGENTS] = [
  '__PLUGIN__',
  '__SKILL__',
  '__SPACED__',
  '__SCRATCH__',
  '__AGENTS__',
];
const WRAP = '[`\'"*_]{0,4}'; // marks that may wrap a name; at most 4, so the patterns stay linear
const NOT_IN_NAME = '(?<![A-Za-z0-9-])';
const PATH_START = '(?<![\\w.~/-])/?(?:[\\w.~-]+/)*';
const HR_NOUNS =
  'levels?|gaps?|matrix|assessment|inventory|development|training|requirements?|mix|shortage|frameworks?|taxonomy';

// prettier-ignore
/** NAME_WORDS: names a judge must not see, as [id, action, source]. A match becomes plain words: "approach" ("the code-review skill" -> "the approach"), "words" ("bench:code-review" -> "code review", in its own case). A one-word skill name is ordinary prose, so it matches only with a label or the plugin prefix. */
const NAME_WORDS = Object.freeze([
  ['skill-name-labelled', 'approach', `${NOT_IN_NAME}(the\\s+)?${WRAP}(?:${PLUGIN}:)?${SKILL}${WRAP}(?:\\s+(?:skill|plugin)\\b)+`],
  ['skill-name-spaced-labelled', 'approach', `${NOT_IN_NAME}(the\\s+)?${SPACED}(?:\\s+(?:skill|plugin)\\b)+`],
  ['plugin-qualified-name', 'words', `${WRAP}\\b${PLUGIN}:([a-z0-9][a-z0-9-]*)${WRAP}`],
  ['skill-name', 'words-multi', `${WRAP}${NOT_IN_NAME}(${SKILL})(?![A-Za-z0-9-])${WRAP}`],
  ['agent-identifier', 'agent', `${WRAP}${NOT_IN_NAME}(${AGENTS})(?![A-Za-z0-9-])${WRAP}`],
]);

// prettier-ignore
/** SKILL_WORDS: what narration is about. Not "skill level" or "skill-based", and not guidance that points at a source ("the guidance in the style guide"). */
const SKILL_WORDS = Object.freeze([
  `\\bskills?\\b(?!\\s+(?:${HR_NOUNS})\\b)(?!-based)`,
  '\\b(?:guidance|directives?)\\b(?!\\s+(?:of|in|from|on|at|by|for|published|issued)\\b)',
  `\\b${PLUGIN}:[a-z0-9]`,
  `${NOT_IN_NAME}${SKILL}(?![A-Za-z0-9-])`,
]);

// prettier-ignore
/** CUE_WORDS: what the harness does with a skill: load, call, find, match, follow, use, attribute ("per the skill"), miss. */
const CUE_WORDS = Object.freeze([
  '\\b(?:load\\w*|invok\\w*|activat\\w*|launch\\w*|execut\\w*|call(?:s|ed|ing)?|blocked|denied|fail(?:s|ed)?)\\b',
  '\\b(?:found|find(?:s|ing)?|locat(?:e|es|ed|ing)|match\\w*|appl(?:y|ies|ied|ying)|lookups?|checked|checking|returned)\\b',
  '\\b(?:(?:un)?available|installed|missing|relevant|without|follow(?:s|ed|ing)?|us(?:ed|ing)|per|provided|supplied|preloaded)\\b',
  "\\b(?:says|states|instructs|tells|requires|recommends|directs|asks)\\b|\\bbased\\s+on\\b|\\bno\\s+such\\b|\\bi\\s+have\\s+no\\b|\\bnot\\s+use\\b|\\bi\\s+don't\\s+think\\b|\\blet\\s+me\\b",
  'skill\\([^)\\n]{0,200}\\)',
]);

// prettier-ignore
/** PATH_PATTERNS: paths only the harness owns, as [id, source]: its scratch folders, its plugin folder, its scripts, and the skill under test's own folder. Never another skill's. */
const PATH_PATTERNS = Object.freeze([
  ['scratch-path', `(?:/private)?(?:/var/folders/[A-Za-z0-9_]+/[A-Za-z0-9_]+/T|/tmp|/var/tmp|\\$\\{?TMPDIR\\}?)/${SCRATCH}-(?:subject|arms|judge)-[A-Za-z0-9._-]*(?:/(?:with|without))?/?`],
  ['harness-repo-path', `${PATH_START}scripts/bench(?![\\w-])(?:/[\\w.@=+-]+)*/?`],
  ['plugin-dir-path', `${PATH_START}\\.claude-plugin(?:/[\\w.-]+)*/?`],
  ['skill-dir-path', `${PATH_START}skills/${SKILL}(?![\\w-])(?:/[\\w.-]+)*`],
]);

/** The guard: text that also appears in the task's request (both normalized) is never removed or rewritten. */
const REQUEST_GUARD =
  'a match, or the span from a skill word to a cue word, that the request holds is kept';

const NORMALIZE_SPEC = Object.freeze({
  controls: '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]', // all but \t, \n and \r
  invisible:
    '[\\u00AD\\u034F\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180B-\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\u3164\\uFEFF\\uFFA0]|[\\u{E0000}-\\u{E007F}]',
  lineBreaks: '\\r\\n|\\r|\\u2028|\\u2029',
  form: 'NFC',
});
// A sentence ends at . ! or ? and up to 3 closing marks after it (bold, backticks, quotes, brackets), so "**Title.** Next"
// splits in two and the bold title is not dropped with the sentence after it. The bound keeps the lookbehind linear.
const SENTENCE_SPLIT = /(?<=[.!?][*_`'")\]]{0,3})\s+/;
const TABLE_ROW = /^\s*\|/;
// A fence opens with 3 or more backticks or tildes and closes with the same character at least as long (CommonMark).
const FENCE_OPEN = /^\s*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;

const escapeRegExp = (text) =>
  String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const countNonSpace = (text) => text.replace(/\s+/g, '').length;
const agentAlternation = (settings) =>
  settings.agentPatterns.map((source) => `(?:${source})`).join('|');

/** Control, zero-width and line-break normalization, then NFC. Returns { text, removed } (removed counts deleted characters). */
function normalizeText(value) {
  let removed = 0;
  const drop = () => (removed++, '');
  const text = (value === null || value === undefined ? '' : String(value))
    .replace(new RegExp(NORMALIZE_SPEC.lineBreaks, 'g'), '\n')
    .replace(new RegExp(NORMALIZE_SPEC.controls, 'g'), drop)
    .replace(new RegExp(NORMALIZE_SPEC.invisible, 'gu'), drop);
  return { text: text.normalize(NORMALIZE_SPEC.form), removed };
}

/** Which lines are fenced code: { fenced, open }. `open` is true when the text ends inside a fence that never closed. */
function fenceMap(lines) {
  const fenced = [];
  let fence = null;
  for (const line of lines) {
    const close = fence && line.match(FENCE_CLOSE);
    const open = !fence && line.match(FENCE_OPEN);
    fenced.push(
      Boolean(
        fence || (open && !(open[1][0] === '`' && open[2].includes('`'))),
      ),
    );
    if (close && close[1][0] === fence[0] && close[1].length >= fence.length)
      fence = null;
    else if (open && fenced[fenced.length - 1]) fence = open[1];
  }
  return { fenced, open: fence !== null };
}

function checkSettings(settings) {
  const reject = (reason) => {
    throw new TypeError(`sanitizer settings: ${reason}`);
  };
  const { plugin, scratchPrefix, agentPatterns: patterns } = settings;
  if (typeof plugin !== 'string' || !/^[a-z0-9][a-z0-9-]*$/i.test(plugin))
    reject('plugin must be a plain name such as "bench"');
  if (
    typeof scratchPrefix !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(scratchPrefix)
  )
    reject('scratchPrefix must be a plain name such as "bench"');
  if (
    !Array.isArray(patterns) ||
    patterns.some((source) => typeof source !== 'string' || !source)
  )
    reject('agentPatterns must be an array of regular expression sources');
  if (!patterns.length) reject('agentPatterns must list at least one pattern');
  const unknown = Object.keys(settings).filter(
    (key) => !Object.hasOwn(DEFAULT_SETTINGS, key),
  );
  if (unknown.length) reject(`unknown setting(s): ${unknown.join(', ')}`);
  for (const source of patterns) {
    // Each entry sits in its own group, so a backreference or a named group would point into another entry.
    if (/\\[1-9]|\\k<|\(\?<(?![=!])/.test(source))
      reject(
        `agentPatterns: ${JSON.stringify(source)} may not use backreferences or named groups`,
      );
    let entry;
    try {
      entry = new RegExp(`^(?:${source})$`);
    } catch (error) {
      reject(`agentPatterns: ${error.message}`);
    }
    // A pattern that matches nothing would match between every two words.
    if (entry.test(''))
      reject(
        `agentPatterns: ${JSON.stringify(source)} matches the empty string`,
      );
  }
}

/** The lists with this call's skill and settings filled in, as RegExp objects. */
function compileLists(skill, settings) {
  const tokens = {
    PLUGIN: escapeRegExp(settings.plugin),
    SCRATCH: escapeRegExp(settings.scratchPrefix),
    AGENTS: agentAlternation(settings),
    SPACED: skill
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map(escapeRegExp)
      .join('[\\s_-]+'),
    SKILL: escapeRegExp(skill).replace(/[-_]/g, '[-_]'), // underscores for hyphens name the same skill
  };
  const fill = (source) =>
    source.replace(/__([A-Z]+)__/g, (_, key) => tokens[key]);
  const usable = (source, multiWord = false) =>
    !/__SKILL__|__SPACED__/.test(source) ||
    Boolean(skill && (!multiWord || /[-_]/.test(skill)));
  const compile = (source, flags = 'gi') => new RegExp(fill(source), flags);
  return {
    names: NAME_WORDS.filter(([, action, source]) =>
      usable(source, action === 'words-multi'),
    ).map(([id, action, source]) => ({ id, action, regex: compile(source) })),
    // A removed path takes the space before it, so "Read x then" does not become "Read  then".
    paths: PATH_PATTERNS.filter(([, source]) => usable(source)).map(
      ([id, source]) => ({
        id,
        regex: compile(id === 'scratch-path' ? source : `[ \\t]?(?:${source})`),
      }),
    ),
    skillWords: SKILL_WORDS.filter((source) => usable(source, true)).map(
      (source) => compile(source),
    ),
    cueWords: CUE_WORDS.map((source) => compile(source)),
  };
}

/**
 * Is the sentence narration? It is when it holds a SKILL_WORDS match and a CUE_WORDS match and the text from one to the other is
 * not in the request. Matches are read in order of position, each against the nearest earlier match of the other list, so the
 * cost is linear in the sentence.
 */
function isNarration(sentence, lists, request) {
  const hits = [];
  for (const [list, regexes] of [
    [0, lists.skillWords],
    [1, lists.cueWords],
  ])
    for (const regex of regexes)
      for (const match of sentence.matchAll(regex))
        hits.push([match.index, match.index + match[0].length, list]);
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const last = [null, null];
  for (const hit of hits) {
    const other = last[1 - hit[2]];
    if (
      other &&
      !request.includes(
        sentence.slice(Math.min(other[0], hit[0]), Math.max(other[1], hit[1])),
      )
    )
      return true;
    last[hit[2]] = hit;
  }
  return false;
}

/** { text, dropped }: `text` without its narration sentences, outside fenced code and table rows; `dropped` lists them. */
function dropNarration(text, lists, request) {
  const lines = text.split('\n');
  const { fenced } = fenceMap(lines);
  const kept = [];
  const dropped = [];
  lines.forEach((line, i) => {
    if (fenced[i] || TABLE_ROW.test(line)) return kept.push(line);
    const indent = line.match(/^\s*/)[0];
    const sentences = line.slice(indent.length).split(SENTENCE_SPLIT);
    const survivors = sentences.filter(
      (sentence) =>
        !isNarration(sentence, lists, request) || !dropped.push(sentence),
    );
    if (survivors.length === sentences.length) kept.push(line);
    else if (survivors.length) kept.push(indent + survivors.join(' '));
  });
  return { text: kept.join('\n'), dropped };
}

/** The narration sentences of `text`, as the sanitizer would drop them (the leak scan's second look). */
function findNarration(
  text,
  { skill = '', settings = DEFAULT_SETTINGS, request = '' } = {},
) {
  return dropNarration(
    String(text),
    compileLists(skill, settings),
    normalizeText(request).text,
  ).dropped;
}

/**
 * A sanitizer for one set of settings. `sanitize(text, { skill, request })` returns
 *   { text, changes, counts, too_long, chars_in, removed_chars, removed_share, removed_by_rule, sanitizer_version }
 * `skill` is the skill under test (a slug such as "e2e-test-strategy"); `request` is the task's request, for the guard.
 * `chars_in` is the non-whitespace length of the normalized input, `removed_chars` the non-whitespace text the drops deleted
 * (by rule in `removed_by_rule`), `removed_share` their ratio. `too_long` is true when the input was over MAX_INPUT_CHARS:
 * the text is then '' and nothing was scanned. `spec` is everything that can change the text for the same input, as data.
 */
function createSanitizer(overrides = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...overrides };
  checkSettings(settings);
  const spec = {
    sanitizer_version: SANITIZER_VERSION,
    normalize: NORMALIZE_SPEC,
    max_input_chars: MAX_INPUT_CHARS,
    wrap: WRAP,
    code_patterns: [
      SENTENCE_SPLIT.source,
      TABLE_ROW.source,
      FENCE_OPEN.source,
      FENCE_CLOSE.source,
    ],
    name_words: NAME_WORDS,
    skill_words: SKILL_WORDS,
    cue_words: CUE_WORDS,
    path_patterns: PATH_PATTERNS,
    request_guard: REQUEST_GUARD,
    settings,
  };

  function sanitize(value, { skill = '', request = '' } = {}) {
    if (typeof skill !== 'string' || typeof request !== 'string')
      throw new TypeError(
        'sanitize: skill and request must be strings (use "" for none)',
      );
    if (value !== null && value !== undefined && typeof value !== 'string')
      throw new TypeError('sanitize: the stored answer must be a string');
    const counts = {};
    const byRule = {};
    const count = (id, removedText = '') => {
      counts[id] = (counts[id] || 0) + 1;
      const chars = countNonSpace(removedText);
      if (chars) byRule[id] = (byRule[id] || 0) + chars;
    };
    const empty = {
      changes: 0,
      counts,
      too_long: false,
      chars_in: 0,
      removed_chars: 0,
      removed_share: 0,
      removed_by_rule: byRule,
      sanitizer_version: SANITIZER_VERSION,
    };
    if (value && value.length > MAX_INPUT_CHARS)
      return { ...empty, text: '', too_long: true };
    const normalization = normalizeText(value);
    if (normalization.removed) counts.normalize_chars = normalization.removed;
    const requestText = normalizeText(request).text;
    const lists = compileLists(skill, settings);
    // Narration first: it keys on names and paths that the next two steps turn into plain words or remove.
    const narration = dropNarration(normalization.text, lists, requestText);
    narration.dropped.forEach((sentence) => count('skill-narration', sentence));
    let text = narration.text;
    // Paths and names, everywhere: a leaked name is a leak in fenced code too. Text the request holds is kept.
    const keep = (match) =>
      Boolean(requestText) && requestText.includes(match.trim());
    for (const { id, regex } of lists.paths)
      text = text.replace(regex, (match) =>
        keep(match) ? match : (count(id, match), ''),
      );
    for (const { id, action, regex } of lists.names)
      text = text.replace(regex, (...args) => {
        if (keep(args[0])) return args[0];
        count(id);
        const group = args.slice(1, -2)[0];
        if (action === 'approach')
          return group ? `${group}approach` : 'this approach';
        if (action === 'agent')
          return /^konductor/i.test(group)
            ? 'orchestrator'
            : group.replace(/^k-/i, '').replace(/[-_]+/g, ' ').toLowerCase();
        return group.replace(/[-_]+/g, ' ').trim();
      });
    const charsIn = countNonSpace(normalization.text);
    const removed = Math.min(
      Object.values(byRule).reduce((sum, n) => sum + n, 0),
      charsIn,
    );
    const changes = Object.entries(counts).reduce(
      (sum, [id, n]) => (id === 'normalize_chars' ? sum : sum + n),
      0,
    );
    return {
      ...empty,
      text,
      changes,
      chars_in: charsIn,
      removed_chars: removed,
      removed_share: charsIn ? removed / charsIn : 0,
    };
  }
  return { settings, version: SANITIZER_VERSION, spec, sanitize };
}

module.exports = {
  SANITIZER_VERSION,
  MAX_INPUT_CHARS,
  DEFAULT_SETTINGS,
  NAME_WORDS,
  SKILL_WORDS,
  CUE_WORDS,
  PATH_PATTERNS,
  WRAP,
  createSanitizer,
  sanitizeAnswer: createSanitizer().sanitize,
  findNarration,
  normalizeText,
  escapeRegExp,
  agentAlternation,
  fenceMap,
};
