// SPDX-License-Identifier: Apache-2.0
'use strict';

// Which agent can reach which capability. On kiro this comes from the lists in each agent spec, because the
// installed agent passes them as --skill-name-filter, --agent-sop-filter and the resources it loads at spawn.
// On opencode the translated config carries every skill, and SOPs are skills named sop-<name>.

const { has } = require('../runner/lib/skills.js');

const split = (id) => { const i = id.indexOf(':'); return [id.slice(0, i), id.slice(i + 1)]; };

/** Names of the agents whose spec lists the capability (kiro). For an agent: those that may spawn it. */
function kiroReachers(id, specs) {
  const [kind, name] = split(id);
  const lists = { skill: 'skills', sop: 'sops', context: 'contexts', agent: 'subagents' };
  const field = lists[kind];
  if (!field) return [];
  return specs.filter((s) => has(s[field], name)).map((s) => s.name).sort();
}

/**
 * The reachability matrix for the base tree.
 * kiro: capability id -> { acting agent -> boolean }. A SOP counts as reached when listed, but kiro serves it as an
 * MCP prompt the user invokes, not through get_skill.
 * opencode: capability id -> true for skills and SOPs, null where the harness has no such route.
 * dangling: names an agent lists that have no file in the tree.
 */
function reachability(scan, specs) {
  const agents = specs.map((s) => s.name).sort();
  const kiro = {};
  const opencode = {};
  for (const id of scan.keys()) {
    const by = new Set(kiroReachers(id, specs));
    kiro[id] = Object.fromEntries(agents.map((a) => [a, by.has(a)]));
    const [kind] = split(id);
    opencode[id] = kind === 'skill' || kind === 'sop' ? true : null;
  }
  const dangling = [];
  const fields = [['skill', 'skills'], ['sop', 'sops'], ['context', 'contexts'], ['agent', 'subagents']];
  for (const s of specs) {
    for (const [kind, field] of fields) {
      for (const n of s[field]) if (!n.includes('*') && !scan.has(`${kind}:${n}`)) dangling.push({ agent: s.name, kind, name: n });
    }
  }
  return { agents, kiro, opencode, dangling };
}

module.exports = { kiroReachers, reachability, split };
