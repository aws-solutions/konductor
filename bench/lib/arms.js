// SPDX-License-Identifier: Apache-2.0
/**
 * Comparison Arms
 *
 * Builds the two arms of a skill comparison from one in-memory description: an agent
 * configuration and a skill set. The with-skill arm is the description as given. The
 * without-skill arm is the same description minus the target skill, with every reference to that
 * skill scrubbed from the text the subject will read. The module is pure and dependency-free:
 * it reads no files, spawns no processes and makes no network or model calls. Loading a skill
 * set from disk is the caller's job.
 *
 * Why scrubbing matters. A without-skill prompt that still says "use the plan skill" tells the
 * subject which arm it is in, and the subject's answer then tells the grader. Removing the skill
 * from the skill set is not enough, so references are removed from the agent's prompt, its
 * description and the text of every other skill. This layer stops a leak at its source. It
 * cannot catch everything, because a subject may still produce the skill's name from its own
 * knowledge. A second layer, which sanitizes each stored answer before a grader sees it, catches
 * what still gets through. Neither layer replaces the other.
 *
 * Stable API: `buildArms`, `verifyArms`, `ArmsError` and the constants.
 *
 * Input to `buildArms` (every field is required unless marked optional, and unknown fields are
 * rejected so that text this module does not scrub cannot slip through):
 *   {
 *     agent: { name, description, prompt },        // strings; name and prompt are not blank
 *     skills: [{ name, description, text }, ...],  // names are unique lowercase slugs
 *     target: string,                              // the name of the skill under test
 *     loadMode: 'explicit-load' | 'no-instruction',
 *     aliases: string[],                           // optional: other names the target is known by
 *     nameIsCommonWord: boolean,                   // optional: see "Ordinary-word names"
 *   }
 *
 * Output: `{ schema_version, target, aliases, name_is_common_word, load_mode, arms, manifests }`.
 *  - `arms` maps 'with-skill' and 'without-skill' to `{ agent, skills }`, the only part that
 *    reaches a subject.
 *  - `manifests` maps the same two names to a record for a human reviewer. A manifest names the
 *    target and lists the removed lines, so it must never be shown to a grader or a subject.
 *    It holds the load mode, a SHA-256 of the agent prompt, a SHA-256 of the skill set, the skill
 *    names, the lines removed and the ordinary-word lines kept.
 *
 * Rules. Each is enforced before any run could happen: a violation throws `ArmsError`, whose
 * `problems` array lists every fault found. This is a deliberate departure from the
 * never-throw habit of the other validators in this directory, because an arm pair that cannot
 * be trusted must stop the run instead of being passed along with a flag the caller may ignore.
 *  1. The two skill sets differ by exactly the target skill. `verifyArms` re-checks this on any
 *     built result, so a runner can confirm a stored pair before using it.
 *  2. In the without-skill arm no line of the agent prompt, the agent description or any other
 *     skill's description or text refers to the target or one of its aliases.
 *  3. Scrubbing deletes whole lines and is capped at MAX_REMOVED_LINES lines in total. A skill
 *     name that matches ordinary prose would otherwise delete real instructions, so exceeding the
 *     cap is an error. The agent prompt may not be scrubbed down to nothing.
 *  4. Both arms get the same ANSWER_STYLE_INSTRUCTION appended to the prompt, after scrubbing,
 *     so the instruction cannot itself tell the arms apart.
 *  5. The load mode is recorded and never assumed; `loadMode` has no default. 'explicit-load'
 *     appends one sentence to the with-skill prompt only, telling the subject to load the skill
 *     by name. 'no-instruction' adds nothing to either arm, so whether the subject finds and
 *     loads the skill on its own is the thing being measured.
 *
 * Ordinary-word names. A skill called `plan` is also an ordinary English word. A line is scrubbed
 * when it refers to the skill in a way prose does not: "the plan skill", "skill: plan", a code
 * span such as `plan`, a slash command such as /plan, a namespaced form such as acme:plan, or a
 * path such as skills/plan or plan/SKILL.md. A line that only uses the word, as in "make a plan
 * first", is kept and listed under `ambiguous_kept` in the manifest so a reviewer can see what
 * stayed. A name counts as an ordinary word when it is a single run of letters; set
 * `nameIsCommonWord` to override that guess in either direction. A name that is not an ordinary
 * word, such as `triage-kit`, is scrubbed wherever it appears as a whole token.
 *
 * Known limits. Scrubbing works on whole lines, so a line that lists several skill names loses
 * every name on it, not only the target's. It matches the target by name; a paraphrase of what
 * the skill does is not a reference. Both are visible in the manifest.
 */

