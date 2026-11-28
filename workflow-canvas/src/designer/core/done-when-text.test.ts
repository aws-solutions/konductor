// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  CHECK_REFERENCE_ERROR,
  doneWhenEditBlocker,
  withDoneWhen,
  type DoneWhenRequest,
} from './done-when-text';
import { CHECK_COMMENTS_REASON } from './checks-spots';

const BLOCK = `format: konductor/1
name: hello
version: 0.1.0
intent:
  outcome: Ship it.
  accept:
    - id: old
      file: OLD.md
stages:
  - name: plan
    agent: k-architect
    done_when:
      - old
`;

const request = (
  values: readonly string[],
  before: readonly string[] = ['old'],
): DoneWhenRequest => ({ values, before });

function value(written: ReturnType<typeof withDoneWhen>): string {
  expect(written.ok).toBe(true);
  if (!written.ok) throw new Error(written.reason);
  return written.text;
}

describe('withDoneWhen scalar sequence edits', () => {
  it.each([
    {
      name: 'block',
      text: BLOCK,
      expected: BLOCK.replace('      - old', '      - next'),
    },
    {
      name: 'flow',
      text: BLOCK.replace('done_when:\n      - old', 'done_when: [ old ]'),
      expected: BLOCK.replace('done_when:\n      - old', 'done_when: [ next ]'),
    },
  ])(
    'changes one id in $name form without rebuilding it',
    ({ text, expected }) => {
      expect(
        value(withDoneWhen(text, [request(['next'])], new Set(['next']))),
      ).toBe(expected);
    },
  );

  it.each(['true', 'false', 'null', '123', '0'])(
    'quotes the YAML-shaped id %s',
    (id) => {
      const written = value(
        withDoneWhen(BLOCK, [request([id])], new Set([id])),
      );
      expect(parse(written).stages[0].done_when).toEqual([id]);
    },
  );

  it('adds and removes ids at sequence boundaries', () => {
    const added = value(
      withDoneWhen(
        BLOCK,
        [request(['first', 'old', 'last'])],
        new Set(['first', 'old', 'last']),
      ),
    );
    expect(parse(added).stages[0].done_when).toEqual(['first', 'old', 'last']);
    const removed = value(
      withDoneWhen(
        added,
        [request(['old'], ['first', 'old', 'last'])],
        new Set(['old']),
      ),
    );
    expect(removed).toBe(BLOCK);
  });
});

describe('withDoneWhen insertion and refusals', () => {
  it('adds a missing list after the agent inline comment', () => {
    const text = BLOCK.replace(
      '    agent: k-architect\n    done_when:\n      - old',
      '    agent: k-architect # keep with agent',
    ).trimEnd();
    const written = value(
      withDoneWhen(text, [request(['old'], [])], new Set(['old'])),
    );
    expect(written).toBe(`${text}\n    done_when: [old]`);
  });

  it('rejects an id that names no acceptance check', () => {
    expect(
      withDoneWhen(BLOCK, [request(['missing'])], new Set(['old'])),
    ).toEqual({ ok: false, reason: CHECK_REFERENCE_ERROR });
  });

  it('reports comments before structural sequence edits', () => {
    const text = BLOCK.replace('      - old', '      # keep\n      - old');
    expect(doneWhenEditBlocker(text, 0)).toBe(CHECK_COMMENTS_REASON);
    expect(
      withDoneWhen(text, [request(['old', 'next'])], new Set(['old', 'next'])),
    ).toEqual({ ok: false, reason: CHECK_COMMENTS_REASON });
  });

  it('changes a safe stage beside an unchanged unsupported list', () => {
    const text = BLOCK.replace(
      '    done_when:\n      - old',
      `    done_when: &waits [old]
  - name: review
    agent: k-reviewer
    done_when: [old]`,
    );
    const written = value(
      withDoneWhen(
        text,
        [request(['old']), request(['next'], ['old'])],
        new Set(['old', 'next']),
      ),
    );
    expect(written).toBe(text.replace('done_when: [old]', 'done_when: [next]'));
  });
});
