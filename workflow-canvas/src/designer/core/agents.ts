// SPDX-License-Identifier: Apache-2.0

/** An agent that a stage can name, with a line that says what it is for. */
export interface KnownAgent {
  id: string;
  summary: string;
}

/**
 * The specialists that Konductor ships. The API in this version does not look
 * an agent up, so any id of the right form is accepted by the server; this
 * list is what the Designer offers, and it also shows an id that is not on it.
 */
export const KNOWN_AGENTS: readonly KnownAgent[] = [
  { id: 'k-architect', summary: 'System designs, API specs and data models' },
  { id: 'k-browser', summary: 'Browser automation with Playwright' },
  { id: 'k-developer', summary: 'Backend and frontend code, code review' },
  { id: 'k-media-analyzer', summary: 'PDFs, images and diagrams' },
  { id: 'k-product-manager', summary: 'User stories and requirements' },
  { id: 'k-quality-assurance', summary: 'Test coverage and test strategy' },
  { id: 'k-researcher', summary: 'External docs, web and AWS documentation' },
  { id: 'k-tpm', summary: 'Program plans and status reports' },
];

const NOT_SHIPPED = 'Not one of the agents that Konductor ships';

/**
 * The agents to offer for a stage whose agent is `current`: the known ones,
 * then those of `kept` that are not among them (the agents the saved file
 * names), with `current` first, so no id of the file is lost by choosing
 * another.
 */
export function agentChoices(
  current: string,
  kept: readonly string[] = [],
): readonly KnownAgent[] {
  const known = new Set(KNOWN_AGENTS.map((agent) => agent.id));
  const others = [...new Set([current, ...kept])].filter(
    (id) => !known.has(id),
  );
  if (others.length === 0) return KNOWN_AGENTS;
  return [
    ...others.map((id) => ({ id, summary: NOT_SHIPPED })),
    ...KNOWN_AGENTS,
  ];
}
