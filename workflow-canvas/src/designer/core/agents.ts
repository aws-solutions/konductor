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

/**
 * The agents to offer for a stage whose agent is `current`: the known ones,
 * and `current` first if it is not among them, so it is never lost.
 */
export function agentChoices(current: string): readonly KnownAgent[] {
  return KNOWN_AGENTS.some((agent) => agent.id === current)
    ? KNOWN_AGENTS
    : [
        { id: current, summary: 'Not one of the agents that Konductor ships' },
        ...KNOWN_AGENTS,
      ];
}