const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;

const WITH_SKILL = 'with-skill';
const WITHOUT_SKILL = 'without-skill';
const ARM_NAMES = Object.freeze([WITH_SKILL, WITHOUT_SKILL]);

const LOAD_MODES = Object.freeze({ EXPLICIT: 'explicit-load', NONE: 'no-instruction' });

/** Most lines scrubbing may delete across the whole arm before it is an error. */
const MAX_REMOVED_LINES = 5;

/** Appended to the prompt of both arms. It must not name or hint at any particular skill. */
const ANSWER_STYLE_INSTRUCTION =
  'Give the result of the work itself. Do not describe, name or list the tools, skills or loaded instructions you have or used, and do not say how you found or applied them.';

/** Longest piece of input text echoed in a problem string. */
const MAX_ECHO = 60;

const INPUT_FIELDS = ['agent', 'skills', 'target', 'loadMode', 'aliases', 'nameIsCommonWord'];
const AGENT_FIELDS = ['name', 'description', 'prompt'];
const SKILL_FIELDS = ['name', 'description', 'text'];

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const LETTERS_ONLY = /^[A-Za-z]+$/;

const BEFORE = '(?<![\\w-])';
const AFTER = '(?![\\w-])';

class ArmsError extends Error {
  constructor(problems) {
    const shown = problems.slice(0, 3).join('; ');
    super(`the arms are not valid: ${shown}${problems.length > 3 ? `; and ${problems.length - 3} more` : ''}`);
    this.name = 'ArmsError';
    this.problems = problems;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonBlankString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function echo(value) {
  const text = String(value);
  return JSON.stringify(text.length > MAX_ECHO ? `${text.slice(0, MAX_ECHO)}...` : text);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** SHA-256 of a string, as lowercase hex. */
function hashText(text) {
  return sha256(String(text));
}

/**
 * SHA-256 of a skill set. The skills are put in name order first, so the hash does not depend on
 * the order the caller listed them in.
 */
function hashSkillSet(skills) {
  const canonical = [...skills]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((skill) => ({ name: skill.name, description: skill.description, text: skill.text }));
  return sha256(JSON.stringify(canonical));
}

// --- Input validation ------------------------------------------------------------------------

/** Checks that `value` is an object with exactly `fields`, all strings. Returns true when it is. */
function checkRecord(value, label, fields, problems) {
  if (!isObject(value)) {
    problems.push(`${label}: must be an object`);
    return false;
  }
  let ok = true;
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) {
      problems.push(`${label}: unknown field ${echo(key)}`);
      ok = false;
    }
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      problems.push(`${label}.${field}: missing`);
      ok = false;
    } else if (typeof value[field] !== 'string') {
      problems.push(`${label}.${field}: must be a string`);
      ok = false;
    }
  }
  return ok;
}

function checkSkills(skills, problems) {
  if (!Array.isArray(skills)) {
    problems.push('skills: must be an array');
    return [];
  }
  const names = [];
  skills.forEach((skill, index) => {
    const label = `skills[${index}]`;
    if (!checkRecord(skill, label, SKILL_FIELDS, problems)) return;
    if (!SLUG_PATTERN.test(skill.name)) {
      problems.push(`${label}.name: must be a lowercase slug of letters, digits and single hyphens`);
    } else if (names.includes(skill.name)) {
      problems.push(`${label}.name: ${echo(skill.name)} is already used by another skill`);
    } else {
      names.push(skill.name);
    }
  });
  return names;
}

