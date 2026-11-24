// SPDX-License-Identifier: Apache-2.0
// Ported from Michael Lin's scripts/bench/lib/sanitize.js (aws-solutions/konductor pull request #234, head 62e20c6f), same
// repository and Apache-2.0 licence, with no change to the lists or the code.
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
 * Name rewrites touch prose only. A URL, a path, a file name, a package or git command and fenced or inline code are
 * content the answer is about, so the skill-name and agent-id rewrites leave them as they are (PROTECTED_PATTERNS); the
 * leak scan (judge-input.js) skips the same spans. The `bench:` form is the harness's own syntax and is rewritten anywhere.
 *
 * Every drop is counted: `removed_chars` (non-whitespace characters, by rule in `removed_by_rule`) and `removed_share`
 * of the answer, so the judge input can refuse an answer the drops emptied. A rewrite is not a removal.
 *
 * What counts as narration: a sentence with a skill word and a cue word. The skill's own name and the plugin form
 * ("bench:x") are named words: any cue next to one is narration. "skill" and "guidance" are generic words, everyday
 * prose too ("Per AWS guidance, never create access keys for the root user."), so a generic word is narration only
 * next to a strong cue (what the harness does with a skill: load, find, call, be available), or next to any cue when
 * the sentence has a narrator: "I", "my", "the agent" ("I am using the skill's guidance"). A weak cue is a
 * word that is also ordinary prose: per, using, without, following, provided, requires. A task whose request itself
 * says "skill" or "guidance" is about the word, so for that word a strong cue is not enough and a narrator is needed.
 * A few phrases are narration with no narrator and no cue pair. HARNESS_PHRASES are what only the harness can say
 * ("Skills used: none.", "The skill was loaded.", "No skill matched this task.", "The Skill tool was not available."),
 * so they count in every task. USE_PHRASES are the answer speaking of the skill it used ("Using the skill, here is the
 * review.", "The skill provided a checklist."); they count unless the request itself says "skill".
 *
 * The check reads table cells one by one (a narrating cell is emptied, the row stays a row) and a paragraph that is
 * hard-wrapped across lines as one text (a line that ends without a stop and the next one starting in lower case are
 * one sentence).
 *
 * Known cost: a sentence that uses "skill" as an ordinary noun next to a strong cue ("Tests named after the skill they
 * exercise are easy to find.") is dropped, because it cannot be told from the arm's narration. In an answer about
 * skills, a past-tense sentence of HARNESS_PHRASES ("If the skill was not found, Claude falls back.") is dropped too. Narration that names
 * no skill or guidance ("I answered directly.") passes, and so does "The skill's cap is five options.": with no cue and
 * no phrase of the lists it cannot be told from "The skill of the team is clear." So does narration that names only "instructions" ("The
 * provided instructions were short."): the word is everyday prose ("Following instructions found in ticket content."),
 * so it is not a skill word. When a list or the code that applies it changes, bump SANITIZER_VERSION.
 */
'use strict';

const SANITIZER_VERSION = 10;
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

/**
 * SUBSTITUTIONS: what a rewrite writes and the flags the lists compile with, as data so the spec hash covers them.
 * Each regular expression is [source, flags]. `approach_after_article` follows a captured "the ", `approach_alone` stands
 * when there was none; `orchestrator` replaces Konductor's own name; an agent id loses `agent_prefix`; hyphens and
 * underscores in a captured name become `word_joiner`. A removed path takes the `path_leading_space` before it, except
 * the ids in `path_without_leading_space`.
 */
const SUBSTITUTIONS = Object.freeze({
  list_flags: 'gi',
  approach_after_article: 'approach',
  approach_alone: 'this approach',
  orchestrator: 'orchestrator',
  orchestrator_match: Object.freeze(['^konductor', 'i']),
  agent_prefix: Object.freeze(['^k-', 'i']),
  word_separator: Object.freeze(['[-_]+', 'g']),
  word_joiner: ' ',
  skill_separator: '[-_]',
  spaced_separator: '[\\s_-]+',
  path_leading_space: '[ \\t]?',
  path_without_leading_space: Object.freeze(['scratch-path']),
});
const ruleRegExp = ([source, flags]) => new RegExp(source, flags);

/** The name rule ids that leave PROTECTED_PATTERNS alone: `bench:<name>` is harness syntax, never answer content. */
const UNPROTECTED_NAME_RULES = Object.freeze(['plugin-qualified-name']);

// prettier-ignore
/**
 * PROTECTED_PATTERNS: tokens the answer is about, as [id, source, flags], matched on one line of unfenced text. A name
 * rewrite that overlaps one is skipped, and so is the leak scan's look for a skill name or agent id. Fenced code is
 * protected as a whole. Inline code is protected only when it holds a command: a lone name in backticks is a mention.
 */
const PROTECTED_PATTERNS = Object.freeze([
  ['url-scheme', '(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*://[^\\s<>"\'`)\\]]+', 'gi'],
  ['url-host-path', '(?<![\\w@.-])(?:[a-z0-9-]+\\.)+[a-z]{2,}(?::\\d+)?/[^\\s<>"\'`)\\]]*', 'gi'],
  ['path-token', '(?<![^\\s`\'"()<>\\[\\]{},;|])(?=[^\\s`\'"()<>\\[\\]{},;|]*[\\w.~@-]/[\\w.~@-])[^\\s`\'"()<>\\[\\]{},;|]+', 'g'],
  ['file-name', '(?<![\\w.-])[\\w-]+(?:\\.[\\w-]+)*\\.[A-Za-z][A-Za-z0-9]{0,9}(?![\\w-])', 'g'],
  ['install-command', '\\b(?:npm|pnpm|yarn|pip3?|pipx|brew|cargo|gem|apt(?:-get)?)\\s+(?:install|i|add|uninstall|remove|update|upgrade)\\s+(?:--?[\\w=.-]+\\s+)*[^\\s`\'"]+', 'gi'],
  ['npx-command', '\\bnpx\\s+(?:--?[\\w=.-]+\\s+)*[^\\s`\'"]+', 'gi'],
  ['git-command', '\\bgit\\s+(?:checkout|switch|branch|merge|rebase|cherry-pick|diff|log|show|tag|push|pull|fetch|clone|add|commit)\\s+(?:-{1,2}[\\w=.-]+\\s+)*[^\\s`\'"]+', 'gi'],
  ['shell-prompt-line', '^\\s*(?:>\\s*)?\\$\\s.*$', 'g'],
  ['inline-command', '`\\s*(?:\\$\\s*)?(?:git|npm|npx|pnpm|yarn|pip3?|pipx|brew|cargo|go|node|python3?|bash|sh|zsh|cd|cat|ls|mkdir|rm|cp|mv|docker|curl|wget|make|brazil-build|brazil|aim|mwinit|kiro-cli|cr|sudo|export|echo|grep|sed|awk|find|tar)\\s[^`\\n]*`', 'g'],
]);

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
/** SKILL_WORDS: the generic words narration is about. Not "skill level" or "skill-based", and not guidance that points at a source ("the guidance in the style guide"). Ordinary prose too, so they need a strong cue or a narrator (see the header). */
const SKILL_WORDS = Object.freeze([
  `\\bskills?\\b(?!\\s+(?:${HR_NOUNS})\\b)(?!-based)`,
  '\\b(?:guidance|directives?)\\b(?!\\s+(?:of|in|from|on|at|by|for|published|issued)\\b)',
]);

// prettier-ignore
/** NAMED_WORDS: the plugin form and the skill's own name. The harness's own vocabulary, so any cue next to one is narration. */
const NAMED_WORDS = Object.freeze([
  `\\b${PLUGIN}:[a-z0-9]`,
  `${NOT_IN_NAME}${SKILL}(?![A-Za-z0-9-])`,
]);

// prettier-ignore
/** CUE_WORDS: the strong cues, what the harness does with a skill: load, call, find, match, be available, be missing, be attributed ("per the skill", "the skill says"). */
const CUE_WORDS = Object.freeze([
  '\\b(?:load\\w*|invok\\w*|activat\\w*|launch\\w*|execut\\w*|call(?:s|ed|ing)?|blocked|denied|fail(?:s|ed)?)\\b',
  '\\b(?:found|find(?:s|ing)?|locat(?:e|es|ed|ing)|match\\w*|appl(?:y|ies|ied|ying)|lookups?|checked|checking|returned)\\b',
  '\\b(?:(?:un)?available|installed|missing|relevant|preloaded)\\b',
  "\\bno\\s+such\\b|\\bi\\s+have\\s+no\\b|\\bnot\\s+use\\b|\\bi\\s+don't\\s+think\\b|\\blet\\s+me\\b",
  'skill\\([^)\\n]{0,200}\\)',
  '\\b(?:no|not|none|never|zero|neither)\\b(?:\\s+\\w+){0,3}\\s+us(?:ed|ing)\\b',
  "\\b(?:the|this|that|its|my)\\s+(?:(?:loaded|provided)\\s+)?(?:skills?|guidance)(?:['\u2019]s)?\\s+(?:says|states|instructs|tells|requires|recommends|directs|asks)\\b|\\b(?:per|based\\s+on)\\s+(?:(?:the|this|that|its|my)\\s+(?:(?:loaded|provided)\\s+)?skills?|SKILL\\.md)\\b",
]);

// prettier-ignore
/** WEAK_CUE_WORDS: words that are cues in narration and ordinary prose too ("Using this guidance, set the policy."). They count only next to a named word or in a sentence with a narrator. */
const WEAK_CUE_WORDS = Object.freeze([
  '\\b(?:per|provided|supplied|without|follow(?:s|ed|ing)?|us(?:ed|ing)|says|states|instructs|tells|requires|recommends|directs|asks)\\b|\\bbased\\s+on\\b',
]);

// prettier-ignore
/** NARRATOR_WORDS: who speaks in narration, as [source, flags]: the answering agent ("I", "my", "the agent"). */
const NARRATOR_WORDS = Object.freeze([
  Object.freeze(["\\bI(?:['\u2019](?:m|ve|ll|d))?\\b(?!\\.\\w)", 'g']),
  Object.freeze(['\\bmy\\b|\\bthe\\s+(?:agent|assistant|model|harness|orchestrator|subagent)\\b', 'gi']),
]);

// prettier-ignore
/** HARNESS_PHRASES: narration with no narrator and no cue pair, in every task, also one about skills: what only the harness can say about a skill, in the past tense or as a label ("The skill was loaded." is narration, "The skill is loaded when a request matches." is not). */
const HARNESS_PHRASES = Object.freeze([
  '\\bskills?\\s+(?:used|loaded|invoked)\\s*[:=]',
  '\\bskills?\\s+(?:was|were|has\\s+been|have\\s+been|had\\s+been)\\s+(?:not\\s+|never\\s+)?(?:loaded|invoked|activated|called|available|unavailable|found|applied|used|missing|installed|preloaded)\\b',
  "\\bskills?\\s+(?:\\w+\\s+)?(?:did\\s+not|didn['\u2019]t)\\s+(?:apply|match|load|fire|trigger)\\b",
  "\\bskill\\s+tool\\s+(?:(?:was|were|is|are)\\s+not|was|were|(?:isn|aren|wasn|weren)['\u2019]t)\\b",
  '\\bno\\s+(?:\\w+\\s+){0,2}skills?\\s+(?:matched|applied|found|existed|was|were)\\b',
]);

// prettier-ignore
/** USE_PHRASES: the answer speaking of "the skill" as something it used or was given. Narration unless the request itself says "skill" (then the answer may be about skills). Not "the skill level" or "the skill-based". */
const USE_PHRASES = Object.freeze([
  `\\b(?:using|used|follow(?:s|ed|ing)?|without|per|applying|applied)\\s+(?:the|this|that|its|my)\\s+(?:(?:loaded|provided)\\s+)?skills?(?!\\s+(?:${HR_NOUNS})\\b)(?!-based)`,
  `\\b(?:the|this|that|its|my)\\s+skill(?:['\u2019]s)?\\s+(?:\\w+\\s+)?(?:provided|supplied|gave|offered|suggested|recommended|said|says|states|instructs|tells|requires)\\b(?!\\s+(?:${HR_NOUNS})\\b)`,
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
// Table cells are split at a pipe that is not escaped.
const CELL_SPLIT = /(?<!\\)\|/;
// Lines that start a block of their own, so they never continue the line above: a list item, a heading, a quote, a table
// row or a rule.
const BLOCK_START =
  /^\s*(?:[-*+]\s|\d{1,9}[.)]\s|#{1,6}(?:\s|$)|>|\||(?:[-*_]\s*){3,}$)/;
const HEADING = /^\s*#{1,6}(?:\s|$)/;
// A hard-wrapped sentence: the line above ends without a stop, and this one goes on in lower case, a digit or a mark.
const WRAPPED_END = /[.!?:;][*_`'")\]]{0,3}\s*$/;
const WRAPPED_NEXT = /^\s*[\p{Ll}\d,;:)\]]/u;
// A fence opens with 3 or more backticks or tildes, indented at most 3 spaces, and closes with the same character at least
// as long (CommonMark). Four spaces make indented code, which is not tracked. A fence may sit in a blockquote: each `>`
// prefix (up to 3 spaces before it, one space after) is stripped first, and the fence ends where the quote does.
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const QUOTE_PREFIX = /^ {0,3}> ?/;

const PROTECTED_REGEXES = PROTECTED_PATTERNS.map(
  ([, source, flags]) => new RegExp(source, flags),
);

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

/** A line without up to `limit` blockquote prefixes: { depth, rest }, `depth` being how many were stripped. */
function splitQuote(line, limit = Infinity) {
  let rest = line;
  let depth = 0;
  while (depth < limit) {
    const prefix = rest.match(QUOTE_PREFIX);
    if (!prefix) break;
    rest = rest.slice(prefix[0].length);
    depth += 1;
  }
  return { depth, rest };
}

/**
 * Which lines are fenced code: { fenced, open }. `open` is true when the text ends inside a fence that never closed. A
 * fence in a blockquote ends with the quote (a line with fewer prefixes), which closes it.
 */
function fenceMap(lines) {
  const fenced = [];
  let fence = null;
  for (const line of lines) {
    if (fence) {
      const inside = splitQuote(line, fence.depth);
      if (inside.depth >= fence.depth) {
        fenced.push(true);
        const close = inside.rest.match(FENCE_CLOSE);
        if (
          close &&
          close[1][0] === fence.marker[0] &&
          close[1].length >= fence.marker.length
        )
          fence = null;
        continue;
      }
      fence = null;
    }
    const { depth, rest } = splitQuote(line);
    const open = rest.match(FENCE_OPEN);
    // An info string after a backtick fence holds no backtick: "```x```" is inline code.
    const opens =
      Boolean(open) && !(open[1][0] === '`' && open[2].includes('`'));
    fenced.push(opens);
    if (opens) fence = { marker: open[1], depth };
  }
  return { fenced, open: fence !== null };
}

/**
 * [start, end) offsets in `text` that a name rewrite leaves alone: every fenced line, and what PROTECTED_PATTERNS match
 * on the other lines. Sorted, and merged where they overlap or touch, so `overlapsRange` can bisect them.
 */
function protectedRanges(text) {
  const lines = text.split('\n');
  const { fenced } = fenceMap(lines);
  const ranges = [];
  let offset = 0;
  lines.forEach((line, i) => {
    if (fenced[i]) ranges.push([offset, offset + line.length]);
    else
      for (const regex of PROTECTED_REGEXES)
        for (const match of line.matchAll(regex))
          ranges.push([
            offset + match.index,
            offset + match.index + match[0].length,
          ]);
    offset += line.length + 1;
  });
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

/** Does [start, end) share a character with one of the sorted, disjoint `ranges`? Bisects, so it is O(log n). */
function overlapsRange(ranges, start, end) {
  let low = 0;
  let high = ranges.length;
  // The first range that ends after `start`.
  while (low < high) {
    const mid = (low + high) >> 1;
    if (ranges[mid][1] > start) high = mid;
    else low = mid + 1;
  }
  return low < ranges.length && ranges[low][0] < end;
}

/** `text` with the protected spans blanked (same length): what the leak scan reads for names. A span never holds a line break. */
function maskProtected(text) {
  // Offsets count UTF-16 units, so mask by unit, not by code point.
  const units = text.split('');
  for (const [start, end] of protectedRanges(text))
    for (let i = start; i < end; i++) units[i] = ' ';
  return units.join('');
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
      .join(SUBSTITUTIONS.spaced_separator),
    // Underscores for hyphens name the same skill.
    SKILL: escapeRegExp(skill).replace(/[-_]/g, SUBSTITUTIONS.skill_separator),
  };
  const fill = (source) =>
    source.replace(/__([A-Z]+)__/g, (_, key) => tokens[key]);
  const usable = (source, multiWord = false) =>
    !/__SKILL__|__SPACED__/.test(source) ||
    Boolean(skill && (!multiWord || /[-_]/.test(skill)));
  const compile = (source, flags = SUBSTITUTIONS.list_flags) =>
    new RegExp(fill(source), flags);
  return {
    names: NAME_WORDS.filter(([, action, source]) =>
      usable(source, action === 'words-multi'),
    ).map(([id, action, source]) => ({ id, action, regex: compile(source) })),
    // A removed path takes the space before it, so "Read x then" does not become "Read  then".
    paths: PATH_PATTERNS.filter(([, source]) => usable(source)).map(
      ([id, source]) => ({
        id,
        regex: compile(
          SUBSTITUTIONS.path_without_leading_space.includes(id)
            ? source
            : `${SUBSTITUTIONS.path_leading_space}(?:${source})`,
        ),
      }),
    ),
    skillWords: SKILL_WORDS.map((source) => compile(source)),
    namedWords: NAMED_WORDS.filter((source) => usable(source, true)).map(
      (source) => compile(source),
    ),
    cueWords: CUE_WORDS.map((source) => compile(source)),
    weakCueWords: WEAK_CUE_WORDS.map((source) => compile(source)),
    harnessPhrases: HARNESS_PHRASES.map((source) => compile(source)),
    usePhrases: USE_PHRASES.map((source) => compile(source)),
    narrators: NARRATOR_WORDS.map(
      ([source, flags]) => new RegExp(source, flags),
    ),
  };
}

/** `text` with every run of whitespace as one space: what the request guard compares, so a wrapped line still matches. */
const flatten = (text) => text.replace(/\s+/g, ' ');

/**
 * Is the sentence narration? It is when it holds a phrase of HARNESS_PHRASES, or of USE_PHRASES when the task is not about
 * skills (a phrase the request holds does not count). Otherwise it is when a skill word and a cue word are in it, the pair is one the rules accept, and the
 * text from one to the other is not in the request. A named word takes any cue; a generic word takes a strong cue, or any
 * cue when the sentence has a narrator, and for a generic word the request itself uses ("topic": the task is about
 * skills) only a narrator will do. Matches are read in order of position, each against the nearest earlier match of each
 * kind of the other list (at most two), so the cost is linear in the sentence. `request` is flattened; `topic` is the set
 * of generic skill words (by index) that the request uses.
 */
function isNarration(sentence, lists, request, topic = new Set()) {
  // The phrases that are narration alone. Index 0 of the skill words is "skill": a request that uses it is about skills.
  const phrased = (regexes) =>
    regexes.some((regex) =>
      [...sentence.matchAll(regex)].some(
        (match) => !request.includes(flatten(match[0])),
      ),
    );
  if (
    phrased(lists.harnessPhrases) ||
    (!topic.has(0) && phrased(lists.usePhrases))
  )
    return true;
  const hits = [];
  const add = (regexes, kind, topical) =>
    regexes.forEach((regex, index) => {
      for (const match of sentence.matchAll(regex))
        hits.push({
          start: match.index,
          end: match.index + match[0].length,
          kind,
          topic: topical && topic.has(index),
        });
    });
  add(lists.skillWords, 'generic', true);
  add(lists.namedWords, 'named', false);
  add(lists.cueWords, 'strong', false);
  add(lists.weakCueWords, 'weak', false);
  const narrated = lists.narrators.some((regex) => sentence.search(regex) >= 0);
  const accepted = (skill, cue) =>
    skill.kind === 'named' ||
    narrated ||
    (cue.kind === 'strong' && !skill.topic);
  hits.sort((a, b) => a.start - b.start || a.end - b.end);
  const last = {};
  for (const hit of hits) {
    const isSkill = hit.kind === 'generic' || hit.kind === 'named';
    for (const other of isSkill
      ? [last.strong, last.weak]
      : [last.generic, last.named]) {
      if (!other) continue;
      const [skill, cue] = isSkill ? [hit, other] : [other, hit];
      if (
        accepted(skill, cue) &&
        !request.includes(
          flatten(
            sentence.slice(
              Math.min(other.start, hit.start),
              Math.max(other.end, hit.end),
            ),
          ),
        )
      )
        return true;
    }
    last[hit.kind] = hit;
  }
  return false;
}

/** Splits `body` into sentences and keeps the ones that are not narration; the others go into `dropped`. */
function splitNarration(body, lists, request, topic, dropped) {
  const sentences = body.split(SENTENCE_SPLIT);
  const survivors = sentences.filter(
    (sentence) =>
      !isNarration(sentence, lists, request, topic) || !dropped.push(sentence),
  );
  return { survivors, sentences };
}

/** A table row with its narrating cells emptied, so the row keeps its columns. */
function dropTableRow(row, lists, request, topic, dropped) {
  return row
    .split(CELL_SPLIT)
    .map((cell, i) => {
      // Before the first pipe is the indent.
      if (i === 0 || !cell.trim()) return cell;
      const { survivors, sentences } = splitNarration(
        cell.trim(),
        lists,
        request,
        topic,
        dropped,
      );
      if (survivors.length === sentences.length) return cell;
      return ` ${survivors.join(' ')} `;
    })
    .join('|');
}

// A sentence ends at . ! or ? and up to 3 closing marks.
const SENTENCE_END = /[.!?][*_`'")\]]{0,3}\s*$/;

/** A line that is a label or a title: it ends in a colon, or has no stop and at most four words ("**Skills**", "Team skills"). */
const isLabel = (line) =>
  /:\s*$/.test(line) ||
  (!SENTENCE_END.test(line) && line.trim().split(/\s+/).length <= 4);

/**
 * Does `next` carry on the paragraph that `previous` is in? `wrapped` is how sure the join must be (see dropNarration).
 * "likely": the line above ends without a stop and this one goes on in lower case, a digit or a mark. "any" (the leak
 * scan) joins every line of a paragraph, except a line that starts with a capital after a label: "**Skills**" followed
 * by "Load testing is covered." are two paragraphs, and joining them would flag a heading and its first line.
 */
function continuesParagraph(previous, next, wrapped) {
  if (!previous.trim() || !next.trim()) return false;
  if (HEADING.test(previous) || BLOCK_START.test(next)) return false;
  if (wrapped !== 'any')
    return !WRAPPED_END.test(previous) && WRAPPED_NEXT.test(next);
  return WRAPPED_NEXT.test(next) || !isLabel(previous);
}

/**
 * { text, dropped }: `text` without its narration sentences, outside fenced code; `dropped` lists them. A table row is
 * read cell by cell. A paragraph that is hard-wrapped over several lines is read as one text: with `wrapped` "likely"
 * (the default, what the sanitizer drops) a line joins the one above when that ends without a stop and it starts in
 * lower case, a digit or a mark; with "any" (the leak scan) every line of a paragraph joins, so a wrap before a capital
 * cannot hide narration from the scan. A paragraph that loses a sentence is written back as one line.
 */
function dropNarration(text, lists, request, { wrapped = 'likely' } = {}) {
  const lines = text.split('\n');
  const { fenced } = fenceMap(lines);
  const flatRequest = flatten(request);
  const topic = new Set(
    lists.skillWords.flatMap((regex, index) =>
      flatRequest.search(regex) >= 0 ? [index] : [],
    ),
  );
  const kept = [];
  const dropped = [];
  let i = 0;
  while (i < lines.length) {
    if (fenced[i]) {
      kept.push(lines[i++]);
      continue;
    }
    if (TABLE_ROW.test(lines[i])) {
      kept.push(dropTableRow(lines[i++], lists, flatRequest, topic, dropped));
      continue;
    }
    let end = i + 1;
    while (
      end < lines.length &&
      !fenced[end] &&
      continuesParagraph(lines[end - 1], lines[end], wrapped)
    )
      end++;
    const chunk = lines.slice(i, end);
    i = end;
    const indent = chunk[0].match(/^\s*/)[0];
    const { survivors, sentences } = splitNarration(
      chunk.join('\n').slice(indent.length),
      lists,
      flatRequest,
      topic,
      dropped,
    );
    if (survivors.length === sentences.length) kept.push(...chunk);
    else if (survivors.length) kept.push(indent + survivors.join(' '));
  }
  return { text: kept.join('\n'), dropped };
}

/** The narration sentences of `text`, as the sanitizer would drop them (the leak scan's second look). `wrapped`: see dropNarration. */
function findNarration(
  text,
  {
    skill = '',
    settings = DEFAULT_SETTINGS,
    request = '',
    wrapped = 'likely',
  } = {},
) {
  return dropNarration(
    String(text),
    compileLists(skill, settings),
    normalizeText(request).text,
    { wrapped },
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
      CELL_SPLIT.source,
      BLOCK_START.source,
      HEADING.source,
      WRAPPED_END.source,
      WRAPPED_NEXT.source,
      FENCE_OPEN.source,
      FENCE_CLOSE.source,
      QUOTE_PREFIX.source,
    ],
    name_words: NAME_WORDS,
    skill_words: SKILL_WORDS,
    named_words: NAMED_WORDS,
    cue_words: CUE_WORDS,
    weak_cue_words: WEAK_CUE_WORDS,
    narrator_words: NARRATOR_WORDS,
    harness_phrases: HARNESS_PHRASES,
    use_phrases: USE_PHRASES,
    path_patterns: PATH_PATTERNS,
    substitutions: SUBSTITUTIONS,
    protected_patterns: PROTECTED_PATTERNS,
    unprotected_name_rules: UNPROTECTED_NAME_RULES,
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
    for (const { id, action, regex } of lists.names) {
      // Spans of the current text, found again for each rule because the earlier rewrites moved the offsets.
      const spans = UNPROTECTED_NAME_RULES.includes(id)
        ? []
        : protectedRanges(text);
      text = text.replace(regex, (...args) => {
        const [matched] = args;
        const start = args[args.length - 2];
        if (
          keep(matched) ||
          overlapsRange(spans, start, start + matched.length)
        )
          return matched;
        count(id);
        const group = args.slice(1, -2)[0];
        if (action === 'approach')
          return group
            ? `${group}${SUBSTITUTIONS.approach_after_article}`
            : SUBSTITUTIONS.approach_alone;
        if (action === 'agent')
          return ruleRegExp(SUBSTITUTIONS.orchestrator_match).test(group)
            ? SUBSTITUTIONS.orchestrator
            : group
                .replace(ruleRegExp(SUBSTITUTIONS.agent_prefix), '')
                .replace(
                  ruleRegExp(SUBSTITUTIONS.word_separator),
                  SUBSTITUTIONS.word_joiner,
                )
                .toLowerCase();
        return group
          .replace(
            ruleRegExp(SUBSTITUTIONS.word_separator),
            SUBSTITUTIONS.word_joiner,
          )
          .trim();
      });
    }
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
  NAMED_WORDS,
  CUE_WORDS,
  WEAK_CUE_WORDS,
  NARRATOR_WORDS,
  HARNESS_PHRASES,
  USE_PHRASES,
  PATH_PATTERNS,
  SUBSTITUTIONS,
  PROTECTED_PATTERNS,
  UNPROTECTED_NAME_RULES,
  WRAP,
  createSanitizer,
  sanitizeAnswer: createSanitizer().sanitize,
  findNarration,
  normalizeText,
  escapeRegExp,
  agentAlternation,
  fenceMap,
  protectedRanges,
  overlapsRange,
  maskProtected,
};
