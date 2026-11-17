// SPDX-License-Identifier: Apache-2.0
'use strict';

// Nests the flat call steps under the child agents that made them. Plain data in, plain JSON out.

/**
 * The step tree for `steps` (flat call steps in gateway order, each with `n` and `parentId`) and `agents` (child agents
 * `{id, name, parentId, order}` from the stream). Returns a list of nodes in run order. A call node is the step with
 * `type: 'call'`; an agent node is `{type: 'agent', id, name, parentId, stepCount, children}`, where `stepCount` counts
 * every call under it at any depth. A step or agent whose parent is not a known agent sits at the top.
 *
 * Order: a call keeps its gateway place (`n`). An agent sits just before its first call. An agent with no plant call
 * sits after the last call the stream shows before it (`streamOrder` maps a step's `n` to its stream place).
 */
function nestSteps(steps, agents, streamOrder = new Map()) {
  const byId = new Map(agents.map((a) => [a.id, { type: 'agent', id: a.id, name: a.name, parentId: a.parentId ?? null, order: a.order, stepCount: 0, children: [] }]));
  const parentOf = (id) => (id != null && byId.has(id) ? byId.get(id) : null);
  const top = [];
  for (const step of steps) (parentOf(step.parentId)?.children ?? top).push({ type: 'call', ...step });
  for (const node of byId.values()) {
    const parent = parentOf(node.parentId);
    if (parent && !isAncestor(node, parent, byId)) parent.children.push(node);
    else { node.parentId = parent ? null : node.parentId; top.push(node); }
  }
  const before = (order) => Math.max(0, ...steps.filter((s) => streamOrder.get(s.n) < order).map((s) => s.n));
  const keyOf = (node) => {
    if (node.type === 'call') return node.n;
    if (node.key === undefined) {
      const keys = node.children.map(keyOf);
      node.key = keys.length ? Math.min(...keys) - 0.5 : before(node.order) + 0.25;
    }
    return node.key;
  };
  const tidy = (nodes) => nodes.sort((a, b) => keyOf(a) - keyOf(b)).map((n) => {
    if (n.type !== 'agent') return n;
    const { key: _key, order: _order, ...rest } = n;
    const children = tidy(n.children);
    return { ...rest, stepCount: countCalls(children), children };
  });
  return tidy(top);
}

/** Whether `node` is `other` or one of `other`'s parents, which would make a loop. */
function isAncestor(node, other, byId) {
  const seen = new Set();
  for (let cur = other; cur && !seen.has(cur.id); cur = byId.get(cur.parentId)) {
    if (cur === node) return true;
    seen.add(cur.id);
  }
  return false;
}

/** Every call node in `nodes`, at any depth, in tree order. */
const flatCalls = (nodes) => nodes.flatMap((n) => (n.type === 'agent' ? flatCalls(n.children) : [n]));
const countCalls = (nodes) => flatCalls(nodes).length;

module.exports = { nestSteps, flatCalls };
