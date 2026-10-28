// SPDX-License-Identifier: Apache-2.0
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Textarea from '@cloudscape-design/components/textarea';
import { useState, type ReactNode } from 'react';
import type { Draft, EditState, Problem } from './core';
import {
  errorsOf,
  listedOf,
  notesOf,
  problemsOfDraft,
  textOf,
  willRewriteWhole,
} from './core';
import { MessageText } from '../workflow/MessageText';

const CONFLICT_TEXT =
  'The file was changed after this page loaded, so nothing was saved. Load it again to see it as it is now; that replaces the changes you made here.';

// What to call the stage of a problem: its name, or its place in the list when
// it has none, so that a line never starts with an empty word.
function stageLabel(draft: Draft, id: string | undefined): string | undefined {
  const index = draft.stages.findIndex((stage) => stage.id === id);
  if (index < 0) return undefined;
  return draft.stages[index]?.name || `Stage ${index + 1}`;
}

// A problem in words, led by the stage it is about when it is about one.
function lineOf(problem: Problem, draft: Draft): ReactNode {
  const label = stageLabel(draft, problem.stageId);
  const message = <MessageText text={problem.message} />;
  return label === undefined ? (
    message
  ) : (
    <>
      {label}: {message}
    </>
  );
}

// Puts the text on the clipboard. A page that may not, or has none, shows the
// text instead, so the changes can always be taken away.
function CopyVersion({ text }: { text: string }) {
  const [shown, setShown] = useState<'idle' | 'copied' | 'text'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setShown('copied');
    } catch {
      setShown('text');
    }
  };
  return (
    <>
      <Button onClick={() => void copy()}>Copy my version</Button>
      {shown === 'copied' && <div role="status">Copied.</div>}
      {shown === 'text' && (
        <Textarea
          readOnly
          value={text}
          rows={8}
          ariaLabel="My version of the workflow file"
        />
      )}
    </>
  );
}

function Conflict({
  problem,
  reloading,
  mine,
  onReload,
}: {
  problem: string | undefined;
  reloading: boolean;
  /** The text of the draft, which a reload replaces. */
  mine: string;
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
      <CopyVersion text={mine} />
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

function failureHeader(save: { uncertain?: true; sessionLost?: true }): string {
  if (save.sessionLost) return 'The session is lost';
  return save.uncertain
    ? 'The save did not finish'
    : 'The workflow was not saved';
}

/**
 * What went wrong with the file and the save, in one region that is always on
 * the page, so that the alert which appears in it is read out: a file that
 * changed (with the button to load it again), the file loaded again, and a
 * save that failed.
 */
export function EditAlerts({
  state,
  onReload,
}: {
  state: EditState;
  onReload: () => void;
}) {
  const { save } = state;
  return (
    <div role="alert" className="wf-edit-alerts" data-testid="edit-alerts">
      {(save.phase === 'conflict' || save.phase === 'reloading') && (
        <Conflict
          problem={save.phase === 'conflict' ? save.problem : undefined}
          reloading={save.phase === 'reloading'}
          mine={textOf(state)}
          onReload={onReload}
        />
      )}
      {state.discarded !== undefined && (
        <Alert
          type="info"
          header="The file was loaded again"
          data-testid="discarded"
        >
          Your changes were replaced by the file as it is now.
          <CopyVersion text={state.discarded} />
        </Alert>
      )}
      {save.phase === 'failed' && (
        <Alert type="error" header={failureHeader(save)}>
          {save.message}
        </Alert>
      )}
    </div>
  );
}

/**
 * The problems that the check found, in a region that is always on the page.
 * It sits under Properties, so that an alert which appears while the person
 * types does not move the field they are typing in.
 */
export function ProblemAlerts({ state }: { state: EditState }) {
  const { draft } = state;
  // Each problem is listed once, though a field may show it for two stages.
  const problems = listedOf(problemsOfDraft(state));
  const notes = notesOf(problems);
  return (
    <div role="alert" className="wf-problem-alerts">
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
