// SPDX-License-Identifier: Apache-2.0
import type { DiagnosticView, Severity } from '../../api/types';
import type { Draft, DraftStage } from './draft';

/** A field of a stage that the Designer edits. */
export type StageField = 'name' | 'agent';

/** A finding of the check, with the stage and field it is about, if any. */
export interface Problem {
  message: string;
  /** How serious it is; only an `error` stops a save. */
  severity: Severity;
  /** The stage it is about; `undefined` for a finding about the whole text. */
  stageId?: string;
  field?: StageField;
  /**
   * Set on a copy of the problem of a later stage with the same name. The
   * server reports a name that two stages share on the later one only, so the
   * copy marks the field of the earlier one too. A list of problems leaves
   * the copies out; see `listedOf`.
   */
  echo?: true;
}

const BY_INDEX = /^stages\[(\d+)\]\.(name|agent)$/;
const BY_NAME = /^stages\.([^.[\]]+)\.(name|agent)$/;

function aim(
  stage: DraftStage | undefined,
  field: string | undefined,
): { stageId: string; field: StageField } | undefined {
  return stage && (field === 'name' || field === 'agent')
    ? { stageId: stage.id, field }
    : undefined;
}

// The stage and field that a path names, by place in the list or by name.
function targetOf(
  path: string,
  draft: Draft,
): { stageId: string; field: StageField } | undefined {
  const index = BY_INDEX.exec(path);
  if (index) return aim(draft.stages[Number(index[1])], index[2]);
  const named = BY_NAME.exec(path);
  if (!named) return undefined;
  return aim(
    draft.stages.find((stage) => stage.name === named[1]),
    named[2],
  );
}

// The copies of the name problems of a stage for the earlier stages that have
// the same name and no name problem of their own.
function echoesOf(problems: readonly Problem[], draft: Draft): Problem[] {
  const named = problems.filter((problem) => problem.field === 'name');
  const marked = new Set(named.map((problem) => problem.stageId));
  return named.flatMap((problem) => {
    const at = draft.stages.findIndex(({ id }) => id === problem.stageId);
    const name = draft.stages[at]?.name;
    const earlier = draft.stages
      .slice(0, Math.max(at, 0))
      .find((stage) => stage.name === name && !marked.has(stage.id));
    return earlier
      ? [{ ...problem, stageId: earlier.id, echo: true as const }]
      : [];
  });
}

/**
 * Turns the findings of a check into problems of the stages of the draft. A
 * name problem is copied to the stages that share the name (see `Problem.echo`).
 */
export function problemsOf(
  diagnostics: readonly DiagnosticView[],
  draft: Draft,
): Problem[] {
  const problems: Problem[] = diagnostics.map(
    ({ message, path, severity }) => ({
      message,
      severity,
      ...targetOf(path, draft),
    }),
  );
  return [...problems, ...echoesOf(problems, draft)];
}

/** The problems without the copies, for a list that says each problem once. */
export function listedOf(problems: readonly Problem[]): Problem[] {
  return problems.filter((problem) => !problem.echo);
}

/** The latest check: the revision it spoke for, and what it found. */
export interface Check {
  revision: number;
  diagnostics: readonly DiagnosticView[];
  /** The findings placed on the stages of the draft that was checked. */
  problems: readonly Problem[];
}

/** A check of `draft` at `revision`, with its findings placed on the stages. */
export function checkOf(
  revision: number,
  diagnostics: readonly DiagnosticView[],
  draft: Draft,
): Check {
  return { revision, diagnostics, problems: problemsOf(diagnostics, draft) };
}

/** The problems about one field of one stage. */
export function problemsFor(
  problems: readonly Problem[],
  stageId: string,
  field: StageField,
): Problem[] {
  return problems.filter((p) => p.stageId === stageId && p.field === field);
}

/** The problems that stop a save: the findings of severity `error`. */
export function errorsOf(problems: readonly Problem[]): Problem[] {
  return problems.filter((problem) => problem.severity === 'error');
}

/** The problems that do not stop a save: warnings and notes. */
export function notesOf(problems: readonly Problem[]): Problem[] {
  return problems.filter((problem) => problem.severity !== 'error');
}

/**
 * The messages of `problems`, each once, joined into one sentence, or
 * `undefined`.
 */
export function joinMessages(problems: readonly Problem[]): string | undefined {
  const messages = new Set(problems.map((problem) => problem.message));
  return [...messages].join(' ') || undefined;
}

/** Whether any finding stops the workflow from being saved. */
export function hasErrors(diagnostics: readonly DiagnosticView[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}
