// SPDX-License-Identifier: Apache-2.0
/**
 * Builds the `with` and `without` arms for one skill, as Claude Code plugin directories under a fresh private
 * folder (mode 0700) in the system temp folder. The skills, agents and control skills folders are only read,
 * never changed.
 *
 * Both arms contain the same agent definition (its system prompt, passed to Claude Code with `--agents`) and the
 * same skills: every skill that agent declares, minus (in the `without` arm only) the one skill under test. The
 * caller names the agent (skills.js resolveAgent picks it, and `plan` prints the choice).
 *
 * Prompt differences between the arms (everything else is identical):
 *   - the `with` arm may get the explicit load instruction (loadInstruction);
 *   - the `without` arm's agent prompt and description have every line that refers to the skill under test removed
 *     (stripSkillReferences), because the skill is absent there and a prompt that lists it would tell the model,
 *     and through its answer the judges, which arm it is in;
 *   - both arms get the identical ANSWER_STYLE_RULE, which tells the model not to describe tools, skills or
 *     instructions.
 * This is the upstream half of blinding. The text sanitizer (sanitize.js) is the downstream half and cannot
 * replace it.
 *
 * The skill under test is installed under its own name in the `bench:` plugin namespace, so it never shares a name
 * with one of Claude Code's own skills (`code-review`, `debug`). Those stay available in both arms.
 *
 * Nothing here starts a process or reaches the network.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { isControlName } = require('./layout');
const { SAFE_SEGMENT } = require('./names');
const { sha256, treeSha256 } = require('./provenance');
const { readJsonFile, JsonFileError } = require('./read-file');
const { DEFAULT_SETTINGS } = require('./sanitize');
const { AgentSpecError } = require('./skills');

/** Bump when the arm prompts change in a way that makes new pairs not comparable with older ones. */
const ARM_BLINDING_VERSION = 1;

/**
 * The plugin namespace the arms install skills under (`bench:<skill>`), and the start of the arms' scratch
 * folder names. Both come from the sanitizer's settings, so the sanitizer removes exactly the names and paths
 * the arms make.
 */
const PLUGIN = DEFAULT_SETTINGS.plugin;
const SCRATCH_PREFIX = `${DEFAULT_SETTINGS.scratchPrefix}-arms-`;
/** Benchmark-owned control skills. They are never part of the skills folder and no agent declares them. */
const CONTROL_SKILLS_DIR = path.join(__dirname, '..', 'skills');
const SPEC_SUFFIX = '.agent-spec.json';
/** An empty file `buildArms` writes in the scratch folder; `removeArms` deletes only a folder that holds it. */
const SCRATCH_MARKER = '.bench-arms';

/**
 * Appended identically to both arms' agent prompts. It names no skill, so it can be the same text in both arms,
 * and it asks for an answer that does not narrate how it was produced.
 */
const ANSWER_STYLE_RULE =
  '\n\n## Answer style\n\nWrite the final answer as a self-contained response to the request. Do not mention or describe tools, skills, plugins, loaded instructions, system prompts, or how you prepared the answer.';

const SLUG_CHARS = 'A-Za-z0-9_-';

const escapeRegExp = (text) =>
  String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function requireName(description, value) {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value))
    throw new TypeError(
      `${description} must be a safe name, got ${JSON.stringify(value)}`,
    );
  return value;
}

