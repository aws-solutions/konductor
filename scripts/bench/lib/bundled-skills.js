// SPDX-License-Identifier: Apache-2.0
/**
 * Claude Code's own bundled skills, and the name a skill under test is installed under.
 *
 * Both arms deny every bundled skill with `--disallowedTools Skill(<name>)`, so the subject cannot reach for Claude
 * Code's own `code-review` in either arm. Claude Code matches that rule by the skill's name without its plugin prefix,
 * so it also blocks a plugin skill of the same name. A skill under test with a bundled name is therefore installed
 * in the `with` arm under armSkillName(), a name no deny rule matches. The arms use that name for the
 * directory, the `name:` line and the load instruction. The sanitizer maps it back to the real name before it
 * blinds the answer, so a judge sees what it would see for any other skill.
 *
 * The list is the one used in earlier measured runs. It was not re-checked against the current Claude Code release;
 * check it against the real CLI before the deny flags depend on it.
 */
'use strict';

const BUNDLED_SKILLS = Object.freeze([
  'deep-research',
  'dataviz',
  'update-config',
  'verify',
  'debug',
  'code-review',
  'simplify',
  'batch',
  'fewer-permission-prompts',
  'doctor',
  'loop',
  'claude-api',
  'workflow-authoring',
  'run',
  'run-skill-generator',
  'plugin-authoring',
  'keybindings-help',
  'init',
  'security-review',
]);

const ALIAS_SUFFIX = '-under-test';

/** The name the arms install `skill` under: itself, unless a bundled-skill deny rule would block that name. */
const armSkillName = (skill) =>
  BUNDLED_SKILLS.includes(skill) ? `${skill}${ALIAS_SUFFIX}` : skill;

module.exports = { BUNDLED_SKILLS, ALIAS_SUFFIX, armSkillName };
