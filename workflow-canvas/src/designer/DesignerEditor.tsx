// SPDX-License-Identifier: Apache-2.0
import Button from '@cloudscape-design/components/button';
import type { InputProps } from '@cloudscape-design/components/input';
import { useMemo, useRef } from 'react';
import { WorkflowGraphCard } from '../canvas/WorkflowGraphCard';
import type { CanvasSelection } from '../canvas/WorkflowCanvas';
import { stageNodeId } from '../graph';
import { canAddStage, canEdit, MAX_STAGES, READ_ONLY_REASON } from './core';
import './designer.css';
import { EditAlerts, RewriteNotice } from './EditAlerts';
import { PropertiesPane } from './PropertiesPane';
import { SaveControls } from './SaveControls';
import { useFocusRequest, useFocusWhenDone } from './use-focus';
import type { Editor } from './use-editor';

const STAGE_LIMIT = `A workflow has at most ${MAX_STAGES} stages.`;

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
      },
    }),
    [state.selectedId, state.draft.stages, select, focusName],
  );

  const editable = canEdit(state);
  const addable = editable && canAddStage(state.draft);
  return (
    <div>
      <EditAlerts state={state} onReload={editor.reload} />
      <RewriteNotice text={state.saved.text} />
      <div className="wf-designer">
        <WorkflowGraphCard
          view={spec}
          harness={harness}
          selection={selection}
          actions={<SaveControls state={state} onSave={editor.save} />}
          toolbar={
            <Button
              iconName="add-plus"
              disabled={!addable}
              disabledReason={editable ? STAGE_LIMIT : READ_ONLY_REASON}
              onClick={() => {
                editor.add();
                focusName();
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
            editor.remove(id);
            focusName();
          }}
        />
      </div>
    </div>
  );
}
