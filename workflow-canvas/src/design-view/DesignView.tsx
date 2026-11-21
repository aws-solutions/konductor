// SPDX-License-Identifier: Apache-2.0
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator, {
  type StatusIndicatorProps,
} from '@cloudscape-design/components/status-indicator';
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { WorkflowCanvas, type CanvasSelection } from '../canvas/WorkflowCanvas';
import {
  DesignerLayout,
  type LayoutStage,
} from '../designer-view/DesignerLayout';
import type { StageFieldRule } from '../designer-view/field-rules';
import {
  useEditHistory,
  undoShortcut,
  type ShortcutKey,
} from '../designer-view/use-edit-history';
import { useYamlDraft } from '../designer-view/use-yaml-draft';
import type {
  CheckAnswer,
  DraftStatus,
  ValidatePort,
} from '../designer-view/yaml-draft';
import {
  canAddStage,
  KNOWN_AGENTS,
  MAX_STAGES,
  nextStageName,
  textOf,
} from '../designer/core';
import { SaveControls } from '../designer/SaveControls';
import type { Editor } from '../designer/use-editor';
import type { Scheduler } from '../execution/core/ports';
import { buildGraph, stageNodeId } from '../graph';
import '../execution/announcements.css';
import { FINDINGS_PER_PAGE, findingsPage, nextShown } from './findings';
import {
  SAVABLE_KEYS,
  fieldValuesOf,
  markedStageOf,
  saveRefusal,
  sourceStageOf,
} from './view-stage';
import { useInitialCheck } from './use-initial-check';
import { useStageSources, type StageSources } from './use-stage-sources';

/** The editable keys of a stage, by kind, as `stage_fields` gives them. */
export type StageFieldsByKind = Readonly<
  Record<string, readonly StageFieldRule[]>
>;

// The stages of the draft that differ from the stage of the file they were
// loaded from, by id. A stage the person added has no stage in the file, and
// counts as changed.
function changedStageIds(
  state: Editor['state'],
  sources: StageSources,
): ReadonlySet<string> {
  const saved = state.saved.view.stages;
  return new Set(
    state.draft.stages
      .filter((stage) => {
        const source = sources.of(stage.id);
        if (source.kind === 'added') return true;
        const was = saved[source.index];
        return (
          was === undefined ||
          was.name !== stage.name ||
          was.agent !== stage.agent
        );
      })
      .map((stage) => stage.id),
  );
}

const RAW_EDIT_NOTE =
  'The text under YAML is checked as the stages change, and it cannot be typed into here yet. Change a stage under Properties and press Save.';

const EARLIER_TEXT_NOTE =
  'YAML shows an earlier text. The drawing and Properties show the workflow as it is now, and a save writes that; press Redo to come back.';

const STATUS_WORDS: Readonly<Record<DraftStatus, string>> = {
  unchecked: 'Not checked yet',
  waiting: 'Waiting to check',
  checking: 'Checking',
  valid: 'The text is valid',
  invalid: 'The text has problems',
  failed: 'The text could not be checked',
};

const STATUS_KIND: Readonly<Record<DraftStatus, StatusIndicatorProps.Type>> = {
  unchecked: 'pending',
  waiting: 'pending',
  checking: 'in-progress',
  valid: 'success',
  invalid: 'warning',
  failed: 'error',
};

const count = (n: number) => n.toLocaleString('en-US');

/**
 * What the check found wrong with the text, worst first. A text may hold
 * thousands of findings, so `findingsPage` gives a page of them at a time and
 * the list says how many are left.
 */
function Findings({ answer }: { answer: CheckAnswer | undefined }) {
  const [shown, setShown] = useState(FINDINGS_PER_PAGE);
  const { page, left, more } = findingsPage(answer, shown);
  if (page.length === 0) return null;
  return (
    <Alert
      type="warning"
      header="The text has problems."
      data-testid="yaml-problems"
    >
      <ul>
        {page.map((finding, index) => (
          <li key={`${finding.line}-${finding.code}-${index}`}>
            Line {finding.line}: {finding.message}
          </li>
        ))}
      </ul>
      {left > 0 && (
        <p data-testid="yaml-problems-left">
          {count(left)} more {left === 1 ? 'problem' : 'problems'}.{' '}
          {more > 0 ? (
            <Button
              variant="inline-link"
              onClick={() => setShown(nextShown(shown))}
            >
              Show {count(more)} more
            </Button>
          ) : (
            'Fix these and check again to see the rest.'
          )}
        </p>
      )}
    </Alert>
  );
}

