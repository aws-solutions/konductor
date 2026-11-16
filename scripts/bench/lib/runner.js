// SPDX-License-Identifier: Apache-2.0
/**
 * Runner profiles: how the `with` arm is told about the skill, and which tools both arms get. This module also
 * builds the Claude Code command-line flags of one subject run. It starts no process; the launch is the subject
 * runner's job.
 *
 * Why a profile is recorded with every answer: an answer depends on the load mode and the tool grant as much as
 * on its prompt, so answers made under two profiles must never be compared or reused across. forSkill returns
 * `profileSha256`, a digest of everything in the profile that changes what a run does, and the answer records
 * it. An answer whose digest differs from today's is stale.
 *
 * A profile has these fields:
 *   loadMode         "explicit"  the `with` arm's agent prompt ends with the load instruction (arms.js loadInstruction)
 *                    "natural"   no load instruction in either arm; the skill is installed in the `with` arm only.
 *                                Whether the agent loads it is then part of what is measured.
 *   loadModeBySkill  per-skill override of loadMode (a control skill can stay explicit in a natural run)
 *   tools            { default: [...], bySkill: { skill: [...] } }  --tools: the tools that exist, the same in
 *                    both arms. Skill must be one of them.
 *   allowedTools     { default: [...], bySkill: {...} }  --allowedTools rules: calls that run without a prompt.
 *                    With any grant beyond Skill alone, everything else that would need approval is denied
 *                    (permission mode dontAsk).
 *   maxBudgetUsd     USD cap of one subject run (claude --max-budget-usd): above 0, at most MAX_BUDGET_USD_LIMIT and
 *                    written in plain decimal notation; DEFAULT_MAX_BUDGET_USD when absent. The subject runner reserves
 *                    the larger of this cap and the call's p90 in the spend ledger (claude-run.js subjectRun), so a run
 *                    that reaches its cap is covered by its reservation. A run that Claude Code reports above the
 *                    cap is still charged in full.
 *   extends          name of another profile whose fields this one starts from (one level only)
 *   id               the profile's name, a safe name; profile() sets it from the table key
 *
 * MCP tools are never granted: the flags keep --strict-mcp-config and pass no MCP config, and `mcp` names are
 * refused here. A Bash grant needs a Bash(...) rule that names a command: bare Bash and a rule made only of
 * wildcards (such as Bash(*)) are refused, whatever the case of the tool name.
 *
 * Only two profiles ship, both with `Skill` as the only tool: `legacy` (explicit load instruction, the default)
 * and `natural` (no load instruction). A profile that grants file tools needs the isolation test against the
 * real CLI to pass first, so none ships.
 */
'use strict';

const path = require('path');

const { SAFE_SEGMENT } = require('./names');
const { sha256 } = require('./provenance');
const { subjectSettings } = require('./subject-isolation');

/** Bump when the shape of the flags or the isolation settings changes what a run does. Part of profileSha256. */
const RUNNER_VERSION = 2;
const DEFAULT_PROFILE = 'legacy';
/** The per-run budget cap when a profile sets none, in USD. */
const DEFAULT_MAX_BUDGET_USD = 0.75;
/** The most a profile may set as its per-run budget cap, in USD. */
const MAX_BUDGET_USD_LIMIT = 10;
// The cap is passed as text, so it must print without an exponent (String(1e21) is "1e+21").
const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/;
// Placeholder paths for the isolation settings that go into the digest: the digest covers the deny rules, not
// this machine's folders, so the same profile has the same digest on every machine.
const DIGEST_USER_HOME = '/user-home';
const DIGEST_REPO_ROOT = '/repo';

const PROFILES = Object.freeze({
  legacy: Object.freeze({
    loadMode: 'explicit',
    tools: Object.freeze({ default: Object.freeze(['Skill']) }),
  }),
  natural: Object.freeze({
    extends: 'legacy',
    loadMode: 'natural',
  }),
});

const TOOL_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const RULE = /^([A-Za-z][A-Za-z0-9]*)(\(.+\))?$/;
const LOAD_MODES = Object.freeze(['explicit', 'natural']);
const PROFILE_FIELDS = new Set([
  'loadMode',
  'loadModeBySkill',
  'tools',
  'allowedTools',
  'maxBudgetUsd',
  'extends',
]);
const DEFAULT_KEY = '__default__';

