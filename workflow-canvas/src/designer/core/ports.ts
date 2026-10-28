// SPDX-License-Identifier: Apache-2.0
import type {
  CheckResult,
  DiagnosticView,
  SaveResult,
  WorkflowDocument,
} from '../../api/types';

/**
 * The calls of the API that editing needs, already tied to a session. The
 * page depends on this port; `workflow/load-workflow.ts` builds the adapter.
 */
export interface EditPort {
  /**
   * Writes the text if the file still has `baseHash`. It rejects with
   * `SaveConflict` when the file changed, with `SaveRefused` when the text
   * has errors, and with `SaveLost` when the answer did not come or was a
   * server error, so the file may or may not have been written.
   */
  save(text: string, baseHash: string): Promise<SaveResult>;
  /** Checks text without writing it. */
  check(text: string): Promise<CheckResult>;
  /** Loads the workflow again from the server. */
  reload(): Promise<WorkflowDocument>;
}

/**
 * The file changed since it was loaded, so nothing was written. `currentHash`
 * is the hash of the file as it is now, and is missing when it was deleted.
 */
export class SaveConflict extends Error {
  readonly currentHash?: string;

  constructor(message: string, currentHash?: string) {
    super(message);
    this.name = 'SaveConflict';
    this.currentHash = currentHash;
  }
}

/** The text has errors, so nothing was written. */
export class SaveRefused extends Error {
  readonly diagnostics: readonly DiagnosticView[];

  constructor(message: string, diagnostics: readonly DiagnosticView[]) {
    super(message);
    this.name = 'SaveRefused';
    this.diagnostics = diagnostics;
  }
}

/** The answer to a save did not come, so the file may have been written. */
export class SaveLost extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveLost';
  }
}
