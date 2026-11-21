// SPDX-License-Identifier: Apache-2.0

/**
 * Where starting a run is. A run that is `going` is the one the view
 * follows; `joined` means the server already had it, so its goal is not the
 * text in the Goal box. `unsure` is a start whose outcome the server did not
 * report: a run may be going, so the view offers a reload instead of a
 * second start.
 */
export type RunStart =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | {
      readonly kind: 'going';
      readonly runId: string;
      readonly joined: boolean;
    }
  | { readonly kind: 'unsure'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

/** The run the view follows, or `undefined` when there is none. */
export function followedRunId(start: RunStart): string | undefined {
  return start.kind === 'going' ? start.runId : undefined;
}

/**
 * Whether the Goal box holds the goal of the run that is followed, so it
 * shows that goal and the Run button judges it. A run that was already going
 * owns the box only while it goes on: once it has ended, the box goes back to
 * the goal of the next run, which the person can read and change, so the box
 * and the Run button never judge different text.
 */
export function goalIsOfThisRun(
  start: RunStart,
  runFinished: boolean,
): boolean {
  return start.kind !== 'going' || !start.joined || runFinished;
}

/**
 * Whether Run can be pressed: no start is in flight, no run is being
 * followed unless it has ended, the outcome of the last start is known, and
 * the goal is one the API takes.
 */
export function canStartRun({
  start,
  runFinished,
  goalProblem,
}: {
  readonly start: RunStart;
  /** True once the run that is followed has ended. */
  readonly runFinished: boolean;
  /** Why the goal cannot be sent, from `goalProblem`. */
  readonly goalProblem: string | undefined;
}): boolean {
  if (goalProblem !== undefined) return false;
  switch (start.kind) {
    case 'idle':
    case 'failed':
      return true;
    case 'going':
      return runFinished;
    case 'starting':
    case 'unsure':
      return false;
  }
}

/** Why Run cannot be pressed, as a sentence, or `undefined` when it can. */
export function startDisabledReason({
  start,
  runFinished,
  goalProblem,
}: {
  readonly start: RunStart;
  readonly runFinished: boolean;
  readonly goalProblem: string | undefined;
}): string | undefined {
  if (canStartRun({ start, runFinished, goalProblem })) return undefined;
  if (start.kind === 'starting') return 'The run is starting.';
  // A run that has ended is not in the way: what is left is the next goal.
  if (start.kind === 'going' && !runFinished) return 'A run is in progress.';
  if (start.kind === 'unsure') {
    return 'It is not known whether the last run started. Reload the page.';
  }
  return goalProblem;
}

/** What went wrong with a start, for the alert under the button. */
export interface StartNotice {
  readonly header: string;
  readonly message: string;
}

const UNSURE_FIX =
  'Reload the page to see whether it is going; starting another run may run the workflow twice.';

/** The notice to show for `start`, or `undefined` when there is nothing to say. */
export function startNotice(start: RunStart): StartNotice | undefined {
  if (start.kind === 'failed') {
    return { header: 'The run did not start.', message: start.message };
  }
  if (start.kind === 'unsure') {
    return {
      header: 'It is not known whether the run started.',
      message: `${start.message} ${UNSURE_FIX}`,
    };
  }
  return undefined;
}

/*
 * The Goal box is one line, so a line break in the workflow's default goal
 * becomes a space and the person reads what the run is given. The Execution
 * tab's `use-goal.ts` follows the same rule for the outcome of the intent;
 * it is tied to a load result, so it cannot serve a declared default.
 */
function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ');
}

/**
 * The text of the Goal box: what the person typed, or the workflow's default
 * goal on one line until they type. An empty box the person cleared stays
 * empty, because `typed` is then the empty string, not `undefined`.
 */
export function goalText(
  typed: string | undefined,
  declared: string | undefined,
): string {
  return typed ?? oneLine(declared ?? '');
}

/** What a key press tells the Goal box, as the browser reports it. */
export interface GoalKey {
  readonly key: string;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

/**
 * Whether a key press in the Goal box asks for the run to start: Enter on its
 * own. Enter with Alt, Ctrl, Cmd or Shift is another command, or a line break
 * in a box that takes one, so it starts nothing. The Enter that ends typing
 * in another script starts nothing either: Safari reports it with
 * `isComposing` false and the key code 229, so both are checked, as the
 * Execution tab's box does.
 */
export function startsOnEnter(key: GoalKey): boolean {
  if (key.altKey || key.ctrlKey || key.metaKey || key.shiftKey) return false;
  return key.key === 'Enter' && !key.isComposing && key.keyCode !== 229;
}

/**
 * Which workflow a typed goal belongs to: the calls of its session and the
 * default goal it declares. The text a person types is for that workflow
 * only, so another one starts from its own default.
 */
export interface GoalSource {
  readonly start: unknown;
  readonly list: unknown;
  readonly goalDefault: string | undefined;
}

/** Whether two goal sources are the same workflow. */
export function sameGoalSource(
  a: GoalSource | undefined,
  b: GoalSource,
): boolean {
  return (
    a !== undefined &&
    a.start === b.start &&
    a.list === b.list &&
    a.goalDefault === b.goalDefault
  );
}

/**
 * Where the run of the view is, for the page around it: whether a run would
 * be lost if the workflow were replaced, and the sentences to announce.
 */
export interface RunLifecycle {
  /** True while a run of this page is going, so a swap would lose it. */
  readonly active: boolean;
  /** Where the run is, as a sentence, or empty before there is one. */
  readonly status: string;
  /** Why the run could not be started or followed, if that happened. */
  readonly error?: string;
}

/** A page with no run yet. */
export const NO_RUN_LIFECYCLE: RunLifecycle = { active: false, status: '' };
