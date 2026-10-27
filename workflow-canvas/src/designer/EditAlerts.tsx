// SPDX-License-Identifier: Apache-2.0
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import type { Draft, EditState, Problem } from './core';
import {
  errorsOf,
  listedOf,
  notesOf,
  problemsOfDraft,
  willRewriteWhole,
} from './core';

const CONFLICT_TEXT =
  'The file was changed after this page loaded, so nothing was saved. Load it again to see it as it is now; that replaces the changes you made here.';

function stageName(draft: Draft, id: string | undefined): string | undefined {
  return draft.stages.find((stage) => stage.id === id)?.name;
}

// A problem in words, led by the stage it is about when it is about one.
function lineOf(problem: Problem, draft: Draft): string {
  const name = stageName(draft, problem.stageId);
  return name === undefined ? problem.message : `${name}: ${problem.message}`;
}

function Conflict({
  problem,
  reloading,
  onReload,
}: {
  problem: string | undefined;
  reloading: boolean;
  onReload: () => void;
}) {
  return (
    <Alert
      type="warning"
      header="The file changed on disk"
      data-testid="conflict"
      action={
        <Button loading={reloading} onClick={onReload}>
          Load the file again
        </Button>
      }
    >
      {problem ?? CONFLICT_TEXT}
    </Alert>
  );
}

function ProblemList({
  problems,
  draft,
  type,
  header,
  testId,
}: {
  problems: Problem[];
  draft: Draft;
  type: 'error' | 'warning' | 'info';
  header: string;
  testId: string;
}) {
  if (problems.length === 0) return null;
  return (
    <Alert type={type} header={header} data-testid={testId}>
      <ul aria-label={header}>
        {problems.map((problem, index) => (
          <li key={`${index}:${problem.message}`}>{lineOf(problem, draft)}</li>
        ))}
      </ul>
    </Alert>
  );
}

// A note is a warning when any finding in it is one, and info otherwise.
function noteType(notes: Problem[]): 'warning' | 'info' {
  return notes.some((note) => note.severity === 'warning') ? 'warning' : 'info';
}

/**
 * What went wrong with the draft, in one region that is always on the page, so
 * that the alert which appears in it is read out: a file that changed (with
 * the button to load it again), a save that failed, and the problems that the
 * check found.
 */
export function EditAlerts({
  state,
  onReload,
}: {
  state: EditState;
  onReload: () => void;
}) {
  const { save, draft } = state;
  // Each problem is listed once, though a field may show it for two stages.
  const problems = listedOf(problemsOfDraft(state));
  const notes = notesOf(problems);
  return (
    <div role="alert" className="wf-edit-alerts">
      {(save.phase === 'conflict' || save.phase === 'reloading') && (
        <Conflict
          problem={save.phase === 'conflict' ? save.problem : undefined}
          reloading={save.phase === 'reloading'}
          onReload={onReload}
        />
      )}
      {save.phase === 'failed' && (
        <Alert type="error" header="The workflow was not saved">
          {save.message}
        </Alert>
      )}
      <ProblemList
        problems={errorsOf(problems)}
        draft={draft}
        type="error"
        header="The workflow has problems"
        testId="problems"
      />
      <ProblemList
        problems={notes}
        draft={draft}
        type={noteType(notes)}
        header="Notes on the workflow"
        testId="notes"
      />
    </div>
  );
}

/**
 * Says, before a save, that the file will be written in the plain layout
 * because its stages are not a block, which drops its comments and `version`.
 * It is a static note, not part of the live region.
 */
export function RewriteNotice({ text }: { text: string }) {
  if (!willRewriteWhole(text)) return null;
  return (
    <div className="wf-edit-notice">
      <Alert
        type="info"
        header="Saving rewrites this file"
        data-testid="rewrite-notice"
      >
        The stages of this file are not written as a list under{' '}
        <code>stages:</code>, so a save writes the whole file in the plain
        layout. Its comments and <code>version</code> are not kept.
      </Alert>
    </div>
  );
}