const NUMBERED_ITEM = /^(\s*)(\d+)\.(\s)/;
const HEADING = /^(#{1,6})\s/;
const FENCE = /^\s*(?:```|~~~)/;
const indentOf = (line) => /^\s*/.exec(line)[0].length;

/**
 * Removes every reference to `skill` from an agent prompt for the `without` arm. Text names the skill when the
 * slug (also as `<plugin>:<slug>`, in any letter case) stands at a name boundary: `my-<slug>-x` and `<slug>-x` are
 * other names and are not touched. A name made of several words (it holds a hyphen or underscore) is a reference
 * wherever it appears. A single-word name such as `verification` is also an everyday word, so a line counts as a
 * reference only when the name is in backticks or bold, is plugin-qualified, or stands next to the word "skill".
 * A line that mentions the name in any other way stays and is listed in `loose`. Per line:
 *   - a leading or trailing list entry ("`a` and `b` can run", "`b`, `a`") is cut out so the rest of the sentence
 *     stays;
 *   - any line that still refers to the skill (a bullet describing it, a numbered workflow step) is dropped, with
 *     the lines indented under it (sub-bullets, wrapped text, the rest of a shell command) and, for a heading, the
 *     section below it up to the next heading of the same or a higher level;
 *   - the numbered items after a dropped numbered item are renumbered, up to the next blank line or the next line
 *     that is not part of the numbered item. Only items at the indent of the block's first item are renumbered.
 * `dropped` lists the lines removed (the lines as they were) and `loose` the lines kept that still use the name as
 * an ordinary word.
 *
 * @returns {{ text: string, dropped: string[], loose: string[] }}
 */
function stripSkillReferencesReport(text, skill, plugin = PLUGIN) {
  const source = String(text);
  const slug = escapeRegExp(skill);
  const name = `(?<![${SLUG_CHARS}])(?:${escapeRegExp(plugin)}:)?${slug}(?![${SLUG_CHARS}])`;
  const token = `[\`*]*${name}[\`*]*`;
  const mentions = new RegExp(name, 'i');
  const markedOrQualified = new RegExp(
    `[\`*]${name}|${name}[\`*]|(?<![${SLUG_CHARS}])${escapeRegExp(plugin)}:${slug}(?![${SLUG_CHARS}])`,
    'i',
  );
  const nextToSkillWord = new RegExp(
    `\\bskills?\\s+${name}|${name}\\s+skills?\\b`,
    'i',
  );
  const multiWord = /[-_]/.test(skill);
  const refersToSkill = (line) =>
    mentions.test(line) &&
    (multiWord || markedOrQualified.test(line) || nextToSkillWord.test(line));
  const leadingEntry = new RegExp(
    `^(\\s*(?:[-*]\\s+|\\d+\\.\\s+)?)${token}\\s*(?:,\\s*|\\s+(?:and|or)\\s+)`,
    'i',
  );
  const trailingEntry = new RegExp(
    `\\s*(?:,|\\s+and|\\s+or)\\s+${token}(?=\\s*[.,;:)]|\\s|$)`,
    'i',
  );
  const dropped = [];
  const loose = [];
  if (!mentions.test(source)) return { text: source, dropped, loose };
  const kept = [];
  let block = null; // the numbered items being renumbered: { indent, removed }
  let droppedIndent = null; // while set, lines indented deeper than this belong to the line just dropped
  let droppedSection = 0; // while set, the level of the dropped heading whose section is being dropped
  let inFence = false;
  for (const original of source.split('\n')) {
    const indent = indentOf(original);
    const blank = original.trim() === '';
    const isFence = FENCE.test(original);
    const heading = !inFence && !isFence ? HEADING.exec(original) : null;
    if (isFence) inFence = !inFence;
    if (droppedSection) {
      if (heading && heading[1].length <= droppedSection) droppedSection = 0;
      else {
        if (!blank) dropped.push(original);
        continue;
      }
    }
    if (droppedIndent !== null) {
      if (!blank && indent > droppedIndent) {
        dropped.push(original);
        continue;
      }
      droppedIndent = null;
    }
    let line = original;
    if (refersToSkill(line))
      line = line.replace(leadingEntry, '$1').replace(trailingEntry, '');
    const wasNumbered = NUMBERED_ITEM.exec(original);
    if (wasNumbered && (!block || indent < block.indent))
      block = { indent, removed: 0 };
    if (refersToSkill(line)) {
      dropped.push(original);
      if (wasNumbered && indent === block.indent) block.removed++;
      if (heading) droppedSection = heading[1].length;
      else droppedIndent = indent;
      continue;
    }
    if (mentions.test(line)) loose.push(line);
    if (wasNumbered) {
      const numbered = NUMBERED_ITEM.exec(line);
      if (numbered && block.removed && indent === block.indent)
        line = `${numbered[1]}${Number(numbered[2]) - block.removed}.${numbered[3]}${line.slice(numbered[0].length)}`;
    } else if (blank || (block && indent <= block.indent)) block = null;
    kept.push(line);
  }
  return { text: kept.join('\n'), dropped, loose };
}

/** stripSkillReferencesReport without the report: the prompt text for the `without` arm. */
const stripSkillReferences = (text, skill, plugin = PLUGIN) =>
  stripSkillReferencesReport(text, skill, plugin).text;

/**
 * The explicit load instruction, appended to the `with` arm's agent prompt only. It names the skill under test,
 * so it is a harness-level nudge and not a realistic user flow. The `without` arm never gets it (the skill does
 * not exist there).
 */
function loadInstruction(skill, plugin = PLUGIN) {
  return `\n\n## Skill loading (benchmark harness)\n\nBefore you write your answer, you MUST call the Skill tool to load the \`${plugin}:${skill}\` skill, then follow its guidance in your answer. Do this even if the task looks simple.`;
}

/**
 * One agent's declared skills, description and system prompt, from `<agentsDir>/<agent>.agent-spec.json`.
 * Content that cannot be used throws AgentSpecError, which names the file; a read failure is the error from `fs`.
 */
function loadAgentSpec(agentsDir, agent) {
  requireName('agent', agent);
  const file = path.join(agentsDir, agent + SPEC_SUFFIX);
  let spec;
  try {
    spec = readJsonFile(file);
  } catch (error) {
    if (!(error instanceof JsonFileError)) throw error;
    throw new AgentSpecError(file, error.detail);
  }
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec))
    throw new AgentSpecError(file, 'must be an object');
  const skillNames = spec.dependencies?.skills?.skillNames ?? [];
  if (
    !Array.isArray(skillNames) ||
    skillNames.some(
      (skillName) =>
        typeof skillName !== 'string' || !SAFE_SEGMENT.test(skillName),
    )
  )
    throw new AgentSpecError(
      file,
      'dependencies.skills.skillNames: must be a list of skill names',
    );
  if (new Set(skillNames).size !== skillNames.length)
    throw new AgentSpecError(
      file,
      'dependencies.skills.skillNames: lists a skill twice',
    );
  const { description, systemPrompt } = spec.config ?? {};
  if (typeof description !== 'string')
    throw new AgentSpecError(file, 'config.description: must be text');
  if (typeof systemPrompt !== 'string' || !systemPrompt.trim())
    throw new AgentSpecError(file, 'config.systemPrompt: must be text');
  return { skillNames: [...skillNames], description, prompt: systemPrompt };
}

