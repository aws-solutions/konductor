// SPDX-License-Identifier: Apache-2.0
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../core/clock.ts';

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** The real clock. */
export const systemClock: Clock = { now: () => Date.now() };

/** A launch code or token: 256 bits from a secure random source. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Five random characters for the end of a run id. */
export function newRunSuffix(): string {
  return Array.from(
    randomBytes(5),
    (byte) => SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length],
  ).join('');
}

/** Compares two secrets in constant time, whatever their lengths. */
export function sameSecret(a: string, b: string): boolean {
  const digest = (text: string) => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(a), digest(b));
}
