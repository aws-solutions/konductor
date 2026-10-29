// SPDX-License-Identifier: Apache-2.0

/**
 * Whether the stub takes the launch code again, as `dev:stub` does for a person
 * who reloads. `STUB_STRICT=1` turns that off, so the code works once as the
 * contract says; use it to check that a reload resumes from the stored session.
 */
export function reusableLaunchCode(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): boolean {
  return argv.includes('--with-dev-server') && env.STUB_STRICT !== '1';
}
