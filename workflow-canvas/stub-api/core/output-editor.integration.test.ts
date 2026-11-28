// SPDX-License-Identifier: Apache-2.0
import { expect, it } from 'vitest';
import { withOutputs } from '../../src/designer/core/outputs-text.ts';
import { checkWorkflowText } from './validator.ts';

const TEXT = `format: konductor/1
name: hello
version: 0.1.0
intent:
  outcome: Do it.
stages:
  - name: plan
    agent: k-architect
    outputs: {design: DESIGN.md}
`;

it.each(['null', 'true', 'false'])(
  'accepts the YAML-shaped output name %s after a writer edit',
  (name) => {
    const written = withOutputs(TEXT, [
      {
        outputs: [{ name, path: 'VALUE.md' }],
        before: { design: 'DESIGN.md' },
      },
    ]);
    expect(written.ok).toBe(true);
    if (!written.ok) throw new Error(written.reason);
    const checked = checkWorkflowText(written.text, 'hello');
    expect(checked.errors).toBe(0);
    expect(checked.view?.stages[0]?.outputs).toEqual({ [name]: 'VALUE.md' });
  },
);