const isBash = (tool) => tool.toLowerCase() === 'bash';
/** True for a Bash(...) rule whose specifier is more than wildcards, colons and spaces, so it names a command. */
const namesACommand = (rule) => {
  const match = RULE.exec(rule);
  return Boolean(
    match &&
    isBash(match[1]) &&
    match[2] &&
    /[^\s*:?]/.test(match[2].slice(1, -1)),
  );
};

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const uniqueSorted = (items) => [...new Set(items)].sort();
/** The list for `skill` from a { default, bySkill } table: its own entry, else the default, else empty. */
const listFor = (table, skill) => {
  if (!table) return [];
  if (isPlainObject(table.bySkill) && Object.hasOwn(table.bySkill, skill))
    return table.bySkill[skill];
  return table.default || [];
};

function tableProblems(name, table) {
  const problems = [];
  if (!isPlainObject(table))
    return [`${name} must be an object { default, bySkill }`];
  for (const key of Object.keys(table))
    if (key !== 'default' && key !== 'bySkill')
      problems.push(`${name}.${key}: unknown field`);
  if (table.bySkill !== undefined && !isPlainObject(table.bySkill))
    problems.push(`${name}.bySkill must be an object of skill to list`);
  const lists = [
    ['default', table.default === undefined ? [] : table.default],
    ...Object.entries(isPlainObject(table.bySkill) ? table.bySkill : {}),
  ];
  for (const [where, list] of lists) {
    if (where !== 'default' && !SAFE_SEGMENT.test(where))
      problems.push(
        `${name}.bySkill: ${JSON.stringify(where)} is not a skill name`,
      );
    if (!Array.isArray(list) || list.some((item) => typeof item !== 'string'))
      problems.push(`${name}.${where} must be a list of strings`);
  }
  return problems;
}

/**
 * Problems with a profile spec; empty when it is usable. A grant can never widen what `tools` allows and never
 * names an MCP tool. Bash is usable only with a Bash(...) rule that names a command, so a rule that allows every
 * command (Bash(*)) is refused like bare Bash.
 */
function specProblems(spec) {
  if (!isPlainObject(spec)) return ['runner spec must be an object'];
  const problems = [];
  for (const key of Object.keys(spec))
    if (!PROFILE_FIELDS.has(key) && key !== 'id')
      problems.push(`${key}: unknown runner field`);
  if (
    spec.id !== undefined &&
    !(typeof spec.id === 'string' && SAFE_SEGMENT.test(spec.id))
  )
    problems.push('id must be a safe name');
  if (!LOAD_MODES.includes(spec.loadMode))
    problems.push(`loadMode must be one of ${LOAD_MODES.join(', ')}`);
  if (spec.loadModeBySkill !== undefined) {
    if (!isPlainObject(spec.loadModeBySkill))
      problems.push('loadModeBySkill must be an object of skill to load mode');
    else
      for (const [skill, mode] of Object.entries(spec.loadModeBySkill))
        if (!LOAD_MODES.includes(mode))
          problems.push(
            `loadModeBySkill.${skill} must be one of ${LOAD_MODES.join(', ')}`,
          );
  }
  if (
    spec.maxBudgetUsd !== undefined &&
    !(
      typeof spec.maxBudgetUsd === 'number' &&
      spec.maxBudgetUsd > 0 &&
      spec.maxBudgetUsd <= MAX_BUDGET_USD_LIMIT &&
      PLAIN_DECIMAL.test(String(spec.maxBudgetUsd))
    )
  )
    problems.push(
      `maxBudgetUsd must be a positive number of at most ${MAX_BUDGET_USD_LIMIT} USD per subject run, written without an exponent`,
    );
  if (spec.tools === undefined) problems.push('tools is required');
  else problems.push(...tableProblems('tools', spec.tools));
  if (spec.allowedTools !== undefined)
    problems.push(...tableProblems('allowedTools', spec.allowedTools));
  if (problems.length) return problems;

  const skills = new Set([
    DEFAULT_KEY,
    ...Object.keys(spec.tools.bySkill || {}),
    ...Object.keys((spec.allowedTools || {}).bySkill || {}),
  ]);
  for (const skill of skills) {
    const key = skill === DEFAULT_KEY ? 'default' : skill;
    const tools =
      skill === DEFAULT_KEY
        ? spec.tools.default || []
        : listFor(spec.tools, skill);
    const allowed =
      skill === DEFAULT_KEY
        ? (spec.allowedTools || {}).default || []
        : listFor(spec.allowedTools, skill);
    for (const tool of tools) {
      if (!TOOL_NAME.test(tool))
        problems.push(
          `tools.${key}: "${tool}" is not a plain built-in tool name`,
        );
      if (/^mcp/i.test(tool))
        problems.push(`tools.${key}: MCP tools are never granted`);
    }
    if (!tools.includes('Skill'))
      problems.push(
        `tools.${key}: Skill is required, or the skill under test cannot load`,
      );
    for (const rule of allowed) {
      const match = RULE.exec(rule);
      if (!match) {
        problems.push(
          `allowedTools.${key}: "${rule}" is not a tool name or Tool(specifier)`,
        );
        continue;
      }
      if (!tools.includes(match[1]))
        problems.push(
          `allowedTools.${key}: ${rule} names a tool that is not in tools.${key}`,
        );
      if (isBash(match[1]) && !match[2])
        problems.push(
          `allowedTools.${key}: a Bash grant must be a Bash(...) rule, never bare Bash`,
        );
      else if (isBash(match[1]) && !namesACommand(rule))
        problems.push(
          `allowedTools.${key}: ${rule} allows every command; a Bash rule must name a command`,
        );
    }
    if (tools.some(isBash) && !allowed.some(namesACommand))
      problems.push(
        `tools.${key}: Bash is granted but no Bash(...) allow rule names a command`,
      );
  }
  return problems;
}

