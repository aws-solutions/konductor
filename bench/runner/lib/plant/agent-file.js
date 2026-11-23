// SPDX-License-Identifier: Apache-2.0
'use strict';

// Writes the plant agent file into a scratch HOME and copies it back out. Never lists a spawn tool or @builtin.

const fs = require('node:fs');
const path = require('node:path');
const { copyPlainFile } = require('../safe-copy.js');

const AGENT_NAME = 'plant';
const SERVER_NAME = 'plant';
const AGENT_REL = path.join('.kiro', 'agents', `${AGENT_NAME}.json`);
// Built-ins by their engine v2 names. `@builtin` would also bring `subagent`, a spawn tool (docs/history/step0-findings.md). Engine v3
// loads the same file: it upgrades it in place to read, write, shell, glob and grep and adds its own `permissions`.
const BUILTIN_TOOLS = Object.freeze(['fs_read', 'fs_write', 'execute_bash', 'glob', 'grep']);
const PROMPTS = {
  'conveyor-sim': 'You operate one conveyor line through the plant tools. Act only through those tools.',
  'arm-sim': 'You operate one robot arm cell through the plant tools. Act only through those tools.',
};

/**
 * The agent definition. `shimPath` is the shim copied into the run's read-only plant dir, `socketPath` the
 * run's gw.sock, `nodeBin` the node binary that runs the shim, `kind` the task's environment kind (default `conveyor-sim`),
 * which picks the one-line prompt.
 */
function plantAgent({ shimPath, socketPath, nodeBin, kind = 'conveyor-sim' }) {
  return {
    name: AGENT_NAME,
    description: 'konductor bench plant operator (simulator only)',
    prompt: plantPrompt(kind),
    tools: [...BUILTIN_TOOLS, `@${SERVER_NAME}`],
    allowedTools: [`@${SERVER_NAME}`],
    mcpServers: { [SERVER_NAME]: { command: nodeBin, args: [shimPath, socketPath], env: {} } },
    resources: [],
    hooks: {},
  };
}

/** Writes `plantAgent(opts)` to `<home>/.kiro/agents/plant.json` (mode 0644) and returns that path. */
function writePlantAgent(home, opts) {
  const file = path.join(home, AGENT_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(plantAgent(opts), null, 2) + '\n', { mode: 0o644, flag: 'wx' });
  return file;
}

/** Copies the agent file from `home` to `<outDir>/installed-agent.json`, refusing a link anywhere on the path. False if absent. */
function copyPlantAgentOut(home, outDir) {
  return copyPlainFile(home, AGENT_REL, path.join(outDir, 'installed-agent.json'));
}

// Claude Code has no agent file for the plant: the shim is its only MCP server, given with --mcp-config, and the
// one-line prompt goes on --append-system-prompt (plugins/claude-code/harness.js buildCommand).
const MCP_CONFIG_REL = path.join('.claude', 'plant-mcp.json');

/** The one-line operator prompt for environment kind `kind` (default `conveyor-sim`). */
const plantPrompt = (kind = 'conveyor-sim') => PROMPTS[kind];

/** The Claude Code MCP config that runs the shim at `shimPath` on `socketPath` with `nodeBin`; nothing else. */
function plantMcpConfig({ shimPath, socketPath, nodeBin }) {
  return { mcpServers: { [SERVER_NAME]: { command: nodeBin, args: [shimPath, socketPath], env: {} } } };
}

/** Writes `plantMcpConfig(opts)` to `<home>/.claude/plant-mcp.json` (mode 0644, never over a file) and returns that path. */
function writePlantMcpConfig(home, opts) {
  const file = path.join(home, MCP_CONFIG_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(plantMcpConfig(opts), null, 2) + '\n', { mode: 0o644, flag: 'wx' });
  return file;
}

module.exports = { plantAgent, writePlantAgent, copyPlantAgentOut, plantPrompt, plantMcpConfig, writePlantMcpConfig, MCP_CONFIG_REL, AGENT_NAME, SERVER_NAME, BUILTIN_TOOLS };
