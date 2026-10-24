// SPDX-License-Identifier: Apache-2.0
import { originOf, stubPort } from './address.ts';
import { ConfigError, exitOnConfigError } from './config-error.ts';

/** The variable that names the server behind `/api`. Unset means the stub. */
export const TARGET_VARIABLE = 'WC_API_TARGET';

/** Where `/api` goes: the origin of a server, and whether it is the stub. */
export interface ApiTarget {
  origin: string;
  isStub: boolean;
}

/**
 * `value` without what may be secret in it. The authority runs from `://` to
 * the first `/`, `?` or `#`. If it holds an `@`, the text up to the last `@`
 * is the userinfo and is masked; the host stays. Text after a `?` or `#` goes.
 *
 * A password may hold an unencoded `/`, `?` or `#`, so `http://u:p/q@h` and
 * `http://h:1/?k=a@x` cannot be told apart: both have an `@` only after the
 * authority ends. Then everything after `://` is masked (`http://***`), which
 * hides the host as well. Hiding too much is the safe error.
 *
 * The same holds when the authority has an `@` and the path after it has one
 * too (`http://u:x@secret/more@h:1`): the password may hold a `/`, so the
 * "host" could be part of it. Then everything after `://` is masked.
 */
export function redact(value: string): string {
  const text = value.trim();
  const [, scheme, rest = ''] =
    /^(?:([a-z][a-z0-9+.-]*):\/\/)?(.*)$/is.exec(text) ?? [];
  const prefix = scheme ? `${scheme}://` : '';
  const end = rest.search(/[/?#]/);
  const authority = end < 0 ? rest : rest.slice(0, end);
  const tail = end < 0 ? '' : rest.slice(end);
  const at = authority.lastIndexOf('@');
  const path = tail.replace(/[?#].*$/s, '');
  if ((at < 0 && tail.includes('@')) || path.includes('@')) {
    return `${prefix}***`;
  }
  const host = at < 0 ? authority : `***@${authority.slice(at + 1)}`;
  return `${prefix}${host}${tail.replace(/([?#]).*$/s, '$1...')}`;
}

/** A `WC_API_TARGET` value that is not an http(s) origin. */
export class ApiTargetError extends ConfigError {
  constructor(value: string, reason: string) {
    super(
      `${TARGET_VARIABLE}=${JSON.stringify(redact(value))} is not usable: ${reason}. ` +
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
 * An empty value counts as unset. Throws `ApiTargetError` for a bad target and
 * `StubPortError` for a bad `STUB_PORT` (which only matters for the stub).
 */
export function apiTarget(env: NodeJS.ProcessEnv = process.env): ApiTarget {
  const value = env[TARGET_VARIABLE];
  if (!value) return { origin: originOf(stubPort(env)), isStub: true };
  return { origin: parseOrigin(value), isStub: false };
}

/**
 * Like `apiTarget`, but a bad `WC_API_TARGET` or `STUB_PORT` prints its message
 * and exits with 1, so a config file shows one clear line, not a stack trace.
 */
export function apiTargetOrExit(
  env: NodeJS.ProcessEnv = process.env,
): ApiTarget {
  return exitOnConfigError(() => apiTarget(env));
}
