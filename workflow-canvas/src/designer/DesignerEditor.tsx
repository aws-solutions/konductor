// SPDX-License-Identifier: Apache-2.0
import Button from '@cloudscape-design/components/button';
import type { InputProps } from '@cloudscape-design/components/input';
import Alert from '@cloudscape-design/components/alert';
import { useMemo, useRef, useState } from 'react';
import { WorkflowGraphCard } from '../canvas/WorkflowGraphCard';
import type { CanvasSelection } from '../canvas/WorkflowCanvas';
import { stageNodeId } from '../graph';
import { canAddStage, canEdit, MAX_STAGES, READ_ONLY_REASON } from './core';
import '../execution/announcements.css';
import './designer.css';
import { PropertiesPane } from './PropertiesPane';
import { useFocusRequest } from './use-focus';
import type { Editor } from './use-editor';

const STAGE_LIMIT = `A workflow has at most ${MAX_STAGES} stages.`;

/**
 * The editable Designer: the graph with Add stage, and Properties for the
 * selected stage. Focus goes to the name of a stage after it is added,
 * selected or deleted, so the keyboard never loses its place.
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

  const spec = useMemo(
    () => ({
      name: state.saved.view.name,
      intent: state.saved.view.intent,
      stages: state.draft.stages,
    }),
    [state.saved.view, state.draft.stages],
  );
  const [announcement, announce] = useState('');
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
    [state.selectedId, state.draft.stages, select, focusName],
  );

  const editable = canEdit(state);
  const addable = editable && canAddStage(state.draft);
  return (
    <div className="wf-designer">
      <div
        className="wf-visually-hidden"
        role="status"
        data-testid="designer-live"
      >
        {announcement}
      </div>
      {!editable && (
        <Alert type="info" data-testid="read-only-note">
          {READ_ONLY_REASON} You can look at the stages and select one, but not
          change them.
        </Alert>
      )}
      <WorkflowGraphCard
        view={spec}
        harness={harness}
        selection={selection}
        readOnly={!editable}
        toolbar={
          <Button
            iconName="add-plus"
            disabled={!addable}
            disabledReason={editable ? STAGE_LIMIT : READ_ONLY_REASON}
            onClick={() => {
              editor.add();
              focusName();
              announce('Stage added and selected.');
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
  );
}
