// SPDX-License-Identifier: Apache-2.0
import Button from '@cloudscape-design/components/button';
import type { DraftStatus } from '../designer-view/yaml-draft';
import {
  saveBlocker,
  saveStatus,
  type EditState,
  type SaveStatusKind,
} from '../designer/core';
import { plainText } from '../workflow/message-parts';
import { ModeSwitch, type PageView } from './ModeSwitch';

const CHECK_WORDS: Readonly<Record<DraftStatus, string>> = {
  unchecked: 'Not checked yet',
  waiting: 'Waiting to check',
  checking: 'Checking',
  valid: 'Flow valid',
  invalid: 'Flow needs fixes',
  failed: 'Check failed',
};

/** The check state shown beside the workflow state. */
export interface FlowCheckPill {
  status: DraftStatus;
  failure?: string;
}

function workflowTone(kind: SaveStatusKind): string {
  if (kind === 'warning') return 'unsaved';
  if (kind === 'in-progress') return 'saving';
  return 'saved';
}

function workflowState(
  state: EditState,
  running: boolean,
): { text: string; tone: string } {
  if (running) return { text: 'Running', tone: 'running' };
  const status = saveStatus(state);
  return { text: status.text, tone: workflowTone(status.kind) };
}

function checkTone(status: DraftStatus): string {
  if (status === 'valid') return 'valid';
  if (status === 'invalid' || status === 'failed') return 'invalid';
  return 'pending';
}

/** Design and Run controls shown on the right of the page header. */
export function PageHeaderActions<Id extends string>({
  views,
  active,
  state,
  running,
  check,
  focusRequest,
  onView,
  onSave,
}: {
  views: readonly PageView<Id>[];
  active: Id;
  state?: EditState;
  running: boolean;
  check: FlowCheckPill;
  focusRequest?: number;
  onView: (view: Id) => void;
  onSave: () => void;
}) {
  const blocker = state ? saveBlocker(state) : undefined;
  const workflow = state ? workflowState(state, running) : undefined;
  return (
    <div className="wf-page-actions">
      <ModeSwitch
        ariaLabel="Workflow canvas views"
        views={views}
        active={active}
        focusRequest={focusRequest}
        onChange={onView}
      />
      {state && workflow && (
        <>
          <span
            className="wf-state-pill"
            role="status"
            aria-live="polite"
            data-testid="save-status"
            data-state={workflow.tone}
          >
            {workflow.text}
          </span>
          <span
            className="wf-check-pill"
            data-testid="yaml-check-status"
            data-check={checkTone(check.status)}
          >
            {check.failure ?? CHECK_WORDS[check.status]}
          </span>
          {active === views[0]?.id && (
            <Button
              variant="primary"
              disabled={blocker !== undefined}
              disabledReason={
                blocker === undefined ? undefined : plainText(blocker)
              }
              loading={state.save.phase === 'saving'}
              onClick={onSave}
            >
              Save
            </Button>
          )}
        </>
      )}
    </div>
  );
}
