// SPDX-License-Identifier: Apache-2.0

/**
 * Global names that reach the clock, randomness, the environment, the page,
 * storage, a timer or the network. Any use of one, including an alias such as
 * `const f = fetch`, is a problem in an IO-free core.
 */
export const FORBIDDEN_GLOBALS: ReadonlySet<string> = new Set([
  // clock and timers
  'Date',
  'performance',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  // randomness and locale
  'crypto',
  'randomBytes',
  'randomUUID',
  'randomInt',
  'randomFillSync',
  'getRandomValues',
  'Intl',
  // network
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'BroadcastChannel',
  'Worker',
  'SharedWorker',
  // the page and storage
  'window',
  'self',
  'document',
  'navigator',
  'location',
  'history',
  'globalThis',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  // the environment and dynamic code
  'process',
  'Deno',
  'Bun',
  'require',
  'eval',
]);

/** `Object.member` pairs that are IO, though the object itself is not. */
export const FORBIDDEN_MEMBERS: Readonly<Record<string, ReadonlySet<string>>> =
  {
    Math: new Set(['random']),
    AbortSignal: new Set(['timeout']),
  };
