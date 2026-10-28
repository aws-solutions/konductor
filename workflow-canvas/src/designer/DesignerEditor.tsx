// SPDX-License-Identifier: Apache-2.0
import Button from '@cloudscape-design/components/button';
import type { InputProps } from '@cloudscape-design/components/input';
import Alert from '@cloudscape-design/components/alert';
import { useCallback, useMemo, useRef, useState } from 'react';
import { WorkflowGraphCard } from '../canvas/WorkflowGraphCard';
import type { CanvasSelection } from '../canvas/WorkflowCanvas';
import { stageNodeId } from '../graph';
import {
  canAddStage,
  canEdit,
  changeBlocker,
  MAX_STAGES,
  nextStageName,
  READ_ONLY_REASON,
} from './core';
import '../execution/announcements.css';
import './designer.css';
import { EditAlerts, RewriteNotice } from './EditAlerts';
import { PropertiesPane } from './PropertiesPane';
import { SaveControls } from './SaveControls';
import { useFocusRequest, useFocusWhenDone } from './use-focus';
import type { Editor } from './use-editor';

const STAGE_LIMIT = `A workflow has at most ${MAX_STAGES} stages.`;

// The words for a screen reader. Each call gets a new element, so a repeated
// sentence, such as selecting the same stage twice, is read again.
function useAnnouncer(): [
  { text: string; count: number },
  (text: string) => void,
] {
  const [announcement, set] = useState({ text: '', count: 0 });
  const announce = useCallback(
    (text: string) => set((last) => ({ text, count: last.count + 1 })),
    [],
  );
  return [announcement, announce];
}

/**
 * The editable Designer: the graph with Add stage and Save, Properties for the
 * selected stage, and the alerts. Focus goes to the name of a stage after it
 * is added, selected or deleted, and after the file is loaded again, so the
 * keyboard never loses its place.
 */
export function DesignerEditor({
  editor,
  harness,
}: {
  editor: Editor;
  harness: string;
}) {
  const { state } = editor;
  const nameRef = useRef<InputProps.Ref>(null);
  const focusName = useFocusRequest(nameRef);
  useFocusWhenDone(
    nameRef,
    state.save.phase === 'reloading',
    state.save.phase === 'reloaded',
  );

  const spec = useMemo(
    () => ({
      name: state.saved.view.name,
      intent: state.saved.view.intent,
      stages: state.draft.stages,
    }),
    [state.saved.view, state.draft.stages],
  );
  const [announcement, announce] = useAnnouncer();
  const { select } = editor;
  const selection = useMemo<CanvasSelection>(
    () => ({
      selectedId: stageNodeId(state.selectedId),
      onSelect: (nodeId) => {
        const stage = state.draft.stages.find(
          (candidate) => stageNodeId(candidate.id) === nodeId,
        );
        if (!stage) return;
        select(stage.id);
        focusName();
        announce(`Stage ${stage.name || 'with no name'} selected.`);
      },
    }),
    [state.selectedId, state.draft.stages, select, focusName, announce],
  );

  const editable = canEdit(state);
  const blocker = changeBlocker(state);
  const addable = blocker === undefined && canAddStage(state.draft);
  return (
    <div>
      <div
        className="wf-visually-hidden"
        role="status"
        data-testid="designer-live"
      >
        <span key={announcement.count}>{announcement.text}</span>
      </div>
      <EditAlerts state={state} onReload={editor.reload} />
      {editable && <RewriteNotice text={state.saved.text} />}
      {!editable && (
        <Alert type="info" data-testid="read-only-note">
          {READ_ONLY_REASON} You can look at the stages and select one, but not
          change them.
        </Alert>
      )}
      <div className="wf-designer">
        <WorkflowGraphCard
          view={spec}
          harness={harness}
          selection={selection}
          readOnly={!editable}
          actions={<SaveControls state={state} onSave={editor.save} />}
          toolbar={
            <Button
              iconName="add-plus"
              disabled={!addable}
              disabledReason={blocker ?? STAGE_LIMIT}
              onClick={() => {
                const name = nextStageName(state.draft);
                editor.add();
                focusName();
                announce(`Stage ${name} added and selected.`);
              }}
            >
              Add stage
            </Button>
          }
        />
        <PropertiesPane
          state={state}
          nameRef={nameRef}
          onRename={editor.rename}
          onAgent={editor.setAgent}
          onRemove={(id) => {
            const stage = state.draft.stages.find((s) => s.id === id);
            editor.remove(id);
            focusName();
            announce(`Stage ${stage?.name || 'with no name'} deleted.`);
          }}
        />
      </div>
    </div>
  );
}
