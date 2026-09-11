// SPDX-License-Identifier: Apache-2.0
/**
 * Claude Code Agent Runner
 *
 * A custom evaluator that runs benchmark scenarios against Claude Code with a
 * specific public agent (`konductor`/`k-*`) loaded via `--agent`. Uses stream-json output to
 * capture tool executions and response text.
 *
 * Unlike the built-in ClaudeCodeStrategy, this runner passes `--agent <name>`
 * so the agent's system prompt, skills, and MCP servers are active.
 *
 * Notable behavior:
 *
 *  - Agent names are resolved by `resolveAgentName()` from
 *    scripts/brand-config/lib/constants.json, never from a literal prefix —
 *    public agents install flat as `<spec.name>.md` (see
 *    scripts/generate-agent-files.js), so there is no multi-package
 *    install-prefix to reconstruct. `ASDLC_AGENT_PREFIX` is an optional
 *    install-prefix override for forks that install under an extra
 *    namespace; it defaults to empty.
 *  - The MCP-warmup "required server" is not hard-coded to any specific MCP
 *    server name. It defaults to `null`, which SKIPS the
 *    mcpReady/availableToolsCount check entirely -- correct for most
 *    `k-*` agents, which declare no MCP servers at all. Callers that
 *    benchmark an MCP-bearing agent (e.g. `k-developer`'s `aws-mcp`)
 *    can opt in via `context.requiredMcpServer` (wired from
 *    tests/registry.json's optional `requiredMcpServer` field by
 *    scripts/run-claude-subset.js).
 *  - The MCP-warmup duration env var is `ASDLC_BENCH_MCP_WARMUP_MS`.
 *
 * Scoring logic (toolUse / correctness / additional / skillContentUsed),
 * the whole-word negation-aware `matchesExpectedString`, and the
 * warmup-then-write-stdin `runClaudeTurn` sequencing are plain Node + the
 * `claude` CLI's own documented flags, with no external dependency.
 *
 * Usage in registry.json:
 *   "defaultJudge": "claude-code",
 *   "evaluators": ["../judges/claude-code-agent-runner.js"]
 */
const { spawn } = require('child_process');
const { CONSTANTS } = require('../../scripts/brand-config/lib/constants.js');

/** Bounded grace period (ms) between starting the `claude` process and writing
 * the scenario prompt to its stdin, to let MCP servers finish connecting before
 * the turn that gets scored is dispatched. Irrelevant (but harmless) for agents
 * that declare no MCP servers -- the wait just adds latency, not risk. */
const MCP_WARMUP_MS_DEFAULT = 8000;
const MCP_WARMUP_MS_MAX = 30000;

/** Resolves the warmup duration from (in priority order) `context.mcpWarmupMs`,
 * the `ASDLC_BENCH_MCP_WARMUP_MS` env var, or the default -- always clamped to
 * `[0, MCP_WARMUP_MS_MAX]` so a misconfigured value cannot silently balloon a
 * scenario run past the overall timeout budget. */
function resolveMcpWarmupMs(context) {
  const raw =
    context && context.mcpWarmupMs !== undefined ? context.mcpWarmupMs : process.env.ASDLC_BENCH_MCP_WARMUP_MS;
  const parsed = raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
  const ms = Number.isFinite(parsed) && parsed >= 0 ? parsed : MCP_WARMUP_MS_DEFAULT;
  return Math.min(ms, MCP_WARMUP_MS_MAX);
}

/** Finds the `system`/`init` event in a stream-json output and returns it, or
 * null if none is present (e.g. the process errored before init). */
function findInitEvent(streamLines) {
  for (const line of streamLines) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'system' && event.subtype === 'init') return event;
    } catch {
      // Skip non-JSON lines
    }
  }
  return null;
}

/** True/false when the init event's `mcp_servers` array reports `requiredServerName`
 * as connected/not-connected; null when no server name was given at all (the
 * agent declares no MCP dependency worth gating on -- true for most public
 * `k-*` agents) or when no init event (or no matching server entry) was
 * found, so callers can distinguish "not applicable"/"could not check" from
 * "checked and not ready". */
function extractMcpReady(streamLines, requiredServerName = null) {
  if (!requiredServerName) return null;
  const initEvent = findInitEvent(streamLines);
  if (!initEvent) return null;
  const servers = Array.isArray(initEvent.mcp_servers) ? initEvent.mcp_servers : [];
  const match = servers.find((s) => s.name === requiredServerName);
  return match ? match.status === 'connected' : false;
}

