// SPDX-License-Identifier: Apache-2.0
import { expect, it } from 'vitest';
import {
  addCheck,
  draftOf,
  rebaseCheckSources,
  removeCheck,
  setCheck,
} from './draft';

const STAGES = [{ name: 'plan', agent: 'k-architect' }];
const CHECKS = [
  { id: 'old', file: 'OLD.md' },
  { id: 'tests', run: ['npm', 'test'] },
];

it('loads acceptance checks with stable keys and source rows', () => {
  const draft = draftOf(STAGES, [], {}, CHECKS);
  expect(draft.checks).toEqual([
    {
      key: 'c1',
      sourceIndex: 0,
      id: 'old',
      kind: 'file',
      file: 'OLD.md',
      run: [],
    },
    {
      key: 'c2',
      sourceIndex: 1,
      id: 'tests',
      kind: 'run',
      file: '',
      run: ['npm', 'test'],
    },
  ]);
});

it('keeps row identity while a check changes', () => {
  const draft = draftOf(STAGES, [], {}, CHECKS);
  const changed = setCheck(draft, 'c1', {
    id: 'new',
    kind: 'file',
    file: 'NEW.md',
    run: [],
  });
  expect(changed.checks?.[0]).toMatchObject({
    key: 'c1',
    sourceIndex: 0,
    id: 'new',
    file: 'NEW.md',
  });
});

it('adds a new stable key and removes only the selected row', () => {
  const draft = draftOf(STAGES, [], {}, CHECKS);
  const added = addCheck(draft);
  expect(added.checks?.at(-1)).toMatchObject({
    key: 'c3',
    id: 'check-1',
  });
  expect(removeCheck(added, 'c2').checks?.map(({ key }) => key)).toEqual([
    'c1',
    'c3',
  ]);
});

it('binds a saved new row to its source index', () => {
  const added = addCheck(draftOf(STAGES, [], {}, CHECKS));
  const saved = rebaseCheckSources(
    added,
    [...CHECKS, { id: 'check-1', file: '' }],
    added.checks?.map(({ key }) => key) ?? [],
  );
  expect(saved.checks?.at(-1)?.sourceIndex).toBe(2);
});
