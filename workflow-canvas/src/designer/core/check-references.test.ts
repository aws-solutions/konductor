// SPDX-License-Identifier: Apache-2.0
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { withAcceptanceChecks } from './checks-spots';
import { withDoneWhen } from './done-when-text';
import {
  doneWhenIds,
  draftOf,
  removeCheck,
  setCheck,
  setDoneWhen,
} from './draft';

const CHECKS = [
  { id: 'a', file: 'A.md' },
  { id: 'b', file: 'B.md' },
];
const STAGES = [
  { name: 'first', agent: 'k-architect', done_when: ['a'] },
  { name: 'second', agent: 'k-architect', done_when: ['b'] },
];
const TEXT = `format: konductor/1
name: hello
version: 0.1.0
intent:
  outcome: Ship it.
  accept:
    - id: a
      file: A.md
    - id: b
      file: B.md
stages:
  - name: first
    agent: k-architect
    done_when: [a]
  - name: second
    agent: k-architect
    done_when: [b]
`;

it('keeps references separate through a temporary duplicate id', () => {
  let draft = draftOf(STAGES, [], {}, CHECKS);
  draft = setCheck(draft, 'c1', {
    id: 'b',
    kind: 'file',
    file: 'A.md',
    run: [],
  });
  draft = setCheck(draft, 'c2', {
    id: 'c',
    kind: 'file',
    file: 'B.md',
    run: [],
  });

  const values = draft.stages.map((stage) =>
    doneWhenIds(draft, stage.doneWhen ?? []),
  );
  expect(values).toEqual([['b'], ['c']]);

  const checks = (draft.checks ?? []).map(
    ({ id, kind, file, run, sourceIndex }) => ({
      id,
      kind,
      file,
      run,
      source: sourceIndex,
    }),
  );
  const accepted = withAcceptanceChecks(TEXT, checks);
  expect(accepted.ok).toBe(true);
  if (!accepted.ok) throw new Error(accepted.reason);
  const completed = withDoneWhen(
    accepted.text,
    values.map((stageValues, index) => ({
      values: stageValues,
      before: STAGES[index]!.done_when,
    })),
    new Set(['b', 'c']),
  );
  expect(completed.ok).toBe(true);
  if (!completed.ok) throw new Error(completed.reason);
  expect(
    parse(completed.text).stages.map(
      (stage: { done_when: string[] }) => stage.done_when,
    ),
  ).toEqual([['b'], ['c']]);
});

it('binds a repaired stale id to its unique check key', () => {
  const stale = draftOf(
    [{ name: 'plan', agent: 'k-architect', done_when: ['missing'] }],
    [],
    {},
    [{ id: 'old', file: 'OLD.md' }],
  );
  expect(stale.stages[0]!.doneWhen).toEqual([{ id: 'missing' }]);

  const repaired = setCheck(stale, 'c1', {
    id: 'missing',
    kind: 'file',
    file: 'OLD.md',
    run: [],
  });

  expect(repaired.stages[0]!.doneWhen).toEqual([{ key: 'c1' }]);
  expect(doneWhenIds(repaired, repaired.stages[0]!.doneWhen ?? [])).toEqual([
    'missing',
  ]);
});

it('keeps an ambiguous source id unresolved', () => {
  const duplicate = draftOf(
    [{ name: 'plan', agent: 'k-architect', done_when: ['same'] }],
    [],
    {},
    [
      { id: 'same', file: 'ONE.md' },
      { id: 'same', file: 'TWO.md' },
    ],
  );
  const edited = setCheck(duplicate, 'c1', {
    id: 'same',
    kind: 'file',
    file: 'EDITED.md',
    run: [],
  });
  expect(edited.stages[0]!.doneWhen).toEqual([{ id: 'same' }]);
});

it('removes references by stable key and sets selections by key', () => {
  const draft = draftOf(STAGES, [], {}, CHECKS);
  const selected = setDoneWhen(draft, 's1', ['c2']);
  expect(doneWhenIds(selected, selected.stages[0]!.doneWhen ?? [])).toEqual([
    'b',
  ]);
  const removed = removeCheck(selected, 'c2');
  expect(removed.stages.map(({ doneWhen }) => doneWhen)).toEqual([[], []]);
});
