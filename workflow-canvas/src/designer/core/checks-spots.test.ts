// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  CHECK_COMMENTS_REASON,
  CHECK_DUPLICATE_ERROR,
  CHECK_ORDER_ERROR,
  checkCollectionBlocker,
  withAcceptanceChecks,
  type CheckToWrite,
} from './checks-spots';

const fileCheck = (
  id: string,
  file = 'OLD.md',
  source?: number,
): CheckToWrite => ({
  id,
  kind: 'file',
  file,
  run: [],
  ...(source === undefined ? {} : { source }),
});
const runCheck = (
  id: string,
  run: readonly string[],
  source?: number,
): CheckToWrite => ({
  id,
  kind: 'run',
  file: '',
  run,
  ...(source === undefined ? {} : { source }),
});

const HEAD = `format: konductor/1
name: hello
version: 0.1.0
intent:
  outcome: Ship it.
`;
const BLOCK = `${HEAD}  accept:
    - id: old
      file: OLD.md
stages:
  - name: plan
    agent: k-architect
`;

function value(written: ReturnType<typeof withAcceptanceChecks>): string {
  expect(written.ok).toBe(true);
  if (!written.ok) throw new Error(written.reason);
  return written.text;
}

describe('withAcceptanceChecks scalar range edits', () => {
  it.each([
    ['LF', BLOCK],
    ['CRLF', BLOCK.replaceAll('\n', '\r\n')],
    ['BOM', `\uFEFF${BLOCK}`],
    ['no final newline', BLOCK.slice(0, -1)],
  ])('changes only a file value with %s', (_, text) => {
    const written = value(
      withAcceptanceChecks(text, [fileCheck('old', 'NEW.md', 0)]),
    );
    expect(written.replace('NEW.md', 'OLD.md')).toBe(text);
  });

  it.each(['true', 'false', 'null', '123', '0'])(
    'quotes the YAML-shaped id %s',
    (id) => {
      const written = value(
        withAcceptanceChecks(BLOCK, [fileCheck(id, 'OLD.md', 0)]),
      );
      expect(parse(written).intent.accept[0].id).toBe(id);
      expect(written).toContain(`id: ${JSON.stringify(id)}`);
    },
  );

  it('preserves quoted keys, key order and spacing', () => {
    const text = `${HEAD}  accept:
    - "file" : "OLD.md"
      "id" : "old"
stages:
  - name: plan
    agent: k-architect
`;
    const written = value(
      withAcceptanceChecks(text, [fileCheck('old', 'NEW.md', 0)]),
    );
    expect(written).toBe(text.replace('"OLD.md"', 'NEW.md'));
  });

  it('changes only the kind field when switching file to run', () => {
    const text = BLOCK.replace('      file: OLD.md', '      "file" : "OLD.md"');
    const written = value(
      withAcceptanceChecks(text, [runCheck('old', ['npm', 'test'], 0)]),
    );
    expect(written).toBe(
      text.replace('      "file" : "OLD.md"', '      run: [npm, test]'),
    );
  });

  it('adds and removes run argv entries by scalar range', () => {
    const text = `${HEAD}  accept:
    - id: tests
      run:
        - npm
        - test
stages:
  - name: plan
    agent: k-architect
`;
    const added = value(
      withAcceptanceChecks(text, [
        runCheck('tests', ['npm', 'run', 'test'], 0),
      ]),
    );
    expect(added).toBe(
      text.replace('        - test', '        - run\n        - test'),
    );
    expect(
      value(
        withAcceptanceChecks(added, [runCheck('tests', ['npm', 'test'], 0)]),
      ),
    ).toBe(text);
  });
});

