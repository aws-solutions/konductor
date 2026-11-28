// SPDX-License-Identifier: Apache-2.0
import { expect, it } from 'vitest';
import { draftOf, unlinkOutput } from './draft';

it.each([
  ['empty prompt', 'Read {plan.design}.', ''],
  ['no trailing newline', 'Keep this.\nRead {plan.design}.', 'Keep this.'],
  ['one trailing newline', 'Keep this.\n\nRead {plan.design}.', 'Keep this.\n'],
  [
    'multiple trailing newlines',
    'Keep this.\n\n\nRead {plan.design}.',
    'Keep this.\n\n',
  ],
])('round trips a generated suffix after %s', (_, prompt, expected) => {
  const draft = draftOf(
    [
      { name: 'plan', agent: 'k-architect', outputs: { design: 'DESIGN.md' } },
      { name: 'build', agent: 'k-developer' },
    ],
    ['Plan.', prompt],
  );
  expect(unlinkOutput(draft, 's1', 's2', 'design').stages[1]?.prompt).toBe(
    expected,
  );
});

it('removes only the exact generated prompt line', () => {
  const draft = draftOf(
    [
      { name: 'plan', agent: 'k-architect', outputs: { design: 'DESIGN.md' } },
      { name: 'build', agent: 'k-developer' },
    ],
    ['Plan.', 'Use {plan.design} here.\nRead {plan.design}.\nKeep this.'],
  );

  const unlinked = unlinkOutput(draft, 's1', 's2', 'design');

  expect(unlinked.stages[1]?.prompt).toBe(
    'Use {plan.design} here.\nKeep this.',
  );
});
