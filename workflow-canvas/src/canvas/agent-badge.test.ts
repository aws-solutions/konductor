// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { AGENT_BADGE_COLORS, agentColor, agentInitials } from './agent-badge';

describe('agentInitials', () => {
  it.each([
    ['k-developer', 'DE'],
    ['k-quality-assurance', 'QA'],
    ['custom-agent', 'CA'],
    ['x', 'XX'],
    ['', '??'],
  ])('turns %j into %s', (agent, initials) => {
    expect(agentInitials(agent)).toBe(initials);
  });
});

describe('agentColor', () => {
  it('returns the same palette index for the same id', () => {
    expect(agentColor('k-developer')).toBe(agentColor('k-developer'));
  });

  it.each(['k-developer', 'k-quality-assurance', '', 'future-agent'])(
    'keeps %j inside the palette',
    (agent) => {
      expect(agentColor(agent)).toBeGreaterThanOrEqual(0);
      expect(agentColor(agent)).toBeLessThan(AGENT_BADGE_COLORS);
    },
  );
});
