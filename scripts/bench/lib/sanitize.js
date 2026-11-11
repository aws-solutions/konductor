// SPDX-License-Identifier: Apache-2.0
/**
 * Sanitizer rules. Turns a stored subject answer into text that does not say which arm
 * wrote it. Pure: no file, network or clock access, no state, and the same input always gives the same output.
 *
 * Blinding starts upstream: the `without` prompt names no skill and both arms get the same answer-style line.
 * Matching text cannot hide a difference in style or content that comes from the skill itself, so this is one
 * layer and not a guarantee. Run the redactor and the leak check after it (judge-input.js).
 *
 * What it does, in this order:
 *   1. Normalizes, so matching cannot be dodged: control, zero-width, bidi and tag characters are removed, every line
 *      break becomes "\n", and the text is NFC. (NFKC would rewrite real content such as "m2" and ligatures.)
 *   2. Maps the name the arms installed a bundled-named skill under back to the skill's own name (bundled-skills.js).
 *   3. Phases "block" and "sentence", outside fenced code and table rows: drops "available skills" lists, list entries
 *      that introduce the skill under test, and sentences that narrate loading a skill, calling the Skill tool,
 *      following guidance, or saying that no skill was found, matched or used (skill-narration.js, one clause-level rule
 *      for the whole class). These come first because they key on the word "skill" and the plugin prefix: a sentence
 *      about a named skill ("I could not find the e2e-test-strategy skill.") is seen with its noun before step 5
 *      neutralizes the name.
 *   4. Phase "rewrite": rewrites that keep a sentence's content. "The skill's checklist" becomes "The checklist".
 *   5. Phases "path", "name" and "label", everywhere: removes harness and skill paths, neutralizes skill, plugin and
 *      agent names ("the e2e-test-strategy skill" becomes "the approach", a bare name becomes its plain words, in its
 *      own letter case), and removes arm labels. A skill whose name is one plain word ("verification") is not
 *      rewritten as a bare name, because that word is ordinary prose; its plugin-qualified and labelled forms are.
 *   6. Phase "post", outside fenced code and table rows: drops a sentence that still has the word "skill" together with
 *      a narration cue (SKILL_NARRATION). A sentence that uses "skill" as an ordinary noun is kept.
 *
 * RULE ORDER MATTERS. PIPELINE is the order the phases run, and it is part of the hash. Everything that removes or
 * changes the word "skill" runs after the narration rules: the rewrite (step 4) and the name rules (step 5) would
 * otherwise turn "I loaded the skill's checklist" into "I loaded the checklist", which no narration rule can see. The
 * post rule (step 6) drops a whole sentence, so it runs after steps 4 and 5 have kept the content of every sentence
 * that only names the skill: "Per the e2e-test-strategy skill, rank by risk." becomes "Per the approach, rank by risk."
 * Tests pin PIPELINE, RULES order and the behavior each order gives.
 *
 * No marker is emitted by these rules. Text that is not harness narration (security examples, relative paths, domain
 * terms, ordinary uses of the word "skill") is left as written. Redaction markers come from the redactor, not here.
 *
 * Every drop is counted: `removed_chars` (non-whitespace characters deleted, by rule in `removed_by_rule`) and
 * `removed_share` of the answer, so the judge input can refuse an answer the rules emptied. A rewrite is not a removal.
 *
 * SANITIZER_VERSION and `spec` go into the provenance hash that judge-input.js builds. `spec` is every rule and setting
 * here that can change the output: the rule table and pipeline, the normalization, the settings, the bundled-skill
 * list and alias suffix, the input cap and the code-level patterns. When a rule or the code that applies it changes,
 * bump SANITIZER_VERSION.
 */
'use strict';

const {
  armSkillName,
  BUNDLED_SKILLS,
  ALIAS_SUFFIX,
} = require('./bundled-skills');
const {
  SKILL_CLASS_SPEC,
  SKILL_DOMAIN_NEXT,
  SENTENCE_SPLIT: SENTENCE_SPLIT_PATTERN,
  isSkillAbsenceNarration,
} = require('./skill-narration');

const SANITIZER_VERSION = 6;
/** Input over this many characters is not scanned: the answer is dropped whole (`too_long`), never cut and passed on. */
const MAX_INPUT_CHARS = 1000000;
const PHASES = Object.freeze([
  'block',
  'sentence',
  'rewrite',
  'path',
  'name',
  'label',
  'post',
]);
// The order the phases run in sanitize(): [kind, phases, options]. 'lines' works per line and sentence outside fenced
// code (and, for 'keepTables', leaves table rows alone), 'text' rewrites matches over the whole text.
const PIPELINE = Object.freeze([
  Object.freeze({
    kind: 'lines',
    phases: Object.freeze(['block', 'sentence']),
    keepTables: true,
  }),
  Object.freeze({
    kind: 'text',
    phases: Object.freeze(['rewrite', 'path', 'name', 'label']),
  }),
  Object.freeze({
    kind: 'lines',
    phases: Object.freeze(['post']),
    keepTables: true,
  }),
]);

/**
 * The settings that change what the rules match. `plugin` is the plugin namespace the arms install skills under
 * ("bench:<skill>"). `scratchPrefix` starts the name of the arms' private scratch folders. `agentPatterns` are regex
 * sources for agent identifiers that must not reach a judge. Konductor's own agent ids are the default.
 */