function checkAliases(input, skillNames, problems) {
  if (!Object.hasOwn(input, 'aliases')) return;
  if (!Array.isArray(input.aliases)) {
    problems.push('aliases: must be an array of strings');
    return;
  }
  const seen = new Set();
  input.aliases.forEach((alias, index) => {
    const label = `aliases[${index}]`;
    if (typeof alias !== 'string' || !ALIAS_PATTERN.test(alias)) {
      problems.push(`${label}: must be a name of letters, digits and . _ : - characters, at most 64 long`);
    } else if (alias === input.target) {
      problems.push(`${label}: repeats the target name`);
    } else if (skillNames.includes(alias)) {
      problems.push(`${label}: ${echo(alias)} is the name of another skill, so scrubbing it would remove that skill's references`);
    } else if (seen.has(alias)) {
      problems.push(`${label}: duplicate alias ${echo(alias)}`);
    } else {
      seen.add(alias);
    }
  });
}

function collectInputProblems(input) {
  if (!isObject(input)) return ['input: must be an object'];
  const problems = [];
  for (const key of Object.keys(input)) {
    if (!INPUT_FIELDS.includes(key)) problems.push(`unknown field ${echo(key)}`);
  }

  if (checkRecord(input.agent, 'agent', AGENT_FIELDS, problems)) {
    if (!isNonBlankString(input.agent.name)) problems.push('agent.name: must not be blank');
    if (!isNonBlankString(input.agent.prompt)) problems.push('agent.prompt: must not be blank');
  }

  const skillNames = checkSkills(input.skills, problems);

  if (typeof input.target !== 'string' || !SLUG_PATTERN.test(input.target)) {
    problems.push('target: must be a lowercase slug naming one of the skills');
  } else if (!skillNames.includes(input.target)) {
    problems.push(`target: no skill is named ${echo(input.target)}`);
  }

  const modes = Object.values(LOAD_MODES);
  if (!modes.includes(input.loadMode)) {
    problems.push(`loadMode: must be one of ${modes.join(', ')}; there is no default`);
  }

  checkAliases(input, skillNames, problems);

  if (Object.hasOwn(input, 'nameIsCommonWord') && typeof input.nameIsCommonWord !== 'boolean') {
    problems.push('nameIsCommonWord: must be true or false');
  }
  return problems;
}

// --- Reference matching ----------------------------------------------------------------------

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The ways a skill is named that ordinary prose does not use. `n` is the escaped name. The
 * namespace prefix is capped at 64 characters so a long run of letters cannot make a scan slow.
 */
function contextualSources(n) {
  return [
    `${BEFORE}skills?[ \\t]*[:=]?[ \\t]*[\`"'(]?${n}${AFTER}`,
    `${BEFORE}${n}[\`"']?[ \\t]+skills?${AFTER}`,
    `skills\\/${n}${AFTER}`,
    `${BEFORE}${n}\\/SKILL\\.md`,
    `\`\\/?${n}\``,
    `(?<![\\w/])\\/${n}${AFTER}`,
    `[A-Za-z0-9_.-]{1,64}:${n}${AFTER}`,
  ];
}

/**
 * Builds a matcher for the target and its aliases. `strong` matches a line that refers to the
 * skill. `bare` matches the plain word of an ordinary-word name, which prose also uses.
 */
