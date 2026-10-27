// SPDX-License-Identifier: Apache-2.0

/** The message of an `Error`, or `fallback` for anything else that was thrown. */
export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
