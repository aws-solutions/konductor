// SPDX-License-Identifier: Apache-2.0
import { originOf, stubPort } from './address.ts';

/** The variable that names the server behind `/api`. Unset means the stub. */
export const TARGET_VARIABLE = 'WC_API_TARGET';

/** Where `/api` goes: the origin of a server, and whether it is the stub. */
export interface ApiTarget {
  origin: string;
  isStub: boolean;
}

/** A `WC_API_TARGET` value that is not an http(s) origin. */
export class ApiTargetError extends Error {
  constructor(value: string, reason: string) {
    super(
      `${TARGET_VARIABLE}=${JSON.stringify(value)} is not usable: ${reason}. ` +
        `Use an origin such as http://127.0.0.1:8080, or unset it for the stub.`,
    );
    this.name = 'ApiTargetError';
  }
}

/** The origin of `value`, or an `ApiTargetError` that says what is wrong. */
function parseOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiTargetError(value, 'it is not a URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ApiTargetError(value, 'the scheme must be http or https');
  }
  if (url.username || url.password) {
    throw new ApiTargetError(value, 'it must not carry credentials');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new ApiTargetError(value, 'it must be an origin, with no path');
  }
  return url.origin;
}

/**
 * The server `/api` goes to: `WC_API_TARGET` if it is set, else the stub.
 * An empty value counts as unset. Throws `ApiTargetError` for a bad value.
 */
export function apiTarget(env: NodeJS.ProcessEnv = process.env): ApiTarget {
  const value = env[TARGET_VARIABLE];
  if (!value) return { origin: originOf(stubPort(env)), isStub: true };
  return { origin: parseOrigin(value), isStub: false };
}

/**
 * Like `apiTarget`, but a bad value prints its message and exits with 1, so a
 * config file shows one clear line instead of a stack trace.
 */
export function apiTargetOrExit(
  env: NodeJS.ProcessEnv = process.env,
): ApiTarget {
  try {
    return apiTarget(env);
  } catch (error) {
    if (!(error instanceof ApiTargetError)) throw error;
    console.error(`error: ${error.message}`);
    return process.exit(1);
  }
}
