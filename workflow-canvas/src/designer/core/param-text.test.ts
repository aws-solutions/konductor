// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  paramsInPlaceBlocker,
  withParams,
  type ParamToWrite,
} from './param-text';

const FLOW_REASON =
  'The params mapping uses flow style, so the editor cannot change it byte for byte. Make the change in a text editor.';
const QUOTED_REASON =
  'The params mapping quotes a parameter or known field key, so the editor cannot change it byte for byte. Make the change in a text editor.';
const METADATA_REASON =
  'The params mapping uses an anchor, alias or tag, so the editor cannot change it byte for byte. Make the change in a text editor.';
const DUPLICATE_REASON =
  'The params mapping has a duplicate parameter or field key, so the editor cannot change it safely. Make the change in a text editor.';
const LAYOUT_REASON =
  'The params mapping is not a block with one parameter and field per line, so the editor cannot change it byte for byte. Make the change in a text editor.';

function kept(
  before: NonNullable<ParamToWrite['before']>,
  from: number,
): ParamToWrite {
  return {
    name: before.name,
    description: before.description ?? '',
    default: before.default ?? '',
    required: before.required ?? false,
    before,
    from,
  };
}

function changed(
  before: NonNullable<ParamToWrite['before']>,
  from: number,
  change: Partial<ParamToWrite>,
): ParamToWrite {
  return { ...kept(before, from), ...change };
}

describe('withParams', () => {
  it('adds a block before stages when params are absent', () => {
    const text =
      'format: konductor/1\nstages:\n  - name: draft\n    agent: k-developer\n';

    expect(
      withParams(text, [
        { name: 'goal', description: '', default: '', required: false },
        { name: 'param_1', description: '', default: '', required: false },
      ]),
    ).toEqual({
      ok: true,
      text: 'format: konductor/1\nparams:\n  goal: {}\n  param_1: {}\nstages:\n  - name: draft\n    agent: k-developer\n',
    });
  });

  it('changes only the requested scalar range in a commented block', () => {
    const text = [
      'params:',
      '  # goal note',
      '  goal: # inline header',
      "    description: 'Old goal' # keep inline",
      "    default: ''",
      '    required: false',
      '  # tone note',
      '  tone:',
      '    description: Voice',
      'stages:',
      '  - name: draft',
      '    agent: k-developer',
      '',
    ].join('\n');
    const goal = {
      name: 'goal',
      description: 'Old goal',
      default: '',
      required: false,
    };
    const tone = { name: 'tone', description: 'Voice' };

    const result = withParams(text, [
      changed(goal, 0, { description: 'New goal' }),
      kept(tone, 1),
    ]);

    expect(result).toEqual({
      ok: true,
      text: text.replace("'Old goal'", 'New goal'),
    });
  });

  it('keeps CRLF and comments when a field is added', () => {
    const text =
      'params:\r\n  goal: {} # goal\r\n  # end params\r\nstages:\r\n  - name: draft\r\n    agent: k-developer\r\n';

    expect(
      withParams(text, [
        changed({ name: 'goal' }, 0, { description: 'Run it' }),
      ]),
    ).toEqual({
      ok: true,
      text: text.replace(
        '  goal: {} # goal\r\n',
        '  goal:  # goal\r\n    description: Run it\r\n',
      ),
    });
  });

  it('adds and removes declarations without rebuilding kept items', () => {
    const text =
      'params:\n  first:\n    description: Keep # bytes\n  second: {}\nstages:\n  - name: draft\n    agent: k-developer\n';
    const first = { name: 'first', description: 'Keep' };

    expect(
      withParams(text, [
        kept(first, 0),
        { name: 'param_1', description: '', default: '', required: false },
      ]),
    ).toEqual({
      ok: true,
      text: 'params:\n  first:\n    description: Keep # bytes\n  param_1: {}\nstages:\n  - name: draft\n    agent: k-developer\n',
    });
  });
  it('adds a declaration after an EOF item and keeps no final newline', () => {
    const text =
      'stages:\n  - name: draft\n    agent: k-developer\nparams:\n  goal: {}';

    expect(
      withParams(text, [
        kept({ name: 'goal' }, 0),
        { name: 'param_1', description: '', default: '', required: false },
      ]),
    ).toEqual({
      ok: true,
      text: `${text}\n  param_1: {}`,
    });
  });

  it('adds a field after an EOF item and keeps no final newline', () => {
    const text =
      'stages:\n  - name: draft\n    agent: k-developer\nparams:\n  goal: {}';

    expect(
      withParams(text, [
        changed({ name: 'goal' }, 0, { description: 'Run it' }),
      ]),
    ).toEqual({
      ok: true,
      text: text.replace('  goal: {}', '  goal: \n    description: Run it'),
    });
  });

  it('removes only the empty mapping token when adding a field', () => {
    const text =
      'params:\n  goal:    {}    # keep comment spaces  \nstages:\n  - name: draft\n    agent: k-developer\n';

    expect(
      withParams(text, [
        changed({ name: 'goal' }, 0, { description: 'Run it' }),
      ]),
    ).toEqual({
      ok: true,
      text: text.replace(
        '  goal:    {}    # keep comment spaces  \n',
        '  goal:        # keep comment spaces  \n    description: Run it\n',
      ),
    });
  });

  it('refuses a source-backed row when no params source plan exists', () => {
    const text =
      'format: konductor/1\nstages:\n  - name: draft\n    agent: k-developer\n';

    expect(withParams(text, [kept({ name: 'goal' }, 0)])).toEqual({
      ok: false,
      reason: LAYOUT_REASON,
    });
  });
});

