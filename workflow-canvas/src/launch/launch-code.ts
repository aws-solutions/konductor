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
 * The shape of a launch code: at least 128 bits as URL-safe characters (22 or
 * more), and at most the 256 that the API accepts. A short fragment such as
 * `#top` is an anchor, not a code.
 */
const LAUNCH_CODE = /^[A-Za-z0-9_-]{22,256}$/;

/** Whether `fragment` has the shape of a launch code. */
export function isLaunchCode(fragment: string): boolean {
  return LAUNCH_CODE.test(fragment);
}

/**
 * Reloads the page when a launch code is put into the address of the open
 * page. Pasting the printed address into the same tab only changes the
 * fragment, which does not reload the page. Any other fragment is left alone,
 * so an in-page anchor cannot throw the session away.
 */
export function reloadOnLaunchCode(env: LaunchWatchEnvironment): void {
  env.addEventListener('hashchange', () => {
    if (isLaunchCode(decodeFragment(env.location.hash))) env.location.reload();
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
