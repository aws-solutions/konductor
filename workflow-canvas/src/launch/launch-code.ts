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

/** The parts of `window` that watching for a pasted launch address needs. */
export interface LaunchWatchEnvironment {
  location: Pick<Location, 'hash' | 'reload'>;
  addEventListener(type: 'hashchange', listener: () => void): void;
}

/**
 * Reloads the page when a launch code is put into the address of the open
 * page. Pasting the printed address into the same tab only changes the
 * fragment, which does not reload the page.
 */
export function reloadOnLaunchCode(env: LaunchWatchEnvironment): void {
  env.addEventListener('hashchange', () => {
    if (decodeFragment(env.location.hash) !== '') env.location.reload();
  });
}

function decodeFragment(hash: string): string {
  const raw = hash.replace(/^#/, '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
