// SPDX-License-Identifier: Apache-2.0

/** A valid `hello` workflow with one stage. */
export function oneStageWorkflow(stage = 'a', agent = 'b'): string {
  return `format: konductor/1\nname: hello\nversion: 0.1.0\nintent:\n  outcome: x\nstages:\n  - name: ${stage}\n    agent: ${agent}\n`;
}