const DEFAULT_SETTINGS = Object.freeze({
  plugin: 'bench',
  scratchPrefix: 'bench',
  agentPatterns: Object.freeze([
    'k-(?:architect|browser|developer|media-analyzer|product-manager|quality-assurance|researcher|tpm)',
    'konductor(?:-[a-z0-9]+)*',
  ]),
});

const PLUGIN_TOKEN = '__PLUGIN__';
const SKILL_TOKEN = '__SKILL__';
const SKILL_SPACED_TOKEN = '__SKILL_SPACED__';
const SCRATCH_TOKEN = '__SCRATCH__';
const AGENT_TOKEN = '__AGENTS__';

const NORMALIZE_SPEC = Object.freeze({
  // Everything except \t (09), \n (0A) and \r (0D, converted below).
  controls: '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]',
  invisible:
    '[\\u00AD\\u034F\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180B-\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\u3164\\uFEFF\\uFFA0]|[\\u{E0000}-\\u{E007F}]',
  lineBreaks: '\\r\\n|\\r|\\u2028|\\u2029',
  form: 'NFC',
});
const CONTROL_PATTERN = new RegExp(NORMALIZE_SPEC.controls, 'g');
const INVISIBLE_PATTERN = new RegExp(NORMALIZE_SPEC.invisible, 'gu');
const LINE_BREAK_PATTERN = new RegExp(NORMALIZE_SPEC.lineBreaks, 'g');

/** Control, zero-width and line-break normalization. Returns { text, removed } (removed counts deleted characters). */
function normalizeText(value) {
  let removed = 0;
  const countRemoval = () => {
    removed += 1;
    return '';
  };
  const normalized = (
    value === null || value === undefined ? '' : String(value)
  )
    .replace(LINE_BREAK_PATTERN, '\n')
    .replace(CONTROL_PATTERN, countRemoval)
    .replace(INVISIBLE_PATTERN, countRemoval);
  return { text: normalized.normalize(NORMALIZE_SPEC.form), removed };
}

// Characters that may wrap a name: backticks, quotes, bold and italic marks. At most 4, so a long run of them costs a
// bounded amount of backtracking per position and the rules stay linear in the length of the answer.
const WRAP = '[`\'"*_]{0,4}';
// "skill" as a word. Not "skill-based" or "skillset". Not the HR and training senses ("skill level", "skills matrix"): those
// are domain content, whatever else the sentence says. The list is SKILL_DOMAIN_NEXT, which skill-narration.js needs too.
// The words in SKILL_AMBIGUOUS_NEXT are ordinary in "a broad skill set", "a skill set for the role" and "the skill of the
// team", and narration in "there is no skill of that name", "no skill set or skill library matches" and "I checked the
// skill registry". So they exempt "skill" only when the sentence has no lookup cue (SKILL_LOOKUP_CUE) within 80
// characters before or after it.
const SKILL_AMBIGUOUS_NEXT =
  'of|sets?|librar(?:y|ies)|registry|registries|catalog(?:ue)?s?|directory|directories|marketplace|platforms?|ecosystems?';
// The ambiguous words that name a place a skill is looked up in. "skill set" and "skill of" are not places.
const SKILL_LOOKUP_PLACE =
  'librar(?:y|ies)|registry|registries|catalog(?:ue)?s?|directory|directories|marketplace';
const SKILL_LOOKUP_CUE =
  '(?:no|none|such|that\\s+name|check(?:ed|ing)|loaded|available|installed|unknown|exists?)';
const SKILLWORD =
  `skills?(?![\\w-])(?!\\s+(?:${SKILL_DOMAIN_NEXT})\\b)` +
  `(?!(?<!\\b${SKILL_LOOKUP_CUE}\\b[^.!?\\n]{0,80})\\s+(?:${SKILL_AMBIGUOUS_NEXT})\\b(?![^.!?\\n]{0,80}\\b${SKILL_LOOKUP_CUE}\\b))`;
// Narration around the bare word "skill": the post rule and the leak scan share this one pattern. "skill" next to one of
// these cues is the harness (loaded, invoked, blocked, no such skill, per the skill). "skill" alone is not: "A good
// tester needs one more skill: patience." has no cue and stays.
//
// The cues come in three strengths. Harness verbs (NARRATION_CUE) pair with "skill" anywhere within 80 characters:
// ordinary prose about skills rarely loads, invokes or blocks one. Ordinary words that are narration only in a fixed
// shape (SKILL_EXACT_SHAPES) match only that shape: "no" in "no such skill", "available" in "the skill is not
// available", never "There is no skill more valuable" or "Skills are available in the course catalog". Attribution
// words (SKILL_ATTRIBUTION_CUE) match only next to "the skill" or "this skill": "per the skill", "this skill named",
// never "Per the team plan, each hire needs one core skill" or "Tests named after the skill they exercise".
const NARRATION_CUE =
  '(?:installed|blocked|denied|disabled|exists?|existed|load(?:s|ed|ing)?|invok(?:e|es|ed|ing)|activat(?:e|es|ed|ing)|launch(?:es|ed|ing)?)';