describe('params writer refusal boundary', () => {
  it.each([
    ['flow mapping', 'params: { goal: {} }\n', FLOW_REASON],
    ['quoted params key', '"params":\n  goal: {}\n', QUOTED_REASON],
    ['escaped quoted params key', '"par\\x61ms":\n  goal: {}\n', QUOTED_REASON],
    ['quoted param key', 'params:\n  "goal": {}\n', QUOTED_REASON],
    [
      'quoted known field',
      'params:\n  goal:\n    "description": Reader\n',
      QUOTED_REASON,
    ],
    [
      'escaped quoted known field',
      'params:\n  goal:\n    "descr\\x69ption": Reader\n',
      QUOTED_REASON,
    ],
    ['params anchor', 'params: &params\n  goal: {}\n', METADATA_REASON],
    ['parameter alias', 'params:\n  goal: *copy\n', METADATA_REASON],
    [
      'field anchor',
      'params:\n  goal:\n    description: &copy Reader\n',
      METADATA_REASON,
    ],
    [
      'field alias',
      'params:\n  goal:\n    description: *copy\n',
      METADATA_REASON,
    ],
    [
      'field tag',
      'params:\n  goal:\n    description: !text Reader\n',
      METADATA_REASON,
    ],
    [
      'duplicate parameter',
      'params:\n  goal: {}\n  goal: {}\n',
      DUPLICATE_REASON,
    ],
    [
      'duplicate field',
      'params:\n  goal:\n    description: One\n    description: Two\n',
      DUPLICATE_REASON,
    ],
    [
      'block scalar',
      'params:\n  goal:\n    description: |\n      Reader\n',
      LAYOUT_REASON,
    ],
    [
      'field flow value',
      'params:\n  goal:\n    description: [Reader]\n',
      LAYOUT_REASON,
    ],
  ])('refuses %s with its exact reason', (_name, text, reason) => {
    expect(paramsInPlaceBlocker(text)).toBe(reason);
    expect(
      withParams(text, [
        { name: 'goal', description: 'Changed', default: '', required: false },
      ]),
    ).toEqual({ ok: false, reason });
  });
});
