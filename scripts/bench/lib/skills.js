// SPDX-License-Identifier: Apache-2.0
/**
 * Which skills exist and which agent answers for each.
 *
 * An agent declares a skill in `dependencies.skills.skillNames` of its `agents/<name>.agent-spec.json`.
 * Agent for a skill: the agent that declares the skill. When several declare it, `k-developer` if it is one of them,
 * otherwise the first by name. When none does, the skill is skipped as `no agent`.
 *
 * Every spec is read with the shared JSON reader (read-file.js), so a byte order mark is fine and a key used
 * twice is refused. A spec that cannot be used is not skipped, because the plan would then pick another agent or
 * say `no agent` without a word: bad content throws AgentSpecError, which names the file, and a read failure
 * is the system error from `fs` (the driver exits 74).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { readJsonFile, JsonFileError } = require('./read-file');

const PREFERRED_AGENT = 'k-developer';
const SPEC_SUFFIX = '.agent-spec.json';

/** An agent spec whose content cannot be used. `file` is its path; `message` starts with the file name. */
class AgentSpecError extends Error {
  constructor(file, detail) {
    super(`${path.basename(file)}: ${detail}`);
    this.name = 'AgentSpecError';
    this.file = file;
    this.detail = detail;
  }
}

/** Names of the folders under skillsDir that hold a SKILL.md, sorted. */
function listSkills(skillsDir) {
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md')),
    )
    .map((entry) => entry.name)
    .sort();
}

const SKILL_NAMES_PATH = 'dependencies.skills.skillNames';

/** The skill names one agent spec lists, [] when it lists none. Throws AgentSpecError for content that is not a spec. */
function readDeclaredSkills(file) {
  let spec;
  try {
    spec = readJsonFile(file);
  } catch (error) {
    if (!(error instanceof JsonFileError)) throw error;
    throw new AgentSpecError(file, error.detail);
  }
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec))
    throw new AgentSpecError(file, 'must be an object');
  const names = spec.dependencies?.skills?.skillNames;
  if (names === undefined) return [];
  if (!Array.isArray(names) || names.some((name) => typeof name !== 'string'))
    throw new AgentSpecError(
      file,
      `${SKILL_NAMES_PATH}: must be a list of skill names`,
    );
  return names;
}

/**
 * Agent names whose spec lists `skill`, sorted. Throws AgentSpecError for a spec that cannot be used. The specs are
 * read in name order, not in the order the file system lists them, so which broken spec is reported (and so whether
 * the plan is refused or ends as an I/O error) does not depend on the disk.
 */
function declaringAgents(skill, agentsDir) {
  if (!fs.existsSync(agentsDir)) return [];
  return fs
    .readdirSync(agentsDir)
    .filter((fileName) => fileName.endsWith(SPEC_SUFFIX))
    .map((fileName) => fileName.slice(0, -SPEC_SUFFIX.length))
    .sort()
    .filter((agent) =>
      readDeclaredSkills(path.join(agentsDir, agent + SPEC_SUFFIX)).includes(
        skill,
      ),
    );
}

/** @returns {{ agent: string|null, why: string }} `why` says how the agent was chosen, for `plan` to print. */
function resolveAgent(skill, { agentsDir }) {
  const declared = declaringAgents(skill, agentsDir);
  if (!declared.length) return { agent: null, why: 'no agent declares it' };
  if (declared.length === 1)
    return { agent: declared[0], why: 'only declarer' };
  if (declared.includes(PREFERRED_AGENT))
    return {
      agent: PREFERRED_AGENT,
      why: `${declared.length} declare it, ${PREFERRED_AGENT} preferred`,
    };
  return {
    agent: declared[0],
    why: `${declared.length} declare it, first by name`,
  };
}

module.exports = {
  listSkills,
  declaringAgents,
  resolveAgent,
  AgentSpecError,
};