// The shapes in SKILL_EXACT_SHAPES need no lookup verb ("no such skill", "unknown skill", "There is no skill for this").
// Every other missing-skill wording ("No skill could be found", "Skill not found", "I did not find a skill", "The skill
// was unavailable") is the clause-level rule missing-skill-narration (skill-narration.js). It runs before the name rules,
// so it also sees a named skill. A fixed shape per wording leaves the neighbours of each wording open.
const SKILL_EXACT_SHAPES =
  `\\bno\\s+such\\s+${SKILLWORD}|\\bno\\s+${SKILLWORD}\\s+(?:of\\s+that\\s+name|by\\s+that\\s+name|named|called)\\b` +
  `|\\b${SKILLWORD}(?:\\s+tool)?\\s+(?:is|are|was|were)(?:\\s+not|n't)\\s+(?:available|installed|found|loaded)\\b` +
  `|\\bunknown\\s+${SKILLWORD}` +
  `|\\bthere\\s+(?:is|was|are|were)\\s+no\\s+(?:\\w+\\s+)?${SKILLWORD}\\s+(?:for|to)\\b` +
  // A place to look a skill up. SKILLWORD accepts "skill registry" only when a lookup cue is near, so this is "I checked
  // the skill registry" and not "A skills registry helps HR plan hiring".
  `|\\b${SKILLWORD}\\s+(?:${SKILL_LOOKUP_PLACE})\\b`;
const SKILL_ATTRIBUTION_CUE =
  '(?:per|follow(?:s|ed|ing)?|consult(?:s|ed|ing)?|named|called|check(?:s|ed|ing)?|based\\s+on|according\\s+to)';
const SKILL_ATTRIBUTION = `\\b${SKILL_ATTRIBUTION_CUE}\\s+(?:the|this)\\s+${SKILLWORD}|\\b(?:the|this)\\s+${SKILLWORD}\\s+(?:named|called)\\b`;
const SKILL_NARRATION = `\\bskill[-\\s](?:loading|execution|invocation)\\b|\\bloads?\\s+skills?\\b|${SKILL_EXACT_SHAPES}|${SKILL_ATTRIBUTION}|\\b${NARRATION_CUE}\\b[^.!?\\n]{0,80}\\b${SKILLWORD}|\\b${SKILLWORD}[^.!?\\n]{0,80}\\b${NARRATION_CUE}\\b`;
// The start of a path: only at the beginning of a path (not inside one), so a long token costs one scan, not one per character.
const PATH_START = '(?<![\\w.~/-])/?(?:[\\w.~-]+/)*';
const NARRATION_VERBS =
  'load|loading|loaded|invoke|invoking|invoked|call|calling|called|activate|activating|activated|launch|launching|launched|use|using|used|apply|applying|applied|follow|following|followed|read|reading';