/**
 * True for a control skill: a name layout.js lists as a control (isControlName) with a SKILL.md in the control skills
 * folder. A folder in that folder under any other name is not one, so it can never be installed in place of the skill
 * of the same name.
 */
const isControlSkill = (skill, controlSkillsDir = CONTROL_SKILLS_DIR) =>
  isControlName(skill) &&
  fs.existsSync(path.join(controlSkillsDir, skill, 'SKILL.md'));

/** `dir` when it is a plain folder. A link to a folder is refused: what it points at is not part of the skills. */
function requirePlainFolder(dir) {
  if (!fs.lstatSync(dir).isDirectory())
    throw new Error(
      `${dir}: a skill folder must be a plain folder, not a link`,
    );
  return dir;
}

/** Source folder of a skill: a benchmark-owned control skill if one has that name, else the skills folder. */
function skillSourceDir(
  skill,
  { skillsDir, controlSkillsDir = CONTROL_SKILLS_DIR },
) {
  requireName('skill', skill);
  if (isControlSkill(skill, controlSkillsDir))
    return requirePlainFolder(path.join(controlSkillsDir, skill));
  const dir = path.join(skillsDir, skill);
  if (!fs.existsSync(path.join(dir, 'SKILL.md')))
    throw new Error(`skill ${skill} has no SKILL.md in ${skillsDir}`);
  return requirePlainFolder(dir);
}

/**
 * Copies a skill folder (skillSourceDir has checked that the folder itself is not a link). Only folders and
 * regular files are copied. A symbolic link or any other entry below it is refused, because it could make a file
 * outside the skill (a credential file, say) part of the arm.
 */
