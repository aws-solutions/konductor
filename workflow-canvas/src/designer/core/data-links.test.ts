// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  LINK_PROMPT_ERROR,
  MAX_PROMPT_CHARS,
  draftOf,
  linkOutput,
  outputLinkPromptError,
  unlinkOutput,
} from './draft';

const STAGES = [
  { name: 'plan', agent: 'k-architect', outputs: {} },
  { name: 'build', agent: 'k-developer', outputs: {} },
];

describe('data-link draft edits', () => {
  it('adds the named first output and then appends its prompt line', () => {
    const draft = draftOf(STAGES);
    const linked = linkOutput(draft, 's1', 's2', 'design', {
      name: 'design',
      path: 'DESIGN.md',
    });

    expect(linked.stages[0]?.outputs).toEqual([
      expect.objectContaining({ name: 'design', path: 'DESIGN.md' }),
    ]);
    expect(linked.stages[1]?.prompt).toBe('Read {plan.design}.');
  });

  it('uses the chosen output when several are declared', () => {
    const draft = draftOf([
      {
        ...STAGES[0]!,
        outputs: { design: 'DESIGN.md', notes: 'NOTES.md' },
      },
      STAGES[1]!,
    ]);

    const linked = linkOutput(draft, 's1', 's2', 'notes');

    expect(linked.stages[0]?.outputs).toHaveLength(2);
    expect(linked.stages[1]?.prompt).toBe('Read {plan.notes}.');
  });

  it('does not invent an output when none was supplied', () => {
    const draft = draftOf(STAGES);
    expect(linkOutput(draft, 's1', 's2', 'output')).toBe(draft);
  });

  it('accepts the exact prompt limit and rejects one character more', () => {
    const line = 'Read {plan.design}.';
    const atLimit = 'x'.repeat(MAX_PROMPT_CHARS - line.length - 1);
    const draft = draftOf(
      [{ ...STAGES[0]!, outputs: { design: 'DESIGN.md' } }, STAGES[1]!],
      ['', atLimit],
    );
    const linked = linkOutput(draft, 's1', 's2', 'design');
    expect([...(linked.stages[1]?.prompt ?? '')]).toHaveLength(
      MAX_PROMPT_CHARS,
    );

    const over = draftOf(
      [{ ...STAGES[0]!, outputs: { design: 'DESIGN.md' } }, STAGES[1]!],
      ['', `${atLimit}x`],
    );
    expect(outputLinkPromptError(over, 's1', 's2', 'design')).toBe(
      LINK_PROMPT_ERROR,
    );
    expect(linkOutput(over, 's1', 's2', 'design')).toBe(over);
  });

  it('removes only the exact generated line', () => {
    const draft = draftOf(
      [{ ...STAGES[0]!, outputs: { design: 'DESIGN.md' } }, STAGES[1]!],
      ['Plan.', 'Use {plan.design} here.\nRead {plan.design}.\nKeep this.'],
    );

    const unlinked = unlinkOutput(draft, 's1', 's2', 'design');

    expect(unlinked.stages[1]?.prompt).toBe(
      'Use {plan.design} here.\nKeep this.',
    );
  });
});
