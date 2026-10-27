// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/** Checks that the agents the Designer offers are the specialists in `agents/`. */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KNOWN_AGENTS } from '../src/designer/core/agents';

const AGENTS_DIR = fileURLToPath(new URL('../../agents/', import.meta.url));
const SUFFIX = '.agent-spec.json';

// The specialists: their specs are named `k-<role>`, unlike the orchestrators.
function specialists(): string[] {
  return readdirSync(AGENTS_DIR)
    .filter((file) => file.startsWith('k-') && file.endsWith(SUFFIX))
    .map((file) => file.slice(0, -SUFFIX.length))
    .sort();
}

describe('the agents that the Designer offers', () => {
  it('are exactly the specialists that have a spec in agents/', () => {
    expect(KNOWN_AGENTS.map((agent) => agent.id).sort()).toEqual(specialists());
  });

  it.each(KNOWN_AGENTS.map((agent) => agent.id))(
    'name %s in its own spec',
    (id) => {
      const spec = JSON.parse(
        readFileSync(`${AGENTS_DIR}${id}${SUFFIX}`, 'utf8'),
      ) as { name?: string };

      expect(spec.name).toBe(id);
    },
  );
});
