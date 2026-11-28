// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { draftOf, linkOutput, unlinkOutput } from './draft';

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
