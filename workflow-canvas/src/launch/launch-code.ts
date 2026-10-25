// SPDX-License-Identifier: Apache-2.0

/** The parts of `window` that the launch code needs. */
export interface LaunchEnvironment {
  location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  history: Pick<History, 'replaceState'>;
}

/**
 * Reads the launch code from the fragment of the address and removes the
 * fragment from the address bar. Returns `undefined` when there is no code.
 */
export function takeLaunchCode(env: LaunchEnvironment): string | undefined {
  const code = decodeFragment(env.location.hash);
  if (env.location.hash !== '') {
    const { pathname, search } = env.location;
    env.history.replaceState(null, '', `${pathname}${search}`);
  }
  return code === '' ? undefined : code;
}

function decodeFragment(hash: string): string {
  const raw = hash.replace(/^#/, '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