/** Throws on a bad spec, naming the profile. */
function assertSpec(spec, id = spec && spec.id) {
  const problems = specProblems(spec);
  if (problems.length)
    throw new Error(`runner ${id || '(unnamed)'}: ${problems.join('; ')}`);
  return spec;
}

/** The ids of the shipped profiles, the default first. */
const profileIds = () => [
  DEFAULT_PROFILE,
  ...Object.keys(PROFILES).filter((id) => id !== DEFAULT_PROFILE),
];

/**
 * The named profile as a full spec. `profiles` defaults to the shipped table (a test can pass its own). Throws on
 * an unknown or malformed profile, and on an `extends` chain longer than one level.
 */
function profile(id, profiles = PROFILES) {
  const named = (name) => {
    if (typeof name !== 'string' || !Object.hasOwn(profiles, name))
      throw new Error(
        `unknown runner profile ${JSON.stringify(name)}; known: ${Object.keys(profiles).join(', ') || 'none'}`,
      );
    return profiles[name];
  };
  let raw = named(id);
  if (raw.extends !== undefined) {
    // One level only: a profile that extends a profile that extends another is a config mistake, not a feature.
    const parent = named(raw.extends);
    if (parent.extends !== undefined)
      throw new Error(
        `runner ${id}: ${raw.extends} extends another runner; only one level is supported`,
      );
    const { extends: _parentName, ...own } = raw;
    raw = { ...parent, ...own };
  }
  return assertSpec(
    { loadModeBySkill: {}, allowedTools: { default: [] }, ...raw, id },
    id,
  );
}

/**
 * Everything a stage needs to know about one skill's runs under a profile. `profileOrId` is a profile id or a
 * spec object (checked with assertSpec).
 *
 * Returns { id, loadMode, explicitInstruction, tools, allowedTools, permissionMode, maxBudgetUsd, profileSha256,
 * info }. `info` is what an answer records about its runner. `permissionMode` is null for a grant of Skill
 * alone with no allow rule (the Skill tool needs no approval, so nothing is prompted or bypassed) and `dontAsk`
 * for anything wider or any allow rule.
 */
