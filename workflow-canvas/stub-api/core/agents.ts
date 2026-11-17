// SPDX-License-Identifier: Apache-2.0

/** An agent that a stage may name, with a line that says what it is for. */
export interface Agent {
  id: string;
  summary: string;
}

/**
 * The specialist agents of Konductor, in the order of their ids: what
 * `GET /api/agents` lists. It is the list that the Designer offers today.
 */
export const AGENTS: readonly Agent[] = [
  { id: 'k-architect', summary: 'System designs, API specs and data models' },
  { id: 'k-browser', summary: 'Browser automation with Playwright' },
  { id: 'k-developer', summary: 'Backend and frontend code, code review' },
  { id: 'k-media-analyzer', summary: 'PDFs, images and diagrams' },
  { id: 'k-product-manager', summary: 'User stories and requirements' },
  { id: 'k-quality-assurance', summary: 'Test coverage and test strategy' },
  { id: 'k-researcher', summary: 'External docs, web and AWS documentation' },
  { id: 'k-tpm', summary: 'Program plans and status reports' },
];
