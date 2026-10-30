// SPDX-License-Identifier: Apache-2.0
import { ConfigError } from './config-error.ts';
import { FIXTURES, SAMPLE_ROOT } from './core/sample.ts';

/** A `STUB_WORKFLOW` value that names no fixture. */
export class StubWorkflowError extends ConfigError {
  constructor(value: string) {
    super(
      `STUB_WORKFLOW=${JSON.stringify(value)} is not usable: ` +
        `use one of ${Object.keys(FIXTURES).join(', ')}, or unset it for ${SAMPLE_ROOT}.`,
    );
    this.name = 'StubWorkflowError';
  }
}

/**
 * The workflow the stub serves: `STUB_WORKFLOW` if it is set, else `hello`. An
 * empty value counts as unset. Throws `StubWorkflowError` for a name that is
 * not a fixture.
 */
export function stubWorkflow(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.STUB_WORKFLOW;
  if (!value) return SAMPLE_ROOT;
  if (!Object.hasOwn(FIXTURES, value)) throw new StubWorkflowError(value);
  return value;
}
