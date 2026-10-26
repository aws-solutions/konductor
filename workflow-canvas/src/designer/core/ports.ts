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
   * `SaveConflict` when the file changed, and with `SaveRefused` when the text
   * has errors.
   */
  save(text: string, baseHash: string): Promise<SaveResult>;
  /** Checks text without writing it. */
  check(text: string): Promise<CheckResult>;
  /** Loads the workflow again from the server. */
  reload(): Promise<WorkflowDocument>;
}

/** The file changed since it was loaded, so nothing was written. */
export class SaveConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveConflict';
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
