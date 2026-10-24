// SPDX-License-Identifier: Apache-2.0
import { ApiError } from './errors.ts';
import { sha256Hex } from './hash.ts';

export interface StoredFile {
  text: string;
  hash: string;
}

/**
 * Workflow files held in memory, by name. A save compares the hash and writes
 * in one synchronous step.
 */
export class WorkflowStore {
  private readonly files = new Map<string, string>();

  constructor(files: Readonly<Record<string, string>> = {}) {
    for (const [name, text] of Object.entries(files))
      this.files.set(name, text);
  }

  read(name: string): StoredFile | undefined {
    const text = this.files.get(name);
    return text === undefined ? undefined : { text, hash: sha256Hex(text) };
  }

  /**
   * Writes the text if the file still has the hash the caller loaded, where
   * `null` means the file must not exist. Returns the hash of the new text.
   */
  save(name: string, text: string, baseHash: string | null): string {
    const current = this.read(name);
    const unchanged = baseHash === null ? !current : current?.hash === baseHash;
    if (!unchanged) throw conflictWith(current, baseHash);
    this.files.set(name, text);
    return sha256Hex(text);
  }
}

function conflictWith(
  current: StoredFile | undefined,
  baseHash: string | null,
): ApiError {
  if (!current) return new ApiError('conflict', 'The file no longer exists.');
  const message =
    baseHash === null
      ? 'The file already exists.'
      : 'The file changed on disk.';
  return new ApiError('conflict', message, { current_hash: current.hash });
}