function copySkillTree(from, to) {
  fs.mkdirSync(to, { mode: 0o700 });
  for (const name of fs.readdirSync(from).sort()) {
    const fromPath = path.join(from, name);
    const toPath = path.join(to, name);
    const stat = fs.lstatSync(fromPath);
    if (stat.isDirectory()) copySkillTree(fromPath, toPath);
    else if (stat.isFile()) fs.copyFileSync(fromPath, toPath);
    else
      throw new Error(
        `${fromPath}: only plain files and folders can be installed in an arm`,
      );
  }
}

/** Writes one arm's plugin folder `<root>/<armName>` and copies the skills into it, each under its own name. */
function buildArm(root, armName, skillNames, sources) {
  const dir = path.join(root, armName);
  fs.mkdirSync(path.join(dir, '.claude-plugin'), {
    recursive: true,
    mode: 0o700,
  });
  fs.writeFileSync(
    path.join(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: PLUGIN,
      version: '0.0.1',
      description: 'ablation arm',
    }),
  );
  fs.mkdirSync(path.join(dir, 'skills'), { mode: 0o700 });
  for (const skill of skillNames)
    copySkillTree(
      skillSourceDir(skill, sources),
      path.join(dir, 'skills', skill),
    );
  return dir;
}

/** What makes one arm: its agent definition and plugin tree, as hashes. No path, so it is the same on any machine. */
const armManifest = (arm, agent, dir, agentsJsonText) => ({
  arm,
  agent,
  agents_json_sha256: sha256(agentsJsonText),
  plugin_tree_sha256: treeSha256(dir),
});

/**
 * Throws unless the two arms differ only by the skill under test: `target` is in the `with` arm, and the
 * `without` arm holds every other skill and nothing else, each with the same files (names, bytes, execute bits).
 */
function assertOnlyTargetDiffers(withDir, withoutDir, target) {
  const skillNames = (dir) => fs.readdirSync(path.join(dir, 'skills')).sort();
  const inWith = skillNames(withDir);
  const inWithout = skillNames(withoutDir);
  const shared = inWith.filter((skill) => skill !== target);
  if (!inWith.includes(target) || shared.join('\n') !== inWithout.join('\n'))
    throw new Error(
      `arm construction check failed: with has ${JSON.stringify(inWith)}, without has ${JSON.stringify(inWithout)}, the target is ${target}`,
    );
  for (const skill of shared)
    if (
      treeSha256(path.join(withDir, 'skills', skill)) !==
      treeSha256(path.join(withoutDir, 'skills', skill))
    )
      throw new Error(
        `arm construction check failed: ${skill} differs between the arms`,
      );
}

/**
 * Builds both arms for `targetSkill` and returns:
 *   root               the private scratch folder that holds both arms (remove it with removeArms)
 *   withDir, withoutDir  the two plugin folders, passed to Claude Code with `--plugin-dir`
 *   skillNames, withoutNames  the skills installed in each arm (by their own names)
 *   agentsJson         { with, without }: the `--agents` JSON text of each arm. `without` has no reference to
 *                      the target skill in its prompt or description and its prompt ends with ANSWER_STYLE_RULE.
 *                      `with` is the original prompt plus the same ANSWER_STYLE_RULE, plus (only with
 *                      { explicitInstruction: true }) the load instruction last.
 *   manifests          { with, without }: armManifest of each arm
 *   stripped           { description, prompt }: what stripSkillReferencesReport removed (`dropped`) and which
 *                      lines still mention the name as an ordinary word (`loose`), for the `without` arm
 *   agent, plugin, explicitInstruction
 *
 * Options: `skillsDir` and `agentsDir` (layout.js createLayout gives both), `agent` (required), `controlSkillsDir`
 * (the benchmark's own control skills), `tmpRoot` (where the scratch folder goes, the system temp folder by
 * default; a relative path is made absolute). A control skill that the agent does not declare is added to the
 * `with` arm. The checks that need no copied file run before the scratch folder is made. The copy and
 * assertOnlyTargetDiffers run after it, and a failure in either removes the folder.
 */
