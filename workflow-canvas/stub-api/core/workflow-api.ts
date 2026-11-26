// SPDX-License-Identifier: Apache-2.0
import {
  HARNESS,
  HASH_PATTERN,
  isName,
  MAX_TEXT_BYTES,
  quoteValue,
  RUN_ID_PATTERN,
} from './contract.ts';
import { AGENTS, type Agent } from './agents.ts';
import { ApiError, badName } from './errors.ts';
import { STAGE_FIELDS } from './fields.ts';
import { sha256Hex } from './hash.ts';
import {
  findLibrary,
  listLibrary,
  SHIPPED_LIBRARY,
  type LibraryEntry,
  type ShippedWorkflow,
} from './library.ts';
import type {
  CheckResult,
  Run,
  RunEvent,
  RunSummary,
  SaveResult,
  WorkflowDocument,
  WorkflowView,
} from './model.ts';
import type { RunChecks, RunPlan, RunSimulator } from './runs.ts';
import type { Behavior } from './sample.ts';
import type { WorkflowStore } from './store.ts';
import { checkWorkflowText } from './validator.ts';

/** An answer of `GET /api/runs/{id}/events`, and when the next event is due. */
export interface RunEventsPage {
  events: RunEvent[];
  next: number;
  finished: boolean;
  nextAt?: number;
}

export interface WorkflowApiOptions {
  /** The one workflow that can be loaded, saved, checked and run. */
  root: string;
  store: WorkflowStore;
  runs: RunSimulator;
  /** How a run of the root is answered. The default is a run that passes. */
  behavior?: Behavior;
  library?: readonly ShippedWorkflow[];
}

/**
 * The operations of the contract, free of HTTP. Each makes its checks in the
 * contract's order and throws an `ApiError` for the first one that fails.
 */
export class WorkflowApi {
  root: string;
  private readonly store: WorkflowStore;
  private readonly runs: RunSimulator;
  private readonly behavior: Behavior;
  private readonly library: readonly ShippedWorkflow[];
  /**
   * The hash of the root file when the stub started, which stands for the
   * user's confirmation in a terminal: a root that is not `untrusted` begins
   * trusted. A save that changes the bytes leaves the record where it is, so
   * the file stops matching it, as the contract says.
   */
  private trustedHash: string | undefined;
  private otherRunStarted = false;