/** Best-effort count of tools the model actually had available for the scored
 * turn (from the init event's `tools` array). Null if no init event was found. */
function extractAvailableToolsCount(streamLines) {
  const initEvent = findInitEvent(streamLines);
  return initEvent && Array.isArray(initEvent.tools) ? initEvent.tools.length : null;
}

/**
 * Runs one scenario turn against the `claude` CLI using stream-json for BOTH
 * input and output.
 *
 * Rather than passing the prompt positionally to `-p` (which dispatches the
 * turn immediately at process start, racing any MCP handshake), this starts
 * the process with `--input-format stream-json` and no positional prompt,
 * waits `warmupMs` (a plain, bounded wall-clock grace period), then writes
 * the scenario prompt as a single stream-json user-message line to stdin.
 * With stream-json input the CLI defers emitting/snapshotting the
 * `system`/`init` event until the first stdin message is received, so a
 * sufficient grace period lets the SAME process's own MCP client connections
 * complete before that snapshot -- and before the model's first turn -- is
 * dispatched. For agents with no MCP servers this is simply inert extra
 * latency, not a correctness concern.
 */
function runClaudeTurn({ claudeArgs, prompt, cwd, warmupMs, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', [...claudeArgs, '--input-format', 'stream-json'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const processStart = Date.now();
    let mcpWaitMs = null;

    let warmupTimer = null;

    const overallTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (warmupTimer) clearTimeout(warmupTimer);
      child.kill('SIGKILL');
      const err = new Error(`claude CLI timed out after ${timeoutMs}ms`);
      err.mcpWaitMs = mcpWaitMs ?? Date.now() - processStart;
      reject(err);
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      if (warmupTimer) clearTimeout(warmupTimer);
      err.mcpWaitMs = mcpWaitMs ?? Date.now() - processStart;
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      if (warmupTimer) clearTimeout(warmupTimer);
      const resolvedMcpWaitMs = mcpWaitMs ?? Date.now() - processStart;
      if (code !== 0) {
        const err = new Error(`claude CLI exited with code ${code}: ${stderr.slice(0, 2000)}`);
        err.stdout = stdout;
        err.mcpWaitMs = resolvedMcpWaitMs;
        reject(err);
        return;
      }
      resolve({ stdout, mcpWaitMs: resolvedMcpWaitMs });
    });

    warmupTimer = setTimeout(() => {
      if (settled) return;
      mcpWaitMs = Date.now() - processStart;
      const message = {
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: prompt }] },
      };
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
        child.stdin.end();
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(overallTimer);
          err.mcpWaitMs = mcpWaitMs;
          reject(err);
        }
      }
    }, warmupMs);
  });
}

const AGENT_PREFIX = process.env.ASDLC_AGENT_PREFIX || '';

/**
 * Resolves the `--agent` name to dispatch for a scenario, from whichever of
 * `subsetName` / `datasetPath` / `taskId` the caller supplied.
 *
 * Every name token comes from scripts/brand-config/lib/constants.json (via
 * constants.js) rather than a literal, so a rebrand is a config-only change
 * here as it is at every other call site. Registry subset names ARE agent
 * names post-rename (tests/registry.json's `k-developer` is
 * agents/k-developer.agent-spec.json, installed by
 * scripts/generate-agent-files.js as `k-developer.md`), so the common path is
 * an identity check, not a strip-and-rebuild.
 *
 * A name carrying a RETIRED prefix (`retired_agent_prefixes`, e.g. a
 * pre-rename `asdlc-developer` still sitting in a caller's script or an old
 * results file) is migrated onto the current `agent_prefix` rather than
 * dispatched as-is, since no such agent exists any more. The bare
 * orchestrator and its variants do not carry `agent_prefix` at all and are
 * passed through untouched — the "three-pattern" shape isAgentSpecFilename()
 * exists for.
 *
 * `ASDLC_AGENT_PREFIX` remains an optional INSTALL-prefix override for forks
 * that install agents under an extra namespace; it defaults to empty.
 */
