// SPDX-License-Identifier: Apache-2.0
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator, {
  type StatusIndicatorProps,
} from '@cloudscape-design/components/status-indicator';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
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
  fileBlocker,
  KNOWN_AGENTS,
  MAX_STAGES,
  nextStageName,
  textOf,
  writeBlocker,
} from '../designer/core';
import { EditAlerts } from '../designer/EditAlerts';
import { SaveControls } from '../designer/SaveControls';
import type { Editor } from '../designer/use-editor';
import type { LoadedWorkflow } from '../workflow/load-workflow';
import type { Scheduler } from '../execution/core/ports';
import { buildGraph, stageNodeId } from '../graph';
import '../execution/announcements.css';
import { FINDINGS_PER_PAGE, findingsPage, nextShown } from './findings';
import {
  SAVABLE_KEYS,
  fieldValuesOf,
  markedStageOf,
  sourceStageOf,
} from './view-stage';
import { useInitialCheck } from './use-initial-check';
import { useStageSources } from './use-stage-sources';

/** The editable keys of a stage, by kind, as `stage_fields` gives them. */
export type StageFieldsByKind = Readonly<
  Record<string, readonly StageFieldRule[]>
>;

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
 * of a stage. Those texts belong to the load in `loaded`: another load is
 * another workflow, and the history starts over for it.
 */
export function DesignView({
  editor,
  loaded,
  harness,
  validate,
  scheduler,
  stageFields = {},
  agents = KNOWN_AGENTS,
}: {
  editor: Editor;
  /**
   * The load the editor was opened with, read by its identity alone: another
   * one is another workflow, whatever its name, its hash or its text, and the
   * undo history starts over for it.
   */
  loaded: LoadedWorkflow;
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
  // The text a save would write. A draft the writer cannot write in place has
  // none: `refusal` then says why, Save is shut, and the pane shows the file
  // as it stands rather than a text no save could produce.
  const written = useMemo(() => textOf(state), [state]);
  const text = written ?? savedText;
  // The text the save in flight sent, kept so a later edit does not change
  // what the places of the stages are read for.
  const [sent, setSent] = useState<string>();
  const history = useEditHistory(savedText);
  const draft = useYamlDraft({
    initialText: savedText,
    name: state.saved.name,
    baseHash: state.saved.hash,
    validate,
    scheduler,
  });
  const { record, reset } = history;
  const { edit } = draft;
  // The history holds the texts of one draft, so it is of the load that
  // opened that draft. The load the page hands over says which: a save gives
  // the next version of the same file under the same load, and the file
  // loaded again stays under it too, while another workflow is another load
  // and the texts of the one before it are gone with its draft. The name, the
  // hash and the text cannot stand in for it, because two workflows can hold
  // the same bytes under the same name.
  const held = useRef(loaded);
  useEffect(() => {
    if (held.current === loaded) return;
    held.current = loaded;
    reset(savedText);
  }, [loaded, savedText, reset]);
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
    draft: state.draft,
    // The text of the save in flight, which is about to become the file. The
    // editor takes edits while it is in flight, so the places of the stages
    // must come from the draft that sent it, not from the one on the page
    // when its answer arrives.
    ...(state.save.phase === 'saving' && sent !== undefined
      ? { submitted: sent }
      : {}),
  });
  // A change of the stages makes a text; the text shown is the one the
  // history points at, and that is the text the check reads. A draft with no
  // text a save could write records nothing: the history holds texts a save
  // can write, so undo always lands on one.
  useEffect(() => {
    if (written !== undefined) record(written);
  }, [record, written]);
  useEffect(() => edit(history.text), [edit, history.text]);

  const answer = draft.answer;
  // The view of the text as it is now, when a check of it has answered with
  // one. Anything else is a view of an earlier text, which names the stages
  // of this draft only while no stage was added, deleted or moved since.
  const ofNow = answer?.view ? answer : undefined;
  const checked = ofNow ?? draft.lastGood ?? opened.answer;
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
  // Counts the times a stage has been chosen in the drawing, so the side
  // column opens its keys each time, as the drawing says it will.
  const [opens, setOpens] = useState(0);
  const selection = useMemo<CanvasSelection>(
    () => ({
      selectedId: stageNodeId(state.selectedId),
      onSelect: (nodeId) => {
        const stage = state.draft.stages.find(
          (candidate) => stageNodeId(candidate.id) === nodeId,
        );
        if (!stage) return;
        select(stage.id);
        setOpens((count) => count + 1);
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
    // The agent the file names, which stays on offer even when the list of
    // agents does not have it; `values` holds the one chosen since.
    originalAgent:
      typeof viewStage?.agent === 'string' ? viewStage.agent : picked.agent,
    readOnlyKeys,
  };
  // A file the writer cannot edit in place at all is refused before any
  // change is made; a draft it cannot write is refused as it stands. Both
  // reasons come from the writer itself, through the editor's own state, so
  // the view never carries a second model of what a save would keep.
  const refusal = fileBlocker(state) ?? writeBlocker(state);

  const onKeyDown = (event: KeyboardEvent) => {
    const asked = undoShortcut(shortcutKeyOf(event));
    if (asked === undefined) return;
    event.preventDefault();
    if (asked === 'undo') history.undo();
    else history.redo();
  };

  const marked = pickedPlace
    ? markedStageOf(checked?.view, pickedPlace, {
        stale: ofNow === undefined,
        sources: state.draft.stages.map((one) => sources.of(one.id)),
      })
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
          <Alert
            type="warning"
            data-testid="reading-keys-failed"
            action={<Button onClick={opened.checkAgain}>Check again</Button>}
          >
            {opened.failure} Only the name and the agent of a stage are shown,
            so the other keys of the file are not on the page. A save still
            keeps them.
          </Alert>
        )}
        <CheckLine status={draft.status} failure={draft.failure} />
        <EditAlerts state={state} onReload={editor.reload} />
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
          openProperties={opens}
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
                if (refusal !== undefined || written === undefined) return;
                setSent(written);
                editor.save();
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
