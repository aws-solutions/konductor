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
export interface LaunchWatchEnvironment extends LaunchEnvironment {
  addEventListener(type: 'hashchange', listener: () => void): void;
  removeEventListener(type: 'hashchange', listener: () => void): void;
}

/**
 * The shape of a launch code. The API puts no limit on the characters of a
 * code, only 256 at most and at least 128 bits, which is 16 characters or
 * more. A shorter fragment such as `#top` is an anchor, not a code. A longer
 * anchor is offered as a code too; the server refuses it, and a refused code
 * leaves the page as it was.
 */
const LAUNCH_CODE = /^\S{16,256}$/u;

/** Whether `fragment` has the shape of a launch code. */
export function isLaunchCode(fragment: string): boolean {
  return LAUNCH_CODE.test(fragment);
}

/**
 * Hands `onCode` the launch code that is put into the address of the open
 * page, and removes it from the address. Pasting the printed address into the
 * same tab only changes the fragment. Any other fragment is left alone, so an
 * in-page anchor does nothing. Returns the function that stops watching.
 */
export function watchLaunchCode(
  env: LaunchWatchEnvironment,
  onCode: (code: string) => void,
): () => void {
  const onChange = () => {
    if (!isLaunchCode(decodeFragment(env.location.hash))) return;
    const code = takeLaunchCode(env);
    if (code !== undefined) onCode(code);
  };
  env.addEventListener('hashchange', onChange);
  return () => env.removeEventListener('hashchange', onChange);
}

function decodeFragment(hash: string): string {
  const raw = hash.replace(/^#/, '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
