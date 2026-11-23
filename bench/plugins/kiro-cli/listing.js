// SPDX-License-Identifier: Apache-2.0
'use strict';

// What a Kiro CLI run loaded at session start, read from its own stream (DEBT D-35). Engine v3 writes a `context_usage`
// event whose `breakdown` lists every context file and skill glob the agent's resources named (matched or not, with
// tokens) and the tokens of built-in and MCP tool definitions. Konductor's skills reach the model through the skills
// MCP server's tools, not as listed SKILL.md files, so the skill files matched are normally none. Engine v2 writes no
// breakdown. Reads text only.

const SKILL_FILE = /(^|\/)SKILL\.md$|^skill:\/\//;

const itemOf = (it) => ({
  name: it.name, matched: it.matched === true, tokens: Number(it.tokens) || 0, progressivelyLoaded: it.progressivelyLoaded === true,
  ...(it.reason ? { reason: it.reason } : {}),
});

/**
 * `{ source, skillFiles, skillFilesMatched, contextFiles, contextTokens, toolTokens: { builtin, mcp } }` from the first
 * `context_usage` event with a `breakdown` in `streamText`, or null when there is none. `skillFiles` are the items whose
 * name is a SKILL.md path or glob or a skill:// URI; `contextFiles` the other items.
 */
function observedListingOf(streamText) {
  for (const line of String(streamText).split('\n')) {
    if (!line.includes('"breakdown"')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const k = ev?.data?.update?._meta?.kiro;
    if (k?.kind !== 'context_usage' || !k.breakdown) continue;
    const items = (k.breakdown.contextFiles?.items ?? []).map(itemOf);
    const skillFiles = items.filter((i) => SKILL_FILE.test(i.name));
    return {
      source: 'first context_usage breakdown in stream.jsonl',
      skillFiles,
      skillFilesMatched: skillFiles.filter((i) => i.matched).length,
      contextFiles: items.filter((i) => !SKILL_FILE.test(i.name)),
      contextTokens: Number(k.breakdown.contextFiles?.tokens) || 0,
      toolTokens: { builtin: Number(k.breakdown.tools?.builtin?.tokens) || 0, mcp: Number(k.breakdown.tools?.mcp?.tokens) || 0 },
    };
  }
  return null;
}

module.exports = { observedListingOf };