  constructor(options: WorkflowApiOptions) {
    this.root = options.root;
    this.store = options.store;
    this.runs = options.runs;
    this.behavior = options.behavior ?? {};
    this.library = options.library ?? SHIPPED_LIBRARY;
    this.trustedHash = this.behavior.untrusted
      ? undefined
      : this.store.read(this.root)?.hash;
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
      stage_fields: STAGE_FIELDS,
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

  /**
   * Starts a run of the saved root workflow and returns its id. The refusals
   * come in the order of the contract: the file, the workflow, the params,
   * trust, a run that is active, the harness. The workflow is trusted only
   * while the file still has the bytes it had when the stub started.
   */
  startRun(
    name: string | undefined,
    params: Record<string, string>,
  ): { run_id: string } {
    const target = this.writableName(name);
    const file = this.store.read(target);
    if (!file) {
      throw new ApiError('not_found', 'The workflow has not been saved yet.');
    }
    const check = checkWorkflowText(file.text, target);
    if (!check.view) throw invalidWorkflow(check);
    const view = check.view;
    resolveParams(params, view);
    const stageNames = view.stages.map((stage) => stage.name);
    if (this.trustedHash !== file.hash) throw untrusted(target);
    this.findOtherRun();
    const active = this.runs.activeRunId();
    if (active) {
      throw new ApiError(
        'already_running',
        'A run is already active in this workspace.',
        {
          run_id: active,
        },
      );
    }
    if (this.behavior.harnessUnavailable) {
      throw new ApiError(
        'harness_unavailable',
        `${HARNESS} is not installed.`,
        {
          fix: `Install ${HARNESS} and sign in, then try again.`,
        },
      );
    }
    const runId = this.runs.start(
      target,
      stageNames,
      params.goal ?? '',
      this.planOfRun(view),
    );
    return { run_id: runId };
  }

  /** The runs of the root, newest first: the stub keeps every run it played. */
  listRuns(limit: number): { runs: RunSummary[] } {
    this.findOtherRun();
    return { runs: this.runs.list(this.root, limit) };
  }

  /**
   * In a busy workspace another program's run is there before any call, so
   * the first call that reads runs finds it, and every later call sees the
   * same run. It never ends.
   */
  private findOtherRun(): void {
    if (!this.behavior.busy || this.otherRunStarted) return;
    const file = this.store.read(this.root);
    const view = file && checkWorkflowText(file.text, this.root).view;
    if (!view) return;
    this.otherRunStarted = true;
    const stageNames = view.stages.map((stage) => stage.name);
    this.runs.start(this.root, stageNames, goalOfOther(view), {
      neverEnds: true,
      checks: checksOf(view),
    });
  }

  /** Lists the shipped workflows without their source text. */
  listLibrary(): { entries: LibraryEntry[] } {
    return { entries: listLibrary(this.library) };
  }

  /** Opens a ready shipped workflow as a read-only document. */
  loadLibrary(
    name: string,
  ): WorkflowDocument & { text: string; view: WorkflowView } {
    const entry = this.readyLibrary(name);
    const text = entry.text;
    const target = name.slice('library/'.length);
    const check = checkWorkflowText(text, target);
    if (!check.view) {
      throw new ApiError(
        'io_error',
        'The server could not read or write its files.',
      );
    }
    return {
      name,
      text,
      hash: sha256Hex(text),
      read_only: true,
      view: check.view,
      diagnostics: check.diagnostics,
      stage_fields: STAGE_FIELDS,
    };
  }

  /** Copies a ready shipped workflow and makes the copy this session's root. */
  copyLibrary(name: string, as: string): WorkflowDocument {
    if (!isName(as)) throw badName();
    const source = this.loadLibrary(name);
    if (this.store.read(as)) {
      throw new ApiError(
        'conflict',
        'A workflow with this name already exists.',
      );
    }
    this.store.save(as, source.text, null);
    this.trustedHash = undefined;
    this.root = as;
    return this.loadWorkflow(undefined);
  }

  private readyLibrary(name: string): { text: string } {
    listLibrary(this.library);
    if (!/^library\/[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
      throw badName();
    }
    const entry = findLibrary(name, this.library);
    if (!entry) {
      throw new ApiError(
        'not_found',
        'There is no library workflow with this name.',
      );
    }
    if (entry.status !== 'ready' || entry.text === undefined) {
      throw new ApiError(
        'not_available',
        'This library workflow is not available yet.',
      );
    }
    return { text: entry.text };
  }

  listAgents(): { agents: Agent[] } {
    return { agents: [...AGENTS] };
  }

  getRun(runId: string): Run {
    this.findOtherRun();
    const run = RUN_ID_PATTERN.test(runId) ? this.runs.get(runId) : undefined;
    if (!run) throw new ApiError('not_found', 'There is no run with this id.');
    return run;
  }

  /**
   * The events of a run after the `seq` given, as far as they have happened.
   * `nextAt` says when the next one happens, for a caller that waits for it.
   */
  runEvents(runId: string, after: number): RunEventsPage {
    this.findOtherRun();
    const known = RUN_ID_PATTERN.test(runId) ? this.runs.events(runId) : null;
    if (!known)
      throw new ApiError('not_found', 'There is no run with this id.');
    if (after > known.lastSeq) {
      throw new ApiError(
        'bad_request',
        '`after` is past the last event of the run.',
      );
    }
    const events = known.events.filter((event) => event.seq > after);
    return {
      events,
      next: events.at(-1)?.seq ?? after,
      finished: known.finished,
      ...(known.nextAt === undefined ? {} : { nextAt: known.nextAt }),
    };
  }

  private planOfRun(view: WorkflowView): RunPlan {
    const { blocks, unwrittenOutput } = this.behavior;
    const checks = checksOf(view);
    if (blocks) {
      return { block: { at: blocks.stage, reason: blocks.reason }, checks };
    }
    return declares(view, unwrittenOutput)
      ? { unwritten: unwrittenOutput, checks }
      : { checks };
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
      throw new ApiError(
        'read_only_workflow',
        'The session root changed. Reload the page before saving, checking, or running.',
      );
    }
    return target;
  }
}

// The run that another program started has a goal the stub never saw, so it
// stands in the workflow's default goal, or its outcome.
function goalOfOther(view: WorkflowView): string {
  return view.params?.goal?.default ?? view.intent.outcome;
}

// The checks the run reports: every id of `intent.accept`, and the ids each
// stage's `done_when` names. The validator has already held every `done_when`
// id to a check the file declares.
function checksOf(view: WorkflowView): RunChecks {
  const named = view.stages.flatMap((stage) =>
    stage.done_when === undefined
      ? []
      : [[stage.name, stage.done_when] as const],
  );
  return {
    ids: (view.intent.accept ?? []).map((check) => check.id),
    doneWhen: Object.fromEntries(named),
  };
}

// A run takes the goal and the params the workflow declares, and nothing
// else. The HTTP layer has already checked the shape of each value, so what
// is left needs the declaration: a name the file does not declare, and a
// required param with neither a value nor a default. A name is matched as an
// own key, so an inherited name such as `constructor` is undeclared.
function resolveParams(
  params: Record<string, string>,
  view: WorkflowView,
): void {
  const declared = view.params ?? {};
  for (const name of Object.keys(params)) {
    if (name === 'goal' || Object.hasOwn(declared, name)) continue;
    throw new ApiError(
      'bad_params',
      `The workflow does not declare the param ${quoteValue(name)}.`,
    );
  }
  for (const [name, param] of Object.entries(declared)) {
    const missing =
      param.required === true &&
      !Object.hasOwn(params, name) &&
      param.default === undefined;
    if (missing) {
      throw new ApiError(
        'bad_params',
        `The param ${quoteValue(name)} is required and has no default, so the run needs a value for it.`,
      );
    }
  }
}

// Whether a stage of the workflow declares the output named. An own-key
// check, so an inherited name such as `constructor` is not taken as declared.
function declares(
  view: WorkflowView,
  named: { stage: string; output: string } | undefined,
): named is { stage: string; output: string } {
  if (!named) return false;
  const stage = view.stages.find((found) => found.name === named.stage);
  return Object.hasOwn(stage?.outputs ?? {}, named.output);
}

function emptyDocument(name: string): WorkflowDocument {
  return {
    name,
    text: null,
    hash: null,
    read_only: false,
    view: null,
    diagnostics: [],
    stage_fields: STAGE_FIELDS,
  };
}

// The size limit comes before the check, as the contract orders them.
function checkText(text: string, name: string): CheckResult {
  if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
    throw new ApiError('too_large', 'The workflow text is too large.');
  }
  return checkWorkflowText(text, name);
}

// The fix names the exact command, and it is the only text in backticks.
function untrusted(name: string): ApiError {
  return new ApiError('trust_required', 'The workflow is not trusted yet.', {
    fix: `Run \`konductor flow trust ${name}\` in a terminal, then try again.`,
  });
}

function invalidWorkflow(check: CheckResult): ApiError {
  return new ApiError('invalid_workflow', 'The workflow has errors.', {
    diagnostics: check.diagnostics,
  });
}