// Each rule is data (id, phase, action, flags, regex source) so the hash covers it. `action` selects the code in
// applyTextRules and applyLineRules. Tokens are filled per call from the skill under test and the settings.
const RULES = Object.freeze([
  // block: whole lines and list blocks.
  {
    id: 'skill-list-header',
    phase: 'block',
    action: 'drop-list-block',
    flags: 'i',
    source:
      '^\\s*(?:#{1,6}\\s*)?\\**(?:(?:available|installed|loaded)\\s+skills|skills\\s+(?:available|installed|loaded)|the\\s+following\\s+skills(?:\\s+are\\s+available[^\\n]*)?|(?:you|i)\\s+have\\s+access\\s+to\\s+(?:these|the\\s+following)\\s+skills[^\\n]*)\\**\\s*[:\\u2014\\u2013-]?\\s*$',
  },
  {
    id: 'skill-list-entry',
    phase: 'block',
    action: 'drop-line',
    flags: 'i',
    multiWordOnly: true,
    source: `^\\s*[-*\\u2022]\\s+${WRAP}(?:${PLUGIN_TOKEN}:)?${SKILL_TOKEN}${WRAP}\\s*[:\\u2014\\u2013-]\\s`,
  },
  // sentence: a sentence that matches is dropped.
  {
    id: 'loading-narration',
    phase: 'sentence',
    action: 'drop-sentence',
    flags: 'i',
    source: `\\b(?:i|we|let me|let's)(?:'ll|'m|'ve|\\s+will|\\s+am|\\s+have|\\s+need\\s+to|\\s+should|\\s+must|\\s+can|\\s+first|\\s+now)?\\b[^.!?\\n]{0,40}?\\b(?:${NARRATION_VERBS})\\b[^.!?\\n]{0,80}?(?:\\b${SKILLWORD}|\\bskill\\s+tool\\b|${PLUGIN_TOKEN}:[a-z0-9-]+)`,
  },
  {
    id: 'loading-heading',
    phase: 'sentence',
    action: 'drop-sentence',
    flags: 'i',
    source: `^\\s*(?:#{1,6}\\s*|[-*\\u2022]\\s*)?\\**(?:loading|loaded|invoking|invoked|activating|activated|launching|launched|using)\\s+(?:the\\s+)?(?:\`?${PLUGIN_TOKEN}:\\S+|${SKILLWORD}|[^\\s.!?]+(?:\\s+[^\\s.!?]+){0,3}?\\s+${SKILLWORD})`,
  },
  {
    id: 'skill-tool-narration',
    phase: 'sentence',
    action: 'drop-sentence',
    flags: 'i',
    source:
      '\\bskill\\s+(?:loaded|tool)\\b|\\bsuccessfully\\s+loaded\\b[^.!?\\n]{0,40}\\bskills?\\b|\\bSkill\\([^)\\n]{0,200}\\)',
  },
  {
    id: 'skill-state-narration',
    phase: 'sentence',
    action: 'drop-sentence',
    flags: 'i',
    source: `(?:\`?${PLUGIN_TOKEN}:[a-z0-9-]+\`?|\\b[a-z0-9-]{1,64}\\s+skill)\\s+(?:is|was|has\\s+been)\\s+(?:now\\s+)?(?:loaded|active|available)\\b|\\b(?:the|this|that)\\s+skill\\s+(?:says|states|instructs|tells|requires|recommends|directs|asks)\\b`,
  },
  // Guidance narration with no named referent. The with arm is told to load a skill, so an answer that talks about
  // having received guidance, or about refusing it, says something the without arm cannot. "guidance" and
  // "instructions" are ordinary words, so only these shapes match: first-person adherence talk, a handed-to-me
  // adjective, and the says/requires frame. A sourced reference ("the guidance in the style guide") is kept by the
  // first two. The third drops it, which costs a sentence of real content: an unsourced "the instructions say" cannot be
  // told from arm narration.
  {
    id: 'guidance-adherence-narration',
    phase: 'sentence',
    action: 'drop-sentence',
    flags: 'i',
    source:
      '\\b(?:i|we)\\b[^.!?\\n]{0,40}?\\b(?:follow(?:ed|ing)?|ignor(?:e|ed)|overr(?:ode|ule[ds]?|iding)|disregard(?:ed)?|reject(?:ed)?|deviat(?:e|ed)\\s+from|depart(?:ed)?\\s+from|adopt(?:ed)?|appl(?:y|ied))\\b[^.!?\\n]{0,40}?\\b(?:guidance|directives?|instructions?|advice|recommendations?)\\b(?!\\s+(?:of|in|from|on|at|by|published|issued)\\b)',
  },
  {
    id: 'handed-guidance-reference',
    phase: 'sentence',
    action: 'drop-sentence',
    flags: 'i',
    source:
      '\\b(?:loaded|provided|supplied|preloaded|pre-loaded|given|injected|appended|attached)\\s+(?:guidance|directives?|instructions?|advice|recommendations?)\\b|\\b(?:guidance|directives?|instructions?|advice)\\s+(?:i|we)\\s+(?:was|were|have\\s+been|had\\s+been)\\s+(?:given|provided|handed|shown)\\b',
  },
  {
    id: 'guidance-state-narration',
    phase: 'sentence',
    action: 'drop-sentence',
    flags: 'i',
    source:
      '\\b(?:the|this|that)\\s+(?:guidance|directives?|instructions?)\\s+(?:is|was|says?|states?|instructs?|tells?|requires?|recommends?|directs?|asks?|calls\\s+for)\\b|\\bper\\s+the\\s+(?:loaded|provided|given)?\\s*(?:guidance|directives?|instructions?)\\b(?!\\s+(?:of|in|from|on|at|by)\\b)',
  },
  // Missing or unused skill, as one class (skill-narration.js): the noun "skill" with a negation and a lookup word, or
  // with a first-person narrator, in one clause. It is a function, not a pattern: `matcher` names it (MATCHERS), `source`
  // is empty, and the words and windows it reads are in the spec as `skill_class`. It runs in this phase, before the
  // name rules, so a named skill ("I could not find the e2e-test-strategy skill") is seen with its noun.
  {
    id: 'missing-skill-narration',
    phase: 'sentence',
    action: 'drop-sentence',
    flags: '',
    matcher: 'skill-absence',
    source: '',
  },
  // A sentence right after dropped narration that comments on it ("That cannot be applied here.") goes with it. It
  // applies only after a drop (dropSentences), so on its own it matches nothing.
  {
    id: 'narration-followup',
    phase: 'sentence',
    action: 'drop-followup',
    flags: 'i',
    source:
      "^(?:that|this|it)\\b[^.!?]*\\b(?:cannot|can't|ignored|ignore|followed|guidance|instruction)\\b",
  },
  // rewrite: keep the sentence, remove the tell. It runs after the narration rules, which need the word "skill" it
  // removes: "I loaded the skill's checklist" is narration, "The skill's checklist treats S3 as global" is content.
  {
    id: 'skill-possessive',
    phase: 'rewrite',
    action: 'possessive-to-article',
    flags: 'gi',
    source:
      "\\b(?:(the|this|that|its|our)\\s+)?skills?['\\u2019]s?(?=\\s+[a-z])",
  },
  // path: harness and skill folders.
  {
    id: 'scratch-path',
    phase: 'path',
    action: 'strip-prefix',
    flags: 'gi',
    source: `(?:/private)?(?:/var/folders/[A-Za-z0-9_]+/[A-Za-z0-9_]+/T|/tmp|/var/tmp|\\$\\{?TMPDIR\\}?)/${SCRATCH_TOKEN}-(?:subject|arms|judge)-[A-Za-z0-9._-]*(?:/(?:with|without))?/?`,
  },
  {
    id: 'harness-repo-path',
    phase: 'path',
    action: 'drop-match',
    flags: 'gi',
    source: `${PATH_START}scripts/bench(?![\\w-])(?:/[\\w.@=+-]+)*/?`,
  },
  {
    id: 'plugin-dir-path',
    phase: 'path',
    action: 'drop-match',
    flags: 'gi',
    source: `${PATH_START}\\.claude-plugin(?:/[\\w.-]+)*/?`,
  },
  {
    id: 'skill-dir-path',
    phase: 'path',
    action: 'drop-match',
    flags: 'gi',
    source: `${PATH_START}skills/(?:${SKILL_TOKEN}|[a-z0-9-]+/SKILL\\.md)(?:/[\\w.-]+)*`,
  },
  // name: explicit names.
  {
    id: 'skill-name-in-parens',
    phase: 'name',
    action: 'drop-match',
    flags: 'gi',
    multiWordOnly: true,
    source: `\\(\\s*${WRAP}(?:${PLUGIN_TOKEN}:)?${SKILL_TOKEN}${WRAP}(?:\\s+skill)*\\s*\\)`,
  },
  {
    id: 'plugin-qualified-name',
    phase: 'name',
    action: 'words',
    flags: 'gi',
    source: `${WRAP}\\b${PLUGIN_TOKEN}:([a-z0-9][a-z0-9-]*)${WRAP}`,
  },
  // "the e2e-test-strategy skill" -> "the approach": the skill's topic words would hint at the arm.
  {
    id: 'skill-name-with-label',
    phase: 'name',
    action: 'neutral-keep-article',
    flags: 'gi',
    source: `(?<![A-Za-z0-9-])(the\\s+)?${WRAP}${SKILL_TOKEN}${WRAP}(?:\\s+(?:skill|plugin)\\b)+`,
  },
  {
    id: 'skill-name-spaced-with-label',
    phase: 'name',
    action: 'neutral-keep-article',
    flags: 'gi',
    source: `(?<![A-Za-z0-9-])(the\\s+)?${SKILL_SPACED_TOKEN}(?:\\s+(?:skill|plugin)\\b)+`,
  },
  // A name of one plain word ("verification", "constraints") is ordinary prose, so only the forms above that carry a
  // label or the plugin prefix touch it. The words keep the letter case they were written in.
  {
    id: 'skill-name',
    phase: 'name',
    action: 'words',
    flags: 'gi',
    multiWordOnly: true,
    source: `${WRAP}(?<![A-Za-z0-9-])(${SKILL_TOKEN})(?![A-Za-z0-9-])${WRAP}`,
  },
  {
    id: 'agent-identifier',
    phase: 'name',
    action: 'agent-words',
    flags: 'gi',
    source: `${WRAP}(?<![A-Za-z0-9-])(${AGENT_TOKEN})(?![A-Za-z0-9-])${WRAP}`,
  },
  // label: arm labels. Ordinary words such as "with", "arm" and "harness" are not labels and are left alone.
  {
    id: 'arm-label-paren',
    phase: 'label',
    action: 'drop-match',
    flags: 'g',
    source:
      '\\(\\s*(?:arm[:=\\s-]+)?(?:the\\s+)?(?:WITH|WITHOUT|WITH2|with|without|with2)(?:[-_ ](?:ARM|arm))?\\s*\\)(?=[\\s.,;:!?]|$)',
  },
  {
    id: 'arm-label',
    phase: 'label',
    action: 'drop-match',
    flags: 'g',
    source:
      '(?:\\bthe\\s+)?\\b(?:WITH|WITHOUT|WITH2)[-_ ](?:ARM|[Aa]rm)\\b|(?:\\bthe\\s+)?["\'`*]?\\b(?:with|without|with2)["\'`*]?(?:[-_]arm\\b|\\s+arm\\b["\'`*]?(?=\\s+(?:answer|run|sample|prompt|response|output|received|had|was|is|did|got)\\b))|\\barm[:=]\\s*["\'`]?(?:with2|without|with)\\b["\'`]?|\\b(?:with|without)[-_]skill\\b|\\bwith2\\b|\\bcondition[\\s-]+ii\\b',
  },
  // post: whatever is left. After the rewrite and name rules every named reference is neutralized, so a surviving bare
  // "skill" next to a narration cue is the harness: "The skill I loaded said to use MAX", "No checker skill exists for
  // security plans", "There is no such skill", "I checked the skill registry". A sentence that uses "skill" as an
  // ordinary noun has no cue and stays ("A good tester needs one more skill: patience.").
  {
    id: 'bare-skill-reference',
    phase: 'post',
    action: 'drop-sentence',
    flags: 'i',
    source: SKILL_NARRATION,
  },
  // The skill file named alone: the without arm has no skill file to mention. Paths that hold it are removed above.
  {
    id: 'skill-file-mention',
    phase: 'post',
    action: 'drop-sentence',
    flags: '',
    source: '\\bSKILL\\.md\\b',
  },
]);

