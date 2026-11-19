// SPDX-License-Identifier: Apache-2.0
/** Checks that the stub lists the agents that the Designer offers. */
import { describe, expect, it } from 'vitest';
import { KNOWN_AGENTS } from '../src/designer/core/agents.ts';
import { AGENTS } from '../stub-api/core/agents.ts';

describe('the agents of the stub', () => {
  it('are the agents that the Designer offers today', () => {
    expect(AGENTS).toEqual(KNOWN_AGENTS);
  });
});
