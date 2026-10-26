// SPDX-License-Identifier: Apache-2.0
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import type { Draft, EditState, Problem } from './core';
import { problemsOfDraft } from './core';

const CONFLICT_TEXT =
  'The file was changed after this page loaded, so nothing was saved. Load it again to see it as it is now. The changes you made here are lost.';

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

function Problems({ problems, draft }: { problems: Problem[]; draft: Draft }) {
  return (
    <Alert
      type="error"
      header="The workflow has problems"
      data-testid="problems"
    >
      <ul aria-label="Problems in the workflow">
        {problems.map((problem, index) => (
          <li key={`${index}:${problem.message}`}>{lineOf(problem, draft)}</li>
        ))}
      </ul>
    </Alert>
  );
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
  const problems = problemsOfDraft(state);
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
      {problems.length > 0 && <Problems problems={problems} draft={draft} />}
    </div>
  );
}