function buildMatcher(names, nameIsCommonWord) {
  const strong = [];
  const bare = [];
  for (const name of names) {
    const n = escapeRegExp(name);
    const common = typeof nameIsCommonWord === 'boolean' ? nameIsCommonWord : LETTERS_ONLY.test(name);
    strong.push(...contextualSources(n));
    (common ? bare : strong).push(`${BEFORE}${n}${AFTER}`);
  }
  return {
    strong: new RegExp(strong.join('|'), 'i'),
    bare: bare.length > 0 ? new RegExp(bare.join('|'), 'i') : null,
  };
}

/** 'reference' when the line names the skill, 'ambiguous' when it only uses the plain word. */
function classifyLine(line, matcher) {
  if (matcher.strong.test(line)) return 'reference';
  if (matcher.bare !== null && matcher.bare.test(line)) return 'ambiguous';
  return null;
}

function lineRecord(source, index, line) {
  return { source, line: index + 1, text: line.replace(/\r$/, '') };
}

/** Deletes every line of `text` that refers to the skill, recording what was removed or kept. */
function scrubText(text, source, matcher, found) {
  const kept = [];
  text.split('\n').forEach((line, index) => {
    const verdict = classifyLine(line, matcher);
    if (verdict === 'reference') {
      found.removed.push(lineRecord(source, index, line));
      return;
    }
    if (verdict === 'ambiguous') found.ambiguous.push(lineRecord(source, index, line));
    kept.push(line);
  });
  return kept.join('\n');
}

// --- Building the arms -----------------------------------------------------------------------

function loadInstruction(target) {
  return `Before you begin, load the skill named "${target}" and follow it.`;
}

function composePrompt(base, withLoadInstruction, target) {
  const parts = [base.replace(/\s+$/, '')];
  if (withLoadInstruction) parts.push(loadInstruction(target));
  parts.push(ANSWER_STYLE_INSTRUCTION);
  return parts.join('\n\n');
}

function copySkill(skill) {
  return { name: skill.name, description: skill.description, text: skill.text };
}

function sortedNames(skills) {
  return skills.map((skill) => skill.name).sort();
}

function manifestFor(arm, base, agent, skills, found) {
  return {
    schema_version: SCHEMA_VERSION,
    arm,
    load_mode: base.load_mode,
    target: base.target,
    agent_prompt_sha256: hashText(agent.prompt),
    skill_set_sha256: hashSkillSet(skills),
    skill_names: sortedNames(skills),
    removed_lines: found.removed,
    ambiguous_kept: found.ambiguous,
  };
}

function scrubbedWithoutArm(input, matcher) {
  const found = { removed: [], ambiguous: [] };
  const problems = [];
  if (matcher.strong.test(input.agent.name)) {
    problems.push('agent.name: refers to the target skill, and a name cannot be scrubbed');
  }
  const description = scrubText(input.agent.description, 'agent.description', matcher, found);
  const prompt = scrubText(input.agent.prompt, 'agent.prompt', matcher, found);
  const skills = input.skills
    .filter((skill) => skill.name !== input.target)
    .map((skill) => ({
      name: skill.name,
      description: scrubText(skill.description, `skill:${skill.name}.description`, matcher, found),
      text: scrubText(skill.text, `skill:${skill.name}.text`, matcher, found),
    }));

  if (found.removed.length > MAX_REMOVED_LINES) {
    const first = found.removed[0];
    problems.push(
      `scrubbing would delete ${found.removed.length} lines, more than the limit of ${MAX_REMOVED_LINES}; ` +
        `the skill name probably matches ordinary prose (first: ${first.source} line ${first.line} ${echo(first.text)})`,
    );
  }
  if (!isNonBlankString(prompt)) problems.push('agent.prompt: scrubbing left nothing of the prompt');
  if (problems.length > 0) throw new ArmsError(problems);
  return { agent: { name: input.agent.name, description, prompt }, skills, found };
}