function forSkill(skill, profileOrId = DEFAULT_PROFILE) {
  if (typeof skill !== 'string' || !SAFE_SEGMENT.test(skill))
    throw new TypeError(
      `skill must be a safe name, got ${JSON.stringify(skill)}`,
    );
  const spec =
    typeof profileOrId === 'string'
      ? profile(profileOrId)
      : assertSpec({ loadModeBySkill: {}, ...profileOrId });
  const loadMode = Object.hasOwn(spec.loadModeBySkill || {}, skill)
    ? spec.loadModeBySkill[skill]
    : spec.loadMode;
  const tools = [...listFor(spec.tools, skill)];
  const allowedTools = [...listFor(spec.allowedTools, skill)];
  const permissionMode =
    tools.length === 1 && tools[0] === 'Skill' && !allowedTools.length
      ? null
      : 'dontAsk';
  const maxBudgetUsd =
    spec.maxBudgetUsd === undefined
      ? DEFAULT_MAX_BUDGET_USD
      : spec.maxBudgetUsd;
  // The profile id is not hashed: two names for the same behavior give answers that can be compared. The isolation
  // deny rules change what a run can reach, so they are part of the digest too.
  const profileSha256 = sha256({
    v: RUNNER_VERSION,
    loadMode,
    tools: uniqueSorted(tools),
    allowedTools: uniqueSorted(allowedTools),
    permissionMode,
    maxBudgetUsd,
    isolation: subjectSettings({
      userHome: DIGEST_USER_HOME,
      repoRoot: DIGEST_REPO_ROOT,
    }),
  });
  const info = {
    id: spec.id || null,
    load_mode: loadMode,
    tools: uniqueSorted(tools),
    allowed_tools: uniqueSorted(allowedTools),
    permission_mode: permissionMode,
    max_budget_usd: maxBudgetUsd,
    profile_sha256: profileSha256,
  };
  return {
    id: spec.id || null,
    loadMode,
    explicitInstruction: loadMode === 'explicit',
    tools,
    allowedTools,
    permissionMode,
    maxBudgetUsd,
    profileSha256,
    info,
  };
}

/** True when the tools Claude Code reports are inside the grant and include Skill. A missing list is not ok. */
function toolsWithinGrant(reported, runner) {
  return (
    Array.isArray(reported) &&
    reported.includes('Skill') &&
    reported.every((tool) => runner.tools.includes(tool))
  );
}

function requireText(description, value) {
  if (typeof value !== 'string' || !value || value.startsWith('-'))
    throw new TypeError(
      `${description} must be a non-empty string that does not start with "-"`,
    );
  return value;
}

/**
 * The Claude Code flags of one subject run, as an argument list (never a shell string). `runner` comes from
 * forSkill and `settings` from subject-isolation.js subjectSettings. The flags:
 *   --tools <grant>                only these tools exist (Skill alone in every shipped profile)
 *   --setting-sources ""           no user, project or local settings file, hook or CLAUDE.md is read
 *   --strict-mcp-config            no MCP server (none is passed)
 *   --no-session-persistence       nothing of the session is kept
 *   --max-budget-usd <n>           the per-run budget cap
 *   --settings <json>              the isolation settings: deny rules for the credential folders and the
 *                                  repository, and file tools kept inside the working directory
 *   --plugin-dir, --agents, --agent  the arm (arms.js)
 * A grant wider than Skill also gets --permission-mode dontAsk and its --allowedTools rules.
 *
 * No flag names a skill: Claude Code's own bundled skills stay available in both arms, so a skill is measured against
 * Claude Code as shipped.
 */
function subjectFlags({
  model,
  pluginDir,
  agentsJson,
  agent,
  runner,
  settings,
} = {}) {
  requireText('model', model);
  if (typeof pluginDir !== 'string' || !path.isAbsolute(pluginDir))
    throw new TypeError('pluginDir must be an absolute path');
  if (typeof agentsJson !== 'string' || !agentsJson)
    throw new TypeError('agentsJson must be the --agents JSON text');
  if (typeof agent !== 'string' || !SAFE_SEGMENT.test(agent))
    throw new TypeError(
      `agent must be a safe name, got ${JSON.stringify(agent)}`,
    );
  if (!runner || !Array.isArray(runner.tools))
    throw new TypeError('runner must come from forSkill');
  if (!isPlainObject(settings))
    throw new TypeError('settings must come from subjectSettings');
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    model,
    '--tools',
    runner.tools.join(','),
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--max-budget-usd',
    String(runner.maxBudgetUsd),
  ];
  if (runner.permissionMode) {
    args.push('--permission-mode', runner.permissionMode);
    if (runner.allowedTools.length)
      args.push('--allowedTools', ...runner.allowedTools);
  }
  args.push('--settings', JSON.stringify(settings));
  args.push(
    '--plugin-dir',
    pluginDir,
    '--agents',
    agentsJson,
    '--agent',
    agent,
  );
  return args;
}

module.exports = {
  RUNNER_VERSION,
  DEFAULT_PROFILE,
  DEFAULT_MAX_BUDGET_USD,
  MAX_BUDGET_USD_LIMIT,
  PROFILES,
  LOAD_MODES,
  specProblems,
  assertSpec,
  profile,
  profileIds,
  forSkill,
  toolsWithinGrant,
  subjectFlags,
};
