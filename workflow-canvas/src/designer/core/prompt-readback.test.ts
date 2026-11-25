// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';

import { withStages, type ViewStages } from './stage-text';

// A quoting function that gets the text wrong, as a bug in the writer would.
vi.mock('./scalar-text', () => ({
  quoted: (value: string) => JSON.stringify(`${value} and more`),
  scalar: (value: string) => `${value}: and more`,
}));

const FILE =
  'format: konductor/1\nstages:\n  - name: a\n    agent: k-tpm\n    prompt: old\n';
const VIEW: ViewStages = { stages: [{ name: 'a', agent: 'k-tpm' }] };

describe('the read-back check of the prompt writer', () => {
  it.each([
    ['one line', 'new'],
    ['a line break', 'new\u0085\ntext'],
  ])('refuses text that would read back differently, for %s', (_, prompt) => {
    const written = withStages(FILE, VIEW, [
      { name: 'a', agent: 'k-tpm', from: 0, prompt },
    ]);

    expect(written.ok).toBe(false);
    expect(!written.ok && written.reason).toContain('reads back as typed');
  });
});
