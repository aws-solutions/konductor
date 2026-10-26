// SPDX-License-Identifier: Apache-2.0
import type { DiagnosticView } from '../../api/types';
import type { Draft, DraftStage } from './draft';

/** A field of a stage that the Designer edits. */
export type StageField = 'name' | 'agent';

/** A finding of the check, with the stage and field it is about, if any. */
export interface Problem {
  message: string;
  /** The stage it is about; `undefined` for a finding about the whole text. */
  stageId?: string;
  field?: StageField;
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

/** Turns the findings of a check into problems of the stages of the draft. */
export function problemsOf(
  diagnostics: readonly DiagnosticView[],
  draft: Draft,
): Problem[] {
  return diagnostics.map(({ message, path }) => ({
    message,
    ...targetOf(path, draft),
  }));
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

/** The messages about one field of one stage. */
export function problemsFor(
  problems: readonly Problem[],
  stageId: string,
  field: StageField,
): string[] {
  return problems
    .filter((p) => p.stageId === stageId && p.field === field)
    .map((p) => p.message);
}

/** Whether any finding stops the workflow from being saved. */
export function hasErrors(diagnostics: readonly DiagnosticView[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}