describe('withAcceptanceChecks structural range edits', () => {
  it('adds a block check without changing the existing row', () => {
    const text = BLOCK.replace('id: old', '"id": "old"').replace(
      'file: OLD.md',
      '"file" : "OLD.md"',
    );
    const written = value(
      withAcceptanceChecks(text, [
        fileCheck('old', 'OLD.md', 0),
        fileCheck('next', 'NEXT.md'),
      ]),
    );
    expect(written).toBe(
      text.replace(
        '      "file" : "OLD.md"',
        '      "file" : "OLD.md"\n    - id: next\n      file: NEXT.md',
      ),
    );
  });

  it('removes one block check without changing the survivor', () => {
    const text = BLOCK.replace(
      '    - id: old\n      file: OLD.md',
      '    - "id": "first"\n      "file" : "FIRST.md"\n    - id: old\n      file: OLD.md',
    );
    expect(
      value(withAcceptanceChecks(text, [fileCheck('old', 'OLD.md', 1)])),
    ).toBe(BLOCK);
  });

  it('keeps remove-first add-last order', () => {
    const text = BLOCK.replace(
      '    - id: old\n      file: OLD.md',
      '    - id: first\n      file: FIRST.md\n    - id: old\n      file: OLD.md',
    );
    const written = value(
      withAcceptanceChecks(text, [
        fileCheck('old', 'OLD.md', 1),
        fileCheck('next', 'NEXT.md'),
      ]),
    );
    expect(
      parse(written).intent.accept.map(({ id }: { id: string }) => id),
    ).toEqual(['old', 'next']);
  });

  const flow = `${HEAD}  accept: [{"id": "first", "file": "FIRST.md"}, {"id": "old", "file": "OLD.md"}]
stages:
  - name: plan
    agent: k-architect
`;

  it.each([
    [
      'append',
      [
        fileCheck('first', 'FIRST.md', 0),
        fileCheck('old', 'OLD.md', 1),
        fileCheck('next', 'NEXT.md'),
      ],
      '  accept: [{"id": "first", "file": "FIRST.md"}, {"id": "old", "file": "OLD.md"}, {id: next, file: NEXT.md}]',
    ],
    [
      'prepend',
      [
        fileCheck('next', 'NEXT.md'),
        fileCheck('first', 'FIRST.md', 0),
        fileCheck('old', 'OLD.md', 1),
      ],
      '  accept: [{id: next, file: NEXT.md}, {"id": "first", "file": "FIRST.md"}, {"id": "old", "file": "OLD.md"}]',
    ],
    [
      'remove first',
      [fileCheck('old', 'OLD.md', 1)],
      '  accept: [{"id": "old", "file": "OLD.md"}]',
    ],
    [
      'remove last',
      [fileCheck('first', 'FIRST.md', 0)],
      '  accept: [{"id": "first", "file": "FIRST.md"}]',
    ],
  ] as const)('%s preserves flow row boundaries', (_, checks, acceptLine) => {
    const written = value(withAcceptanceChecks(flow, checks));
    expect(written).toBe(flow.replace(/^  accept:.*$/m, acceptLine));
    expect(parse(written).intent.accept).toHaveLength(checks.length);
  });

  it('removes the only flow row', () => {
    const text = flow.replace(
      '[{"id": "first", "file": "FIRST.md"}, {"id": "old", "file": "OLD.md"}]',
      '[{"id": "old", "file": "OLD.md"}]',
    );
    const written = value(withAcceptanceChecks(text, []));
    expect(written).toBe(
      text.replace('[{"id": "old", "file": "OLD.md"}]', '[]'),
    );
    expect(parse(written).intent.accept).toEqual([]);
  });

  it('refuses a pure row reorder', () => {
    const text = BLOCK.replace(
      '    - id: old\n      file: OLD.md',
      '    - id: first\n      file: FIRST.md\n    - id: old\n      file: OLD.md',
    );
    expect(
      withAcceptanceChecks(text, [
        fileCheck('old', 'OLD.md', 1),
        fileCheck('first', 'FIRST.md', 0),
      ]),
    ).toEqual({ ok: false, reason: CHECK_ORDER_ERROR });
  });

  it('adds a missing accept after the outcome inline comment', () => {
    const text = `${HEAD.replace('Ship it.', 'Ship it. # keep with outcome')}stages:
  - name: plan
    agent: k-architect`;
    const written = value(
      withAcceptanceChecks(text, [fileCheck('new', 'NEW.md')]),
    );
    expect(written).toContain(
      '  outcome: Ship it. # keep with outcome\n  accept:\n    - id: new\n      file: NEW.md\nstages:',
    );
    expect(written.endsWith('agent: k-architect')).toBe(true);
  });
});

describe('withAcceptanceChecks validation and refusals', () => {
  it('rejects duplicate ids before writing', () => {
    expect(
      withAcceptanceChecks(BLOCK, [
        fileCheck('same', 'ONE.md', 0),
        fileCheck('same', 'TWO.md'),
      ]),
    ).toEqual({ ok: false, reason: CHECK_DUPLICATE_ERROR });
  });

  it('rejects an empty run before writing', () => {
    expect(withAcceptanceChecks(BLOCK, [runCheck('old', [], 0)])).toEqual({
      ok: false,
      reason: 'A run check needs at least one argument.',
    });
  });

  it('does not mistake a quoted # for a comment', () => {
    const text = BLOCK.replace('OLD.md', '"docs/PLAN#1.md"');
    expect(checkCollectionBlocker(text, 'accept', true)).toBeUndefined();
    const written = value(
      withAcceptanceChecks(text, [
        fileCheck('old', 'docs/PLAN#1.md', 0),
        fileCheck('next', 'NEXT.md'),
      ]),
    );
    expect(written).toContain('"docs/PLAN#1.md"');
  });

  it('reports comments before a structural edit but permits scalar edits', () => {
    const text = BLOCK.replace('    - id: old', '    # keep\n    - id: old');
    expect(checkCollectionBlocker(text, 'accept', true)).toBe(
      CHECK_COMMENTS_REASON,
    );
    expect(checkCollectionBlocker(text, 'accept', false)).toBeUndefined();
  });

  it.each([
    ['anchor', BLOCK.replace('  accept:', '  accept: &checks')],
    ['tag', BLOCK.replace('  accept:', '  accept: !checks')],
    [
      'duplicate key',
      BLOCK.replace(
        '      file: OLD.md',
        '      file: OLD.md\n      file: TWO.md',
      ),
    ],
  ])('gives an exact refusal for %s', (_, text) => {
    expect(checkCollectionBlocker(text, 'accept')).toMatch(
      /anchor|alias|tag|duplicate/,
    );
  });
});