const escapeRegExp = (text) =>
  String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "e2e-test-strategy" -> "e2e test strategy" */
const wordsOf = (slug) =>
  String(slug).toLowerCase().replace(/[-_]+/g, ' ').trim();
/** Like wordsOf, but keeps the letter case: "E2E-Test-Strategy" -> "E2E Test Strategy". */
const formatSlugAsPlainWords = (slug) =>
  String(slug).replace(/[-_]+/g, ' ').trim();
const countNonSpace = (text) => text.replace(/\s+/g, '').length;

function checkSettings(settings) {
  const rejectSettings = (reason) => {
    throw new TypeError(`sanitizer settings: ${reason}`);
  };
  if (
    typeof settings.plugin !== 'string' ||
    !/^[a-z0-9][a-z0-9-]*$/i.test(settings.plugin)
  )
    rejectSettings('plugin must be a plain name such as "bench"');
  if (
    typeof settings.scratchPrefix !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(settings.scratchPrefix)
  )
    rejectSettings('scratchPrefix must be a plain name such as "bench"');
  if (
    !Array.isArray(settings.agentPatterns) ||
    settings.agentPatterns.some(
      (source) => typeof source !== 'string' || !source,
    )
  )
    rejectSettings(
      'agentPatterns must be an array of regular expression sources',
    );
  if (!settings.agentPatterns.length)
    rejectSettings('agentPatterns must list at least one pattern');
  const unknown = Object.keys(settings).filter(
    (key) => !Object.hasOwn(DEFAULT_SETTINGS, key),
  );
  if (unknown.length)
    rejectSettings(`unknown setting(s): ${unknown.join(', ')}`);
  for (const source of settings.agentPatterns) {
    // Each entry is wrapped in its own group and joined with the others, so a backreference or a named group would
    // point at another entry's groups.
    if (/\\[1-9]|\\k<|\(\?<(?![=!])/.test(source))
      rejectSettings(
        `agentPatterns: ${JSON.stringify(source)} may not use backreferences or named groups`,
      );
    let entry;
    try {
      entry = new RegExp(`^(?:${source})$`);
    } catch (error) {
      rejectSettings(`agentPatterns: ${error.message}`);
    }
    // A pattern that matches nothing at all would match between every two words.
    if (entry.test(''))
      rejectSettings(
        `agentPatterns: ${JSON.stringify(source)} matches the empty string`,
      );
  }
  try {
    new RegExp(agentAlternation(settings));
  } catch (error) {
    rejectSettings(`agentPatterns together: ${error.message}`);
  }
}

/** The agent patterns as one regex alternation, each entry in its own group. */
const agentAlternation = (settings) =>
  settings.agentPatterns.map((source) => `(?:${source})`).join('|');

/**
 * Rules whose test is a function of the sentence, by the name a rule gives in `matcher`. A matcher takes one sentence and
 * says whether to drop it, so it needs no regex source. Its own settings are hashed through `spec`.
 */
const MATCHERS = Object.freeze({ 'skill-absence': isSkillAbsenceNarration });

/** Rules with the per-call tokens filled in, as RegExp objects grouped by phase. Each also has `matches(sentence)`. */
function compileRules(skill, settings) {
  const spacedSkill = skill
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(escapeRegExp)
    .join('[\\s_-]+');
  // A name written with underscores in place of hyphens is the same name.
  const skillPattern = escapeRegExp(skill).replace(/[-_]/g, '[-_]');
  const fillTokens = (source) =>
    source
      .split(PLUGIN_TOKEN)
      .join(escapeRegExp(settings.plugin))
      .split(SCRATCH_TOKEN)
      .join(escapeRegExp(settings.scratchPrefix))
      .split(AGENT_TOKEN)
      .join(agentAlternation(settings))
      .split(SKILL_SPACED_TOKEN)
      .join(spacedSkill)
      .split(SKILL_TOKEN)
      .join(skillPattern);
  const compiledByPhase = {};
  for (const rule of RULES) {
    if (
      !skill &&
      (rule.source.includes(SKILL_TOKEN) ||
        rule.source.includes(SKILL_SPACED_TOKEN))
    )
      continue; // nothing to name
    if (rule.multiWordOnly && !/[-_]/.test(skill)) continue; // one plain word cannot be told from ordinary prose
    if (rule.matcher) {
      if (!MATCHERS[rule.matcher])
        throw new Error(`unknown sanitizer matcher ${rule.matcher}`);
      (compiledByPhase[rule.phase] ||= []).push({
        ...rule,
        matches: MATCHERS[rule.matcher],
      });
      continue;
    }
    // A removed path or label also takes the one space before it, so "Read x then" does not become "Read  then".
    const ruleSource =
      rule.action === 'drop-match'
        ? `[ \\t]?(?:${fillTokens(rule.source)})`
        : fillTokens(rule.source);
    const regex = new RegExp(ruleSource, rule.flags);
    (compiledByPhase[rule.phase] ||= []).push({
      ...rule,
      regex,
      matches: (text) => regex.test(text),
    });
  }
  return compiledByPhase;
}

// A fence opens with a run of 3 or more backticks or tildes and closes with a run of the same character at least as
// long, with nothing after it but spaces (CommonMark). A backtick fence's info string holds no backtick, so "```x```"
// is inline code, not a fence.
const FENCE_OPEN_PATTERN = /^\s*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_PATTERN = /^\s*(`{3,}|~{3,})\s*$/;

/**
 * Which lines are fenced code: { fenced, open }. `fenced[i]` is true for a fence line and for every line inside a
 * fence. `open` is true when the text ends inside a fence that was never closed.
 */
function fenceMap(lines) {
  const fenced = [];
  let fence = null;
  for (const line of lines) {
    if (fence) {
      const close = line.match(FENCE_CLOSE_PATTERN);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length)
        fence = null;
      fenced.push(true);
      continue;
    }
    const open = line.match(FENCE_OPEN_PATTERN);
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = open[1];
      fenced.push(true);
    } else fenced.push(false);
  }
  return { fenced, open: fence !== null };
}
const LIST_ITEM_PATTERN = /^\s*(?:[-*\u2022]|\d+[.)])\s/;
// A table row is structured content: dropping one sentence-rule hit would leave the rest of the table.
const TABLE_ROW_PATTERN = /^\s*\|/;
// The sentence split is defined in skill-narration.js, so the leak scan splits text the way this does.
const incrementCount = (counts, id, amount = 1) => {
  if (amount > 0) counts[id] = (counts[id] || 0) + amount;
};
/** Records deleted text: non-whitespace characters, in total and by rule. */
const recordLoss = (lost, id, text) => {
  const charCount = countNonSpace(text);
  if (charCount > 0) {
    lost.total += charCount;
    lost.byRule[id] = (lost.byRule[id] || 0) + charCount;
  }
};

const formatAgentIdAsWords = (id) =>
  /^konductor/i.test(id) ? 'orchestrator' : wordsOf(id.replace(/^k-/i, ''));

/** Drops the sentences of one line that match a narration rule. Returns the new line, or null when nothing is left. */
function dropSentences(line, rules, counts, lost) {
  const indent = line.match(/^\s*/)[0];
  const sentences = line.slice(indent.length).split(SENTENCE_SPLIT_PATTERN);
  const dropRules = rules.filter((rule) => rule.action === 'drop-sentence');
  const followUpRule = rules.find((rule) => rule.action === 'drop-followup');
  let dropped = 0;
  let isAfterNarration = false;
  const kept = sentences.filter((sentence) => {
    const matchedRule = dropRules.find((rule) => rule.matches(sentence));
    const followsNarration =
      !matchedRule &&
      isAfterNarration &&
      followUpRule &&
      followUpRule.regex.test(sentence.trim());
    isAfterNarration = Boolean(matchedRule || followsNarration);
    if (isAfterNarration) {
      const id = matchedRule ? matchedRule.id : followUpRule.id;
      incrementCount(counts, id);
      recordLoss(lost, id, sentence);
      dropped += 1;
    }
    return !isAfterNarration;
  });
  if (!dropped) return line;
  return kept.length ? indent + kept.join(' ') : null;
}

/** Block and sentence rules, line by line, outside fenced code blocks. */
function applyLineRules(
  text,
  compiled,
  counts,
  lost,
  { keepTables = false } = {},
) {
  const lines = text.split('\n');
  const { fenced } = fenceMap(lines);
  const keptLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fenced[i]) {
      keptLines.push(line);
    } else {
      const headerRule = (compiled.block || []).find(
        (rule) => rule.action === 'drop-list-block' && rule.regex.test(line),
      );
      const entryRule = (compiled.block || []).find(
        (rule) => rule.action === 'drop-line' && rule.regex.test(line),
      );
      if (headerRule) {
        incrementCount(counts, headerRule.id);
        recordLoss(lost, headerRule.id, line);
        // The list that follows (after optional blank lines) belongs to the header.
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') j++;
        if (j < lines.length && LIST_ITEM_PATTERN.test(lines[j])) {
          while (
            j < lines.length &&
            (LIST_ITEM_PATTERN.test(lines[j]) || /^\s{2,}\S/.test(lines[j]))
          )
            recordLoss(lost, headerRule.id, lines[j++]);
          i = j - 1;
        }
      } else if (entryRule) {
        incrementCount(counts, entryRule.id);
        recordLoss(lost, entryRule.id, line);
      } else if (keepTables && TABLE_ROW_PATTERN.test(line)) {
        keptLines.push(line);
      } else {
        const kept = dropSentences(line, compiled.sentence || [], counts, lost);
        if (kept !== null) keptLines.push(kept);
      }
    }
  }
  return keptLines.join('\n');
}

/** Rules that rewrite matches, over the whole text. Fenced code is included: a leaked name is a leak anywhere. */
function applyTextRules(text, compiled, counts, lost, phases) {
  let result = text;
  for (const phase of phases) {
    for (const rule of compiled[phase] || []) {
      result = result.replace(rule.regex, (...args) => {
        incrementCount(counts, rule.id);
        const group = args.slice(1, -2)[0];
        switch (rule.action) {
          case 'strip-prefix':
          case 'drop-match':
            recordLoss(lost, rule.id, args[0]);
            return '';
          case 'words':
            return formatSlugAsPlainWords(group);
          case 'neutral-keep-article':
            return group ? `${group}approach` : 'this approach';
          case 'possessive-to-article':
            return !group ? 'the' : /^[A-Z]/.test(group) ? 'The' : 'the'; // keeps the article's capital
          case 'agent-words':
            return formatAgentIdAsWords(group);
          default:
            throw new Error(`unknown sanitizer action ${rule.action}`);
        }
      });
    }
  }
  return result;
}

/** Rule table as plain data, for the provenance hash. */
const buildRuleSpec = (rule) => [
  rule.id,
  rule.phase,
  rule.action,
  rule.flags,
  rule.source,
  Boolean(rule.multiWordOnly),
  // The matcher a rule names is part of the rule: renaming it, or dropping it for a pattern, changes the hash.
  rule.matcher || '',
];

/**
 * A sanitizer for one set of settings. `sanitize(text, { skill })` returns
 *   { text, changes, counts, too_long, chars_in, removed_chars, removed_share, removed_by_rule, sanitizer_version }
 * `skill` is the skill under test (a slug such as "e2e-test-strategy"); without it only the skill-independent rules run.
 * `changes` is the number of rule matches (deleted characters are counted apart, in counts.normalize_chars).
 * `chars_in` is the non-whitespace length of the input after normalizing, `removed_chars` the non-whitespace text the
 * rules deleted (by rule in `removed_by_rule`), `removed_share` their ratio (0 for an empty input). A rewrite keeps its
 * text and is not a removal.
 * `too_long` is true when the input was over MAX_INPUT_CHARS: the text is then '' and nothing was scanned.
 *
 * `spec` is everything here that can change the text for the same input, as data: judge-input.js hashes it with the
 * redactor and the leak scan into the one provenance value. It holds no per-run value.
 */
function createSanitizer(overrides = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...overrides };
  checkSettings(settings);
  const spec = {
    sanitizer_version: SANITIZER_VERSION,
    pipeline: PIPELINE,
    normalize: NORMALIZE_SPEC,
    wrap: WRAP,
    max_input_chars: MAX_INPUT_CHARS,
    bundled_skills: BUNDLED_SKILLS,
    alias_suffix: ALIAS_SUFFIX,
    code_patterns: {
      fence_open: FENCE_OPEN_PATTERN.source,
      fence_close: FENCE_CLOSE_PATTERN.source,
      list_item: LIST_ITEM_PATTERN.source,
      table_row: TABLE_ROW_PATTERN.source,
      sentence_split: SENTENCE_SPLIT_PATTERN.source,
    },
    settings,
    skill_class: SKILL_CLASS_SPEC,
    rules: RULES.map(buildRuleSpec),
  };

  function sanitize(value, { skill = '' } = {}) {
    if (typeof skill !== 'string')
      throw new TypeError('sanitize: skill must be a string (use "" for none)');
    if (value !== null && value !== undefined && typeof value !== 'string')
      throw new TypeError('sanitize: the stored answer must be a string');
    const counts = {};
    const lost = { total: 0, byRule: {} };
    const stamp = { sanitizer_version: SANITIZER_VERSION };
    const emptyTotals = {
      chars_in: 0,
      removed_chars: 0,
      removed_share: 0,
      removed_by_rule: {},
    };
    if (value && value.length > MAX_INPUT_CHARS)
      return {
        text: '',
        changes: 0,
        counts,
        too_long: true,
        ...emptyTotals,
        ...stamp,
      };
    const normalization = normalizeText(value);
    incrementCount(counts, 'normalize_chars', normalization.removed);
    let workingText = normalization.text;
    const charsIn = countNonSpace(workingText);
    // A skill named like a bundled skill was installed under another name. Mapping that name back first lets every rule
    // treat it as the skill's own name, so no rule needs to know about aliases.
    const installedAs = skill ? armSkillName(skill) : '';
    if (installedAs !== skill && installedAs)
      workingText = workingText.replace(
        new RegExp(
          `(?<![A-Za-z0-9_-])${escapeRegExp(installedAs)}(?![A-Za-z0-9_-])`,
          'gi',
        ),
        skill,
      );
    const compiled = compileRules(skill, settings);
    // The follow-up rule also applies after a post drop: a comment on dropped narration goes with it.
    const followUps = (compiled.sentence || []).filter(
      (rule) => rule.action === 'drop-followup',
    );
    for (const step of PIPELINE) {
      if (step.kind === 'text')
        workingText = applyTextRules(
          workingText,
          compiled,
          counts,
          lost,
          step.phases,
        );
      else {
        const rules = step.phases.includes('post')
          ? { sentence: [...(compiled.post || []), ...followUps] }
          : compiled;
        workingText = applyLineRules(workingText, rules, counts, lost, {
          keepTables: step.keepTables,
        });
      }
    }
    const changes = Object.entries(counts).reduce(
      (total, [id, count]) =>
        id === 'normalize_chars' ? total : total + count,
      0,
    );
    const removed = Math.min(lost.total, charsIn);
    return {
      text: workingText,
      changes,
      counts,
      too_long: false,
      chars_in: charsIn,
      removed_chars: removed,
      removed_share: charsIn ? removed / charsIn : 0,
      removed_by_rule: lost.byRule,
      ...stamp,
    };
  }
  return { settings, version: SANITIZER_VERSION, spec, sanitize };
}

const sanitizeAnswer = createSanitizer().sanitize;

module.exports = {
  SANITIZER_VERSION,
  MAX_INPUT_CHARS,
  PHASES,
  PIPELINE,
  DEFAULT_SETTINGS,
  RULES,
  SKILLWORD,
  SKILL_NARRATION,
  WRAP,
  createSanitizer,
  sanitizeAnswer,
  normalizeText,
  wordsOf,
  escapeRegExp,
  agentAlternation,
  fenceMap,
};