function buildArms(
  targetSkill,
  {
    skillsDir,
    agentsDir,
    agent,
    controlSkillsDir = CONTROL_SKILLS_DIR,
    explicitInstruction = false,
    tmpRoot = os.tmpdir(),
  } = {},
) {
  requireName('skill', targetSkill);
  requireName('agent', agent);
  if (typeof skillsDir !== 'string' || typeof agentsDir !== 'string')
    throw new TypeError('buildArms needs skillsDir and agentsDir');
  if (typeof explicitInstruction !== 'boolean')
    throw new TypeError('explicitInstruction must be true or false');
  const spec = loadAgentSpec(agentsDir, agent);
  let { skillNames } = spec;
  if (!skillNames.includes(targetSkill)) {
    if (!isControlSkill(targetSkill, controlSkillsDir))
      throw new Error(
        `${targetSkill} is not declared by ${agent}; cannot build its arms`,
      );
    skillNames = [...skillNames, targetSkill];
  }
  const sources = { skillsDir, controlSkillsDir };
  for (const skill of skillNames) skillSourceDir(skill, sources);
  const withoutNames = skillNames.filter((skill) => skill !== targetSkill);
  const strippedDescription = stripSkillReferencesReport(
    spec.description,
    targetSkill,
  );
  const strippedPrompt = stripSkillReferencesReport(spec.prompt, targetSkill);
  const withoutDescription = strippedDescription.text;
  const withoutPrompt = strippedPrompt.text + ANSWER_STYLE_RULE;
  const agentsJson = {
    with: JSON.stringify({
      [agent]: {
        description: spec.description,
        prompt:
          spec.prompt +
          ANSWER_STYLE_RULE +
          (explicitInstruction ? loadInstruction(targetSkill) : ''),
      },
    }),
    without: JSON.stringify({
      [agent]: { description: withoutDescription, prompt: withoutPrompt },
    }),
  };

  const root = fs.mkdtempSync(
    path.join(path.resolve(tmpRoot), `${SCRATCH_PREFIX}${targetSkill}-`),
  );
  try {
    fs.writeFileSync(path.join(root, SCRATCH_MARKER), '');
    const withDir = buildArm(root, 'with', skillNames, sources);
    const withoutDir = buildArm(root, 'without', withoutNames, sources);
    assertOnlyTargetDiffers(withDir, withoutDir, targetSkill);
    return {
      root,
      withDir,
      withoutDir,
      skillNames,
      withoutNames,
      agentsJson,
      manifests: {
        with: armManifest('with', agent, withDir, agentsJson.with),
        without: armManifest('without', agent, withoutDir, agentsJson.without),
      },
      stripped: {
        description: {
          dropped: strippedDescription.dropped,
          loose: strippedDescription.loose,
        },
        prompt: {
          dropped: strippedPrompt.dropped,
          loose: strippedPrompt.loose,
        },
      },
      agent,
      plugin: PLUGIN,
      explicitInstruction,
    };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

/** True when `root` holds the marker file `buildArms` writes. */
function hasMarker(root) {
  try {
    return fs.lstatSync(path.join(root, SCRATCH_MARKER)).isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Removes the scratch folder of a buildArms result. Refuses any folder that is not an absolute path named like an
 * arms scratch folder and holding the marker file buildArms writes. A folder that is already gone is not an error.
 */
function removeArms(arms) {
  const root = arms && arms.root;
  const refuse = () =>
    new Error(`not an arms scratch folder: ${JSON.stringify(root ?? null)}`);
  if (
    typeof root !== 'string' ||
    !path.isAbsolute(root) ||
    !path.basename(root).startsWith(SCRATCH_PREFIX)
  )
    throw refuse();
  let stat;
  try {
    stat = fs.lstatSync(root);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!stat.isDirectory() || !hasMarker(root)) throw refuse();
  fs.rmSync(root, { recursive: true, force: true });
}

module.exports = {
  ARM_BLINDING_VERSION,
  ANSWER_STYLE_RULE,
  PLUGIN,
  SCRATCH_PREFIX,
  CONTROL_SKILLS_DIR,
  stripSkillReferences,
  stripSkillReferencesReport,
  assertOnlyTargetDiffers,
  loadInstruction,
  loadAgentSpec,
  isControlSkill,
  skillSourceDir,
  buildArms,
  removeArms,
};