function resolveAgentName({ subsetName, datasetPath, taskId } = {}) {
  const raw = subsetName || (datasetPath ? datasetPath.replace(/\/+$/, '').split('/').pop() : '') || '';
  // Fall back to the leading taskId segment as a bare role (e.g. "developer-git-workflow" -> "developer").
  const stem = raw || (taskId ? taskId.split('-')[0] : '');
  if (!stem) throw new Error('resolveAgentName: need one of subsetName, datasetPath, or taskId');

  let name;
  if (stem === CONSTANTS.orchestrator_agent || CONSTANTS.orchestrator_variants.includes(stem)) {
    name = stem;
  } else if (stem.startsWith(CONSTANTS.agent_prefix)) {
    name = stem;
  } else {
    const retired = (CONSTANTS.retired_agent_prefixes || []).find((p) => stem.startsWith(`${p}-`));
    if (retired) {
      const rest = stem.slice(retired.length + 1);
      // The retired-prefix migration is a uniform swap for persona roles
      // (asdlc-developer -> k-developer), but the orchestrator and its
      // variants were renamed onto entirely different names
      // (orchestrator_agent/orchestrator_variants), not onto
      // `${agent_prefix}${rest}` -- there is no "k-orchestrator" agent.
      const migratedOrchestrator =
        rest === 'orchestrator'
          ? CONSTANTS.orchestrator_agent
          : (CONSTANTS.orchestrator_variants || []).find((v) => v.endsWith(`-${rest}`));
      name = migratedOrchestrator || `${CONSTANTS.agent_prefix}${rest}`;
    } else {
      name = `${CONSTANTS.agent_prefix}${stem}`;
    }
  }
  return AGENT_PREFIX ? `${AGENT_PREFIX}-${name}` : name;
}

/**
 * Whole-word, negation-aware match. Case-insensitive.
 *
 * `expected` may be a single word or a short phrase; it is matched at word
 * boundaries so "CRITICAL" does not match inside "supercritical" (a bare
 * substring match would), and a match is discarded if immediately preceded
 * by a common negation ("not", "isn't", "no", ...) so "this is not critical"
 * does not count as a hit for expected string "critical".
 */
function matchesExpectedString(text, expected) {
  if (!text || !expected) return false;
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `(?:\\b(?<negation>not|isn't|wasn't|aren't|weren't|doesn't|wouldn't|shouldn't|couldn't|won't|can't|don't|no|never)\\s+)?\\b${escaped}\\b`,
    'gi',
  );
  let match;
  while ((match = re.exec(text)) !== null) {
    if (!match.groups || !match.groups.negation) return true;
    if (match.index === re.lastIndex) re.lastIndex++; // guard against zero-length match loops
  }
  return false;
}

/** Best-effort extraction of the model ID actually used, from stream-json events. */
function extractModelId(lines) {
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (typeof event.model === 'string' && event.model) return event.model;
      if (typeof event.message?.model === 'string' && event.message.model) return event.message.model;
    } catch {
      // Skip non-JSON lines
    }
  }
  return null;
}

