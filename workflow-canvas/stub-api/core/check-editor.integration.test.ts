// SPDX-License-Identifier: Apache-2.0
import { expect, it } from 'vitest';
import {
  withAcceptanceChecks,
  type CheckToWrite,
} from '../../src/designer/core/checks-spots.ts';
import { checkWorkflowText } from './validator.ts';

const TEXT = `format: konductor/1
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
`;
const OLD: CheckToWrite = {
  id: 'old',
  kind: 'file',
  file: 'OLD.md',
  run: [],
  source: 0,
};

it.each(['true', 'false', 'null', '123', '0', 'a'.repeat(64)])(
  'accepts the YAML-shaped check id %s after a writer edit',
  (id) => {
    const written = withAcceptanceChecks(TEXT, [{ ...OLD, id }]);
    expect(written.ok).toBe(true);
    if (!written.ok) throw new Error(written.reason);
    const checked = checkWorkflowText(written.text, 'hello');
    expect(checked.errors).toBe(0);
    expect(checked.view?.intent.accept?.[0]?.id).toBe(id);
  },
);
