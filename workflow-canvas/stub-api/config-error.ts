// SPDX-License-Identifier: Apache-2.0

/** A bad setting that a command reports in one line, without a stack trace. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Runs `read`. A `ConfigError` prints one `error:` line and exits with 1;
 * anything else is a bug and is rethrown.
 */
export function exitOnConfigError<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`error: ${error.message}`);
    return process.exit(1);
  }
}
