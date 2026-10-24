// SPDX-License-Identifier: Apache-2.0
import {
  HASH_PATTERN,
  isName,
  MAX_TEXT_BYTES,
  RUN_ID_PATTERN,
} from './contract.ts';
import { ApiError, badName } from './errors.ts';
import type {
  CheckResult,
  Run,
  SaveResult,
  WorkflowDocument,
} from './model.ts';
import type { RunSimulator } from './runs.ts';
import type { WorkflowStore } from './store.ts';
import { checkWorkflowText } from './validator.ts';

export interface WorkflowApiOptions {
  /** The one workflow that can be loaded, saved, checked and run. */
  root: string;
  store: WorkflowStore;
  runs: RunSimulator;
}

/**
 * The operations of the contract, free of HTTP. Each makes its checks in the
 * contract's order and throws an `ApiError` for the first one that fails.
 */
export class WorkflowApi {
  readonly root: string;
  private readonly store: WorkflowStore;
  private readonly runs: RunSimulator;

  constructor(options: WorkflowApiOptions) {
    this.root = options.root;
    this.store = options.store;
    this.runs = options.runs;
  }

  loadWorkflow(name: string | undefined): WorkflowDocument {
    const target = this.nameOrRoot(name);
    if (target !== this.root) {
      throw new ApiError('not_found', 'There is no workflow with this name.');
    }
    const file = this.store.read(target);
    if (!file) return emptyDocument(target);
    const check = checkWorkflowText(file.text, target);
    return {
      name: target,
      text: file.text,
      hash: file.hash,
      read_only: false,
      view: check.view,
      diagnostics: check.diagnostics,
    };
  }

  saveWorkflow(request: {
    name: string | undefined;
    text: string;
    base_hash: string | null;
  }): SaveResult {
    const target = this.writableName(request.name);
    if (request.base_hash !== null && !HASH_PATTERN.test(request.base_hash)) {
      throw new ApiError(
        'bad_hash',
        'base_hash must be 64 hex digits or null.',
      );
    }
    const check = checkText(request.text, target);
    if (!check.view) throw invalidWorkflow(check);
    const hash = this.store.save(target, request.text, request.base_hash);
    return { hash, view: check.view, diagnostics: check.diagnostics };
  }

  checkWorkflow(request: {
    name: string | undefined;
    text: string;
  }): CheckResult {
    return checkText(request.text, this.writableName(request.name));
  }

  /** Starts a run of the saved root workflow and returns its id. */
  startRun(): { run_id: string } {
    const file = this.store.read(this.root);
    if (!file) {
      throw new ApiError('not_found', 'The workflow has not been saved yet.');
    }
    const check = checkWorkflowText(file.text, this.root);
    if (!check.view) throw invalidWorkflow(check);
    const active = this.runs.activeRunId();
    if (active) {
      throw new ApiError('already_running', 'A run is already active.', {
        run_id: active,
      });
    }
    const stageNames = check.view.stages.map((stage) => stage.name);
    return { run_id: this.runs.start(this.root, stageNames) };
  }

  getRun(runId: string): Run {
    const run = RUN_ID_PATTERN.test(runId) ? this.runs.get(runId) : undefined;
    if (!run) throw new ApiError('not_found', 'There is no run with this id.');
    return run;
  }

  // A missing name is the root; a malformed one is refused.
  private nameOrRoot(name: string | undefined): string {
    if (name === undefined) return this.root;
    if (!isName(name)) {
      throw badName();
    }
    return name;
  }

  private writableName(name: string | undefined): string {
    const target = this.nameOrRoot(name);
    if (target !== this.root) {
      throw new ApiError('read_only_workflow', 'This workflow is read-only.');
    }
    return target;
  }
}

function emptyDocument(name: string): WorkflowDocument {
  return {
    name,
    text: null,
    hash: null,
    read_only: false,
    view: null,
    diagnostics: [],
  };
}

// The size limit comes before the check, as the contract orders them.
function checkText(text: string, name: string): CheckResult {
  if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
    throw new ApiError('too_large', 'The workflow text is too large.');
  }
  return checkWorkflowText(text, name);
}

function invalidWorkflow(check: CheckResult): ApiError {
  return new ApiError('invalid_workflow', 'The workflow has errors.', {
    diagnostics: check.diagnostics,
  });
}