function CheckLine({
  status,
  failure,
}: {
  status: DraftStatus;
  failure: string | undefined;
}) {
  return (
    <div data-testid="yaml-check-status">
      <StatusIndicator type={STATUS_KIND[status]}>
        {failure ?? STATUS_WORDS[status]}
      </StatusIndicator>
    </div>
  );
}

// React's keyboard event does not carry `isComposing`; the browser's does.
function shortcutKeyOf(event: KeyboardEvent): ShortcutKey {
  return {
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    repeat: event.repeat,
    isComposing: event.nativeEvent.isComposing,
    keyCode: event.keyCode,
  };
}

/**
 * The Design view: the drawing in the middle, the components on the left,
 * and a side column with the text of the workflow and the keys of the stage
 * that is picked. Each leaf stage of the drawing ends in a stop mark.
 *
 * The stages are edited through the editor that the page already holds, and
 * a save writes its text. The text itself cannot be typed into yet, because
 * the editor has no way to take a whole text, so the YAML tab checks the
 * text and shows what is wrong with it. Undo and redo step through the texts
 * of this session and show them; the workflow changes only through the keys
 * of a stage.
 */
export function DesignView({
  editor,
  harness,
  validate,
  scheduler,
  stageFields = {},
  agents = KNOWN_AGENTS,
}: {
  editor: Editor;
  /** The harness that runs the stages, shown on each stage. */
  harness: string;
  /** Checks a text, as `POST /api/validate` does. */
  validate: ValidatePort;
  /** Waits between a change and the check of the text. */
  scheduler: Scheduler;
  /** The keys a stage of each kind may have, from `stage_fields`. */
  stageFields?: StageFieldsByKind;
  /** The agents to offer for the `agent` key. */
  agents?: readonly { readonly id: string; readonly summary: string }[];
}) {
  const { state } = editor;
  const headingId = useId();
  const savedText = state.saved.text;
  const text = useMemo(() => textOf(state), [state]);
  const history = useEditHistory(savedText);
  const draft = useYamlDraft({
    initialText: savedText,
    name: state.saved.name,
    baseHash: state.saved.hash,
    validate,
    scheduler,
  });
  const { record } = history;
  const { edit } = draft;
  // The draft opens its text unchecked, so the keys of a stage are read from
  // a check of the file as it was loaded, and where each stage of the draft
  // came from in that same file is read beside it.
  const opened = useInitialCheck({
    text: savedText,
    name: state.saved.name,
    validate,
  });
  const sources = useStageSources({
    text: savedText,
    stages: state.draft.stages,
  });
  // A change of the stages makes a text; the text shown is the one the
  // history points at, and that is the text the check reads.
  useEffect(() => record(text), [record, text]);
  useEffect(() => edit(history.text), [edit, history.text]);

  const answer = draft.answer;
  const checked = answer?.view ? answer : (draft.lastGood ?? opened.answer);
  const spec = useMemo(
    () => ({
      name: state.saved.view.name,
      intent: state.saved.view.intent,
      stages: state.draft.stages,
    }),
    [state.saved.view, state.draft.stages],
  );
  const graph = useMemo(
    () => buildGraph(spec, harness, { stopMarks: true }),
    [spec, harness],
  );
  const { select } = editor;
  const selection = useMemo<CanvasSelection>(
    () => ({
      selectedId: stageNodeId(state.selectedId),
      onSelect: (nodeId) => {
        const stage = state.draft.stages.find(
          (candidate) => stageNodeId(candidate.id) === nodeId,
        );
        if (stage) select(stage.id);
      },
    }),
    [state.selectedId, state.draft.stages, select],
  );

  const picked = state.draft.stages.find(
    (stage) => stage.id === state.selectedId,
  );
  const pickedPlace = picked && {
    name: picked.name,
    index: state.draft.stages.indexOf(picked),
    total: state.draft.stages.length,
  };
  // The keys of the picked stage come from the check of the file as it was
  // loaded: that is what the file holds, and a save of a changed stage would
  // drop whatever the editor cannot write. The stage is taken from the place
  // it was loaded from, which a rename or another stage being added or
  // deleted does not move.
  const fileView = opened.answer?.view ?? null;
  const viewStage = picked
    ? sourceStageOf(fileView, sources.of(picked.id))
    : undefined;
  const values = picked ? fieldValuesOf(viewStage, picked) : {};
  const kindOf = typeof viewStage?.kind === 'string' ? viewStage.kind : 'agent';
  const rules = stageFields[kindOf] ?? [];
  // Only the name and the agent go through the editor; every other key is
  // shown as the file has it, until the stage writer can keep them.
  const readOnlyKeys = rules
    .map((rule) => rule.key)
    .filter((key) => !SAVABLE_KEYS.includes(key));
  const stage: LayoutStage | undefined = picked && {
    name: picked.name,
    rules,
    values,
    originalAgent: picked.agent,
    readOnlyKeys,
  };
  // A save of a changed stage that has other keys in the file would drop
  // them, so it is refused until the writer keeps them. A stage whose keys
  // are not known yet is refused too, rather than saved in the dark.
  const changed = changedStageIds(state, sources);
  const refusal = saveRefusal(
    state.draft.stages.map((one) => ({
      draft: one,
      source: sources.of(one.id),
      changed: changed.has(one.id),
    })),
    fileView,
  );

  const onKeyDown = (event: KeyboardEvent) => {
    const asked = undoShortcut(shortcutKeyOf(event));
    if (asked === undefined) return;
    event.preventDefault();
    if (asked === 'undo') history.undo();
    else history.redo();
  };

  const marked = pickedPlace
    ? markedStageOf(checked?.view, pickedPlace)
    : undefined;
  const showingEarlier = history.text !== text;

  return (
    <section
      className="wf-design-view"
      aria-labelledby={headingId}
      onKeyDown={onKeyDown}
    >
      <h2 className="wf-visually-hidden" id={headingId}>
        Design
      </h2>
      <SpaceBetween size="m">
        <Alert type="info" data-testid="raw-edit-note">
          {RAW_EDIT_NOTE}
        </Alert>
        {showingEarlier && (
          <Alert type="warning" data-testid="earlier-text-note">
            {EARLIER_TEXT_NOTE}
          </Alert>
        )}
        {refusal !== undefined && (
          <Alert type="warning" data-testid="save-refused">
            {refusal}
          </Alert>
        )}
        {opened.reading && (
          <div data-testid="reading-keys">
            <StatusIndicator type="loading">
              Reading the keys of each stage
            </StatusIndicator>
          </div>
        )}
        {opened.failure !== undefined && (
          <Alert type="warning" data-testid="reading-keys-failed">
            {opened.failure} Only the name and the agent of a stage are shown.
          </Alert>
        )}
        <CheckLine status={draft.status} failure={draft.failure} />
        <Findings answer={answer} />
        <DesignerLayout
          drawing={<WorkflowCanvas graph={graph} selection={selection} />}
          yaml={{
            file: state.saved.name,
            text: history.text,
            ...(marked ? { stage: marked } : {}),
          }}
          stage={stage}
          agents={agents}
          onStageChange={({ values: next }) => {
            if (!picked) return;
            const name = next.name ?? '';
            const agent = next.agent ?? '';
            if (name !== picked.name) editor.rename(picked.id, name);
            if (agent !== picked.agent) editor.setAgent(picked.id, agent);
          }}
        >
          <SpaceBetween size="s">
            <SaveControls
              state={state}
              onSave={() => {
                if (refusal === undefined) editor.save();
              }}
            />
            <Button
              iconName="add-plus"
              disabled={!canAddStage(state.draft)}
              disabledReason={`A workflow has at most ${MAX_STAGES} stages.`}
              onClick={() => editor.add()}
            >
              Add {nextStageName(state.draft)}
            </Button>
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                iconName="undo"
                disabled={!history.canUndo}
                onClick={history.undo}
              >
                Undo
              </Button>
              <Button
                iconName="redo"
                disabled={!history.canRedo}
                onClick={history.redo}
              >
                Redo
              </Button>
            </SpaceBetween>
          </SpaceBetween>
        </DesignerLayout>
      </SpaceBetween>
    </section>
  );
}
