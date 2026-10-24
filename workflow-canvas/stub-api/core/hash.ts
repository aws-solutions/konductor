// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';

/** The SHA-256 of a text's UTF-8 bytes, as 64 lower-case hex digits. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