function build(input) {
  const problems = collectInputProblems(input);
  if (problems.length > 0) throw new ArmsError(problems);

  const aliases = Object.hasOwn(input, 'aliases') ? [...input.aliases] : [];
  const nameIsCommonWord = Object.hasOwn(input, 'nameIsCommonWord') ? input.nameIsCommonWord : null;
  const matcher = buildMatcher([input.target, ...aliases], nameIsCommonWord);
  const explicit = input.loadMode === LOAD_MODES.EXPLICIT;

  const withSkills = input.skills.map(copySkill);
  const withAgent = {
    name: input.agent.name,
    description: input.agent.description,
    prompt: composePrompt(input.agent.prompt, explicit, input.target),
  };

  const scrubbed = scrubbedWithoutArm(input, matcher);
  const withoutAgent = {
    name: scrubbed.agent.name,
    description: scrubbed.agent.description,
    prompt: composePrompt(scrubbed.agent.prompt, false, input.target),
  };

  const base = { target: input.target, load_mode: input.loadMode };
  const built = {
    schema_version: SCHEMA_VERSION,
    target: input.target,
    aliases,
    name_is_common_word: nameIsCommonWord,
    load_mode: input.loadMode,
    arms: {
      [WITH_SKILL]: { agent: withAgent, skills: withSkills },
      [WITHOUT_SKILL]: { agent: withoutAgent, skills: scrubbed.skills },
    },
    manifests: {
      [WITH_SKILL]: manifestFor(WITH_SKILL, base, withAgent, withSkills, { removed: [], ambiguous: [] }),
      [WITHOUT_SKILL]: manifestFor(WITHOUT_SKILL, base, withoutAgent, scrubbed.skills, scrubbed.found),
    },
  };

  const faults = verifyArms(built);
  if (faults.length > 0) throw new ArmsError(faults);
  return built;
}

/**
 * Builds the with-skill and without-skill arms from `input` (see the module header). Throws
 * `ArmsError` when the input is invalid or a rule cannot be met.
 */
function buildArms(input) {
  try {
    return build(input);
  } catch (error) {
    if (error instanceof ArmsError) throw error;
    // A pre-parsed object can carry a getter that throws.
    throw new ArmsError(['input: could not be inspected because reading a property threw']);
  }
}

// --- Verifying a built pair ------------------------------------------------------------------

function validArm(arm) {
  return (
    isObject(arm) &&
    isObject(arm.agent) &&
    AGENT_FIELDS.every((field) => typeof arm.agent[field] === 'string') &&
    Array.isArray(arm.skills) &&
    arm.skills.every((skill) => isObject(skill) && SKILL_FIELDS.every((field) => typeof skill[field] === 'string'))
  );
}

function checkSkillSets(built, problems) {
  const withNames = sortedNames(built.arms[WITH_SKILL].skills);
  const withoutNames = sortedNames(built.arms[WITHOUT_SKILL].skills);
  const expected = withNames.filter((name) => name !== built.target);
  const sameLength = withoutNames.length === expected.length;
  if (!withNames.includes(built.target)) problems.push('the with-skill arm does not hold the target skill');
  if (withoutNames.includes(built.target)) problems.push('the without-skill arm still holds the target skill');
  if (new Set(withNames).size !== withNames.length || new Set(withoutNames).size !== withoutNames.length) {
    problems.push('an arm lists the same skill name twice');
  }
  if (!sameLength || withoutNames.some((name, index) => name !== expected[index])) {
    problems.push('the skill sets differ by more than the target skill');
  }
}

function checkPrompts(built, problems) {
  const withPrompt = built.arms[WITH_SKILL].agent.prompt;
  const withoutPrompt = built.arms[WITHOUT_SKILL].agent.prompt;
  const style = `\n\n${ANSWER_STYLE_INSTRUCTION}`;
  if (!withPrompt.endsWith(style) || !withoutPrompt.endsWith(style)) {
    problems.push('both prompts must end with the identical answer-style instruction');
  }
  const instruction = loadInstruction(built.target);
  const explicit = built.load_mode === LOAD_MODES.EXPLICIT;
  if (withPrompt.includes(instruction) !== explicit) {
    problems.push(
      explicit
        ? 'the with-skill prompt lacks the load instruction that the explicit-load mode requires'
        : 'the with-skill prompt holds a load instruction that this load mode does not allow',
    );
  }
  if (withoutPrompt.includes(instruction)) problems.push('the without-skill prompt holds a load instruction');
}

