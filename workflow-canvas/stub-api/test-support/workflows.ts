// SPDX-License-Identifier: Apache-2.0

/** A valid `hello` workflow with one stage. */
export function oneStageWorkflow(stage = 'a', agent = 'b'): string {
  return `name: hello\nintent: x\nstages:\n  - name: ${stage}\n    agent: ${agent}\n`;
}