module.exports = {
  name: 'claude-code-agent-runner',
  matchesExpectedString,
  extractModelId,
  resolveAgentName,
  resolveMcpWarmupMs,
  extractMcpReady,
  extractAvailableToolsCount,
  runClaudeTurn,
  MCP_WARMUP_MS_DEFAULT,
  MCP_WARMUP_MS_MAX,

  async evaluate(context) {
    const {
      taskId,
      expectedTools,
      input,
      subsetName,
      datasetPath,
      workDir,
      modelId: pinnedModelId,
      expectedSkillMarkers,
      requiredMcpServer,
    } = context;

    const agentName = resolveAgentName({ subsetName, datasetPath, taskId });
    const prompt = Array.isArray(input) ? input.join('\n') : input;

    const { mkdtempSync } = require('fs');
    const { tmpdir } = require('os');
    const cwd = workDir || mkdtempSync(`${tmpdir()}/${CONSTANTS.agent_prefix}bench-`);

    const claudeArgs = [
      '--agent',
      agentName,
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'bypassPermissions',
    ];
    if (pinnedModelId) {
      claudeArgs.push('--model', pinnedModelId);
    }

    const mcpWarmupMs = resolveMcpWarmupMs(context);

    let stdout;
    let mcpWaitMs = null;
    try {
      const turnResult = await runClaudeTurn({
        claudeArgs,
        prompt,
        cwd,
        warmupMs: mcpWarmupMs,
        timeoutMs: 900000,
      });
      stdout = turnResult.stdout;
      mcpWaitMs = turnResult.mcpWaitMs;
    } catch (err) {
      return {
        similarityScore: 0,
        scores: {
          correctness: { score: 0, reason: `Agent execution failed: ${err.message}`, maxScore: 2 },
          toolUse: { score: 0, reason: 'Agent did not complete', maxScore: 2 },
          additional: { score: 0, reason: 'N/A', maxScore: 0 },
          skillContentUsed: { score: 0, reason: 'N/A — agent did not complete', maxScore: 0 },
        },
        judgeOutput: `[claude-code-agent-runner] ${taskId}: FAILED - ${err.message}`,
        success: false,
        taskCompleted: false,
        answerCorrect: null,
        modelId: pinnedModelId || null,
        mcpReady: null,
        mcpWaitMs: err.mcpWaitMs ?? mcpWaitMs,
        availableToolsCount: null,
      };
    }

    const toolExecutions = [];
    let responseText = '';
    const streamLines = stdout.split('\n').filter(Boolean);

    for (const line of streamLines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'tool_use') {
              toolExecutions.push({ toolName: block.name, input: block.input });
            }
            if (block.type === 'text') {
              responseText += block.text;
            }
          }
        }
        if (event.type === 'result' && event.result) {
          responseText = event.result;
        }
      } catch {
        // Skip non-JSON lines
      }
    }

    const modelId = extractModelId(streamLines) || pinnedModelId || null;
    const mcpReady = extractMcpReady(streamLines, requiredMcpServer || null);
    const availableToolsCount = extractAvailableToolsCount(streamLines);

    const requiredTools = expectedTools?.required || [];
    // Build a local, lowercase-keyed copy of `alternatives` rather than
    // mutating `expectedTools.alternatives` -- that object is the scenario's
    // own nested object, and runSubset reuses the same scenario across every
    // replicate, so mutating it here would leak the injected `subagent`
    // default (and any other write) into replicate 2 onward. Keying by
    // lowercase also makes the lookup case-insensitive, since a scenario's
    // `required`/alternatives keys may use any casing.
    const alternativesByLowerKey = {};
    for (const [key, value] of Object.entries(expectedTools?.alternatives || {})) {
      alternativesByLowerKey[key.toLowerCase()] = value;
    }
    const lookupAlternatives = (name) => alternativesByLowerKey[name.toLowerCase()] || [];
    if (!alternativesByLowerKey.subagent) alternativesByLowerKey.subagent = ['Agent'];

    const normalizeToolName = (name) => {
      if (name.includes(':')) {
        const lastColon = name.lastIndexOf(':');
        const toolPart = name.slice(lastColon + 1);
        const lastSep = toolPart.lastIndexOf('__');
        return lastSep > 0 ? toolPart.slice(lastSep + 2).toLowerCase() : toolPart.toLowerCase();
      }
      const lastSep = name.lastIndexOf('__');
      if (lastSep > 0 && name.startsWith('mcp__')) {
        return name.slice(lastSep + 2).toLowerCase();
      }
      return name.toLowerCase();
    };
    const usedToolNames = new Set(toolExecutions.map((t) => normalizeToolName(t.toolName)));

    const filePayloadTexts = toolExecutions
      .filter((t) => ['write', 'edit', 'agent'].includes(normalizeToolName(t.toolName)))
      .map((t) => {
        const toolInput = t.input || {};
        if (typeof toolInput.content === 'string') return toolInput.content;
        if (typeof toolInput.new_string === 'string') return toolInput.new_string;
        if (typeof toolInput.prompt === 'string') return toolInput.prompt;
        return '';
      })
      .filter(Boolean);

    const covered = [];
    const missing = [];

    for (const required of requiredTools) {
      const acceptableTools = [required, ...lookupAlternatives(required)];
      if (acceptableTools.some((t) => usedToolNames.has(t.toLowerCase()))) {
        covered.push(required);
      } else {
        missing.push(required);
      }
    }

    const allToolsCovered = requiredTools.length === 0 || missing.length === 0;
    const expectedToolSet = new Set(
      requiredTools.flatMap((r) => [r, ...lookupAlternatives(r)].map((t) => t.toLowerCase())),
    );
    const unexpectedTools = [...usedToolNames].filter((t) => !expectedToolSet.has(t));
    const hasUnexpected = requiredTools.length > 0 && unexpectedTools.length > 0;
    const toolScore = !allToolsCovered ? 0 : hasUnexpected ? 1 : 2;
    const toolReason = !allToolsCovered
      ? `Missing tools: ${missing.join(', ')}. Covered: ${covered.join(', ') || 'none'}`
      : hasUnexpected
        ? `Required tools covered but unexpected tools used: ${unexpectedTools.join(', ')}`
        : `All ${requiredTools.length} required tools used: ${covered.join(', ') || 'none required'}`;

    // skillContentUsed (0-1): dual-path detection. Native-loaded skills inject
    // their content at session start with NO tool_use event, so `toolScore`
    // alone cannot gate whether skill content was actually consulted for
    // scenarios that exercise a natively-loaded skill. A scenario opts into
    // this check by defining `expectedSkillMarkers`; scenarios that omit it
    // are scored exactly as before (maxScore: 0, vacuously satisfied).
    // Accepts Claude Code's own skill-invocation tool, `Skill` (normalizes to
    // 'skill' -- see normalizeToolName above), plus any scenario-declared
    // alternative name for it. A public agent has no other way to signal a
    // native skill load, so 'skill' is the only fixed acceptance name here.
    const skillContentAcceptableToolNames = new Set(
      ['skill', ...lookupAlternatives('Skill')].map((t) => t.toLowerCase()),
    );
    const skillToolInvoked = [...usedToolNames].some((t) => skillContentAcceptableToolNames.has(t));
    let skillContentUsed = { score: 0, reason: 'N/A — scenario does not define expectedSkillMarkers', maxScore: 0 };
    if (Array.isArray(expectedSkillMarkers) && expectedSkillMarkers.length > 0) {
      const foundMarkers = expectedSkillMarkers.filter(
        (m) =>
          matchesExpectedString(responseText, m) || filePayloadTexts.some((text) => matchesExpectedString(text, m)),
      );
      const markerRatio = foundMarkers.length / expectedSkillMarkers.length;
      const formatAdherent = markerRatio >= 0.6;
      const pass = skillToolInvoked || formatAdherent;
      skillContentUsed = {
        score: pass ? 1 : 0,
        reason: pass
          ? skillToolInvoked
            ? 'A skill-listing tool was invoked — skill content confirmed consulted'
            : `${foundMarkers.length}/${expectedSkillMarkers.length} skill-format markers found (native-loaded content path): ${foundMarkers.join(', ')}`
          : `Neither a skill-listing tool invocation nor sufficient skill-format markers found (${foundMarkers.length}/${expectedSkillMarkers.length}): ${foundMarkers.join(', ') || 'none'}`,
        maxScore: 1,
      };
    }

    const expectedStrings = context.expectedStrings || [];
    let correctnessScore = 2;
    let correctnessReason = 'No expectedStrings defined';
    let answerCorrect = null;
    if (expectedStrings.length > 0) {
      const found = expectedStrings.filter((s) => matchesExpectedString(responseText, s));
      const ratio = found.length / expectedStrings.length;
      correctnessScore = ratio === 1 ? 2 : ratio >= 0.5 ? 1 : 0;
      correctnessReason = `${found.length}/${expectedStrings.length} expected strings found: ${found.join(', ') || 'none'}`;
      answerCorrect = ratio === 1;
    }

    const substantiveText = responseText.replace(/\[tool_use\].*?\n/g, '').trim();
    const additionalScore = substantiveText.length > 100 ? 1 : 0;
    const additionalReason =
      additionalScore === 1 ? 'Response contains substantive content' : 'Response is empty or trivial';

    const totalScore = toolScore + correctnessScore + additionalScore;
    const maxScore = 5;
    const normalizedScore = totalScore / maxScore;

    // `success` is the strict, gating-safe signal: required tools used with
    // nothing unexpected (toolScore === 2), additionally gated on
    // skillContentUsed when a scenario defines expectedSkillMarkers.
    // normalizedScore/similarityScore remain informational/advisory only.
    const success =
      toolScore === 2 && (skillContentUsed.maxScore === 0 || skillContentUsed.score === skillContentUsed.maxScore);

    return {
      similarityScore: Math.round(normalizedScore * 100),
      scores: {
        correctness: { score: correctnessScore, reason: correctnessReason, maxScore: 2 },
        toolUse: { score: toolScore, reason: toolReason, maxScore: 2 },
        additional: { score: additionalScore, reason: additionalReason, maxScore: 1 },
        skillContentUsed,
      },
      judgeOutput: `[claude-code-agent-runner] ${taskId}: total=${totalScore}/5, tools=${toolScore}/2, correctness=${correctnessScore}/2, additional=${additionalScore}/1${skillContentUsed.maxScore > 0 ? `, skillContentUsed=${skillContentUsed.score}/1` : ''}. ${toolReason}. Tools used: ${[...usedToolNames].join(', ') || 'none'}`,
      success,
      taskCompleted: true,
      answerCorrect,
      totalScore,
      maxScore: 5,
      modelId,
      mcpReady,
      mcpWaitMs,
      availableToolsCount,
    };
  },
};