function checkWithoutArmClean(built, problems) {
  const matcher = buildMatcher([built.target, ...built.aliases], built.name_is_common_word);
  const arm = built.arms[WITHOUT_SKILL];
  const style = `\n\n${ANSWER_STYLE_INSTRUCTION}`;
  const prompt = arm.agent.prompt.endsWith(style) ? arm.agent.prompt.slice(0, -style.length) : arm.agent.prompt;
  const texts = [
    ['agent.name', arm.agent.name],
    ['agent.description', arm.agent.description],
    ['agent.prompt', prompt],
  ];
  for (const skill of arm.skills) {
    texts.push([`skill:${skill.name}.name`, skill.name]);
    texts.push([`skill:${skill.name}.description`, skill.description]);
    texts.push([`skill:${skill.name}.text`, skill.text]);
  }
  for (const [source, text] of texts) {
    if (text.split('\n').some((line) => matcher.strong.test(line))) {
      problems.push(`${source} of the without-skill arm still refers to the target skill`);
    }
  }
}

function checkManifests(built, problems) {
  for (const armName of ARM_NAMES) {
    const manifest = built.manifests[armName];
    const arm = built.arms[armName];
    if (!isObject(manifest)) {
      problems.push(`${armName}: manifest is missing`);
      continue;
    }
    if (manifest.arm !== armName) problems.push(`${armName}: manifest names a different arm`);
    if (manifest.load_mode !== built.load_mode) problems.push(`${armName}: manifest records a different load mode`);
    if (manifest.agent_prompt_sha256 !== hashText(arm.agent.prompt)) {
      problems.push(`${armName}: manifest prompt hash does not match the prompt`);
    }
    if (manifest.skill_set_sha256 !== hashSkillSet(arm.skills)) {
      problems.push(`${armName}: manifest skill-set hash does not match the skills`);
    }
  }
}

function collectVerifyProblems(built) {
  if (!isObject(built) || !isObject(built.arms) || !isObject(built.manifests)) {
    return ['arms: must be the object returned by buildArms'];
  }
  if (typeof built.target !== 'string' || !Array.isArray(built.aliases)) return ['arms: target or aliases missing'];
  if (!Object.values(LOAD_MODES).includes(built.load_mode)) {
    return [`arms: load_mode must be one of ${Object.values(LOAD_MODES).join(', ')}`];
  }
  if (!ARM_NAMES.every((armName) => validArm(built.arms[armName]))) {
    return ['arms: each arm needs an agent and a skill list'];
  }
  const problems = [];
  checkSkillSets(built, problems);
  checkPrompts(built, problems);
  checkWithoutArmClean(built, problems);
  checkManifests(built, problems);
  return problems;
}

/**
 * Re-checks a built pair against the rules in the module header: the skill sets differ by exactly
 * the target, the without-skill arm holds no reference to it, both prompts end with the same
 * answer-style instruction, the load instruction matches the recorded mode, and each manifest
 * matches its arm. Returns an array of problem strings, empty when the pair is sound. Never throws.
 */
function verifyArms(built) {
  try {
    return collectVerifyProblems(built);
  } catch {
    return ['arms: could not be inspected because reading a property threw'];
  }
}

module.exports = {
  SCHEMA_VERSION,
  WITH_SKILL,
  WITHOUT_SKILL,
  ARM_NAMES,
  LOAD_MODES,
  MAX_REMOVED_LINES,
  ANSWER_STYLE_INSTRUCTION,
  ArmsError,
  buildArms,
  verifyArms,
  hashText,
  hashSkillSet,
};
