// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { agentChoices, KNOWN_AGENTS } from './agents';

describe('agentChoices', () => {
  it('offers the known agents when the current one is among them', () => {
    expect(agentChoices('k-developer')).toBe(KNOWN_AGENTS);
  });

  it('puts an agent that is not known first, so it is never lost', () => {
    const choices = agentChoices('my-agent');

    expect(choices[0]?.id).toBe('my-agent');
    expect(choices.slice(1)).toEqual(KNOWN_AGENTS);
  });

  it('lists only ids that the API accepts', () => {
    for (const { id } of KNOWN_AGENTS) {
      expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
    }
  });

  it('keeps an agent that the saved file names once another is chosen', () => {
    const choices = agentChoices('k-developer', ['my-agent']);

    expect(choices.map((agent) => agent.id)).toEqual([
      'my-agent',
      ...KNOWN_AGENTS.map((agent) => agent.id),
    ]);
  });

  it('lists the current agent and the saved ones once each', () => {
    const choices = agentChoices('my-agent', ['my-agent', 'other']);

    expect(choices.slice(0, 2).map((agent) => agent.id)).toEqual([
      'my-agent',
      'other',
    ]);
  });
});
