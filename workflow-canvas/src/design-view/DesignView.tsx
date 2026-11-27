// SPDX-License-Identifier: Apache-2.0
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator, {
  type StatusIndicatorProps,
} from '@cloudscape-design/components/status-indicator';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
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
import type { DraftStatus, ValidatePort } from '../designer-view/yaml-draft';
import {
  canAddStage,
  canEdit,
  canRemoveStage,
  changeBlocker,
  fileBlocker,
  KNOWN_AGENTS,
  MAX_STAGES,
  nextStageName,
  promptFieldOf,
  rawTextOf,
  READ_ONLY_REASON,
  textBlocker,
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
import './design-view.css';
import {
  FINDINGS_PER_PAGE,
  findingsPage,
  mergeFindings,
  nextShown,
  type Finding,
} from './findings';
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

const EARLIER_TEXT_NOTE =
  'YAML shows an earlier version of the stage edits. The drawing and Properties show the current stage edits, which Save writes; press Redo to come back.';

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
function Findings({ diagnostics }: { diagnostics: readonly Finding[] }) {
  const [shown, setShown] = useState(FINDINGS_PER_PAGE);
  const { page, left, more } = findingsPage({ diagnostics }, shown);
  if (page.length === 0) return null;
  return (
    <Alert
      type="warning"
      header="The text has problems."
      data-testid="yaml-problems"
    >
      <ul>
        {page.map((finding, index) => (
          <li key={`${finding.line}-${finding.path}-${index}`}>
            {finding.line === undefined
              ? finding.message
              : `Line ${finding.line}: ${finding.message}`}
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

function shortcutKeyOf(event: globalThis.KeyboardEvent): ShortcutKey {
  return {
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    repeat: event.repeat,
    isComposing: event.isComposing,
    keyCode: event.keyCode,
  };
}

/**
 * The Design view: the drawing in the middle, the components on the left,
 * and a side column with the text of the workflow and the keys of the stage
 * that is picked. Each leaf stage of the drawing ends in a stop mark.
 *
 * The stages are edited through the editor that the page already holds, and
 * a save writes its text. The text under YAML can also be typed over, which
 * goes to the editor as one raw edit: a save then writes that text as it
 * stands, on the same base hash and with the same conflict rules, and the
 * keys of a stage are read-only until it is saved or the file is loaded
 * again, because the stages on the page describe the file and not the text
 * typed over it. Undo and redo through a raw edit adopt the text they show,
 * so the editor and Save use that text too. Undo and redo through stage edits
 * can show an earlier text while the current stages stay in the editor. Those
 * texts belong to the load in `loaded`: another load is another workflow, and
 * the history starts over for it.
 */
export function DesignView({
  editor,
  loaded,
  harness,
  validate,
  scheduler,
  stageFields = {},
  agents = KNOWN_AGENTS,
  submittedText,
  controlsInPageHeader = false,
  onCheckChange,
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
  /** The text sent by the Save control in the page header. */
  submittedText?: string;
  /** Moves the save and check controls into the page header. */
  controlsInPageHeader?: boolean;
  /** Reports the flow check shown in the page header. */
  onCheckChange?: (status: DraftStatus, failure: string | undefined) => void;
}) {
  const { state } = editor;
  const headingId = useId();
  const savedText = state.saved.text;
  // The text a save would write. A draft the writer cannot write in place has
  // none: `refusal` then says why, Save is shut, and the pane shows the file
  // as it stands rather than a text no save could produce.
  const written = useMemo(() => textOf(state), [state]);
  const text = written ?? savedText;
  const rawText = rawTextOf(state);
  // The text the save in flight sent, kept so a later edit does not change
  // what the places of the stages are read for.
  const [sent, setSent] = useState<string>();
  const sentText = submittedText ?? sent;
  const history = useEditHistory(savedText);
  const draft = useYamlDraft({
    initialText: savedText,
    name: state.saved.name,
    baseHash: state.saved.hash,
    validate,
    scheduler,
  });
  const {
    record,
    reset,
    undo,
    redo,
    undoText,
    redoText,
    undoAdoptsText,
    redoAdoptsText,
  } = history;
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
    ...(state.save.phase === 'saving' && sentText !== undefined
      ? { submitted: sentText }
      : {}),
  });
  // A change of the stages makes a text; the text shown is the one the
  // history points at, and that is the text the check reads. Whole-text edits
  // are marked so undo and redo can adopt the text they cross. A draft with no
  // text a save could write records nothing: the history holds texts a save
  // can write, so undo always lands on one.
  useEffect(() => {
    if (written !== undefined) {
      record(written, rawText === undefined ? 'stages' : 'text');
    }
  }, [rawText, record, written]);
  useEffect(() => edit(history.text), [edit, history.text]);

  const answer = draft.answer;
  useEffect(() => {
    onCheckChange?.(draft.status, draft.failure);
  }, [draft.failure, draft.status, onCheckChange]);
  const showingEarlier = history.text !== text;
  // The list is about the text on screen. The editor's check, which holds a
  // refused save's findings, is about the draft, so it joins only while the
  // box shows the draft's text and its line numbers point into it.
  const findings = useMemo(
    () =>
      mergeFindings(
        answer?.diagnostics ?? [],
        !showingEarlier && state.check.revision === state.revision
          ? state.check.diagnostics
          : [],
      ),
    [answer, showingEarlier, state.check, state.revision],
  );
  // The view of the text as it is now, when a check of it has answered with
  // one. Anything else is a view of an earlier text, which names the stages
  // of this draft only while no stage was added, deleted or moved since.
  const ofNow = answer?.view ? answer : undefined;
  const checked = ofNow ?? draft.lastGood ?? opened.answer;
  const spec = useMemo(
    () => ({
      name: state.saved.view.name,
      intent: state.saved.view.intent,
      stages: state.draft.stages.map((stage) => {
        const from = state.bases.indexOf(stage.id);
        const source = from < 0 ? undefined : state.saved.view.stages[from];
        return {
          id: stage.id,
          name: stage.name,
          agent: stage.agent,
          ...(source?.outcome === undefined ? {} : { outcome: source.outcome }),
          ...(source?.prompt_file === undefined
            ? { prompt: stage.prompt }
            : { prompt_file: source.prompt_file }),
        };
      }),
    }),
    [state.bases, state.draft.stages, state.saved.view],
  );
  const graph = useMemo(() => buildGraph(spec, harness), [spec, harness]);
  const { select } = editor;
  // Counts the times a stage has been chosen in the drawing, so the side
  // column opens its keys each time, as the drawing says it will.
  const [opens, setOpens] = useState(0);
  const [announcement, setAnnouncement] = useState({ text: '', count: 0 });
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
  // loaded: that is what the file holds. The stage is taken from the place it
  // was loaded from, which a rename or another stage being added or deleted
  // does not move.
  // The keys of a stage describe the file. While the text has been typed
  // over they cannot be changed, and this says why.
  const editable = canEdit(state);
  const frozen = changeBlocker(state);
  const fileView = opened.answer?.view ?? null;
  const viewStage = picked
    ? sourceStageOf(fileView, sources.of(picked.id))
    : undefined;
  // Whether the prompt is one the editor can read and write. A stage that
  // reads a file, has both keys, or sits in a file whose prompts cannot be
  // found keeps its prompt read-only, with the value the file holds.
  const prompt = picked ? promptFieldOf(state, picked) : undefined;
  const promptRead = prompt?.kind === 'text';
  const values = picked ? fieldValuesOf(viewStage, picked, { promptRead }) : {};
  const kindOf = typeof viewStage?.kind === 'string' ? viewStage.kind : 'agent';
  const rules = stageFields[kindOf] ?? [];
  // The name, the agent and a prompt the editor can read go through the
  // editor; every other key is shown read-only, and a prompt it cannot read
  // is one of them. A save keeps each of their bytes, but nothing on the
  // page can change them yet.
  const readOnlyKeys = rules
    .map((rule) => rule.key)
    .filter(
      (key) => !SAVABLE_KEYS.includes(key) || (key === 'prompt' && !promptRead),
    );
  const stage: LayoutStage | undefined = picked && {
    name: picked.name,
    rules,
    values,
    // The agent the file names, which stays on offer even when the list of
    // agents does not have it; `values` holds the one chosen since.
    originalAgent:
      typeof viewStage?.agent === 'string' ? viewStage.agent : picked.agent,
    // While the text has been typed over, no key of a stage can be changed:
    // the stage shown is the one the file had, not the one the text holds.
    readOnlyKeys:
      frozen === undefined ? readOnlyKeys : rules.map((rule) => rule.key),
  };
  // A file the writer cannot edit in place at all is refused before any
  // change is made; a draft it cannot write is refused as it stands. Both
  // reasons come from the writer itself, through the editor's own state, so
  // the view never carries a second model of what a save would keep.
  // A raw edit writes the whole file, so the writer and its refusals are not
  // used for it.
  const refusal =
    rawText === undefined
      ? (fileBlocker(state) ?? writeBlocker(state))
      : undefined;

  // Why the text cannot be typed into now, if it cannot: read-only, a load,
  // or a save on its way to the server.
  const blocked = textBlocker(state);
  // A step adopts its text when it crosses a raw edit, and also whenever the
  // editor holds a raw text other than the one it lands on: otherwise the box
  // would move while Save still wrote the raw text.
  const holdsOther = (next: string | undefined) =>
    rawText !== undefined && next !== undefined && next !== rawText;
  const undoAdopts = undoAdoptsText || holdsOther(undoText);
  const redoAdopts = redoAdoptsText || holdsOther(redoText);
  const stepHistory = useCallback(
    (asked: 'undo' | 'redo') => {
      const undoing = asked === 'undo';
      const next = undoing ? undoText : redoText;
      const adopts = undoing ? undoAdopts : redoAdopts;
      if (!editable || next === undefined || (adopts && blocked !== undefined))
        return;
      if (adopts) editor.setText(next);
      if (undoing) undo();
      else redo();
    },
    [
      blocked,
      editable,
      editor,
      redo,
      redoAdopts,
      redoText,
      undo,
      undoAdopts,
      undoText,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const asked = undoShortcut(shortcutKeyOf(event));
      if (asked === undefined) return;
      event.preventDefault();
      stepHistory(asked);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [stepHistory]);
  const onUndo = useCallback(() => stepHistory('undo'), [stepHistory]);
  const onRedo = useCallback(() => stepHistory('redo'), [stepHistory]);

  // The lines of a stage are named only while the drawing and the text agree
  // on them. A raw edit leaves the draft on the loaded stages while the check
  // parses whatever was typed, so the stage at a given place in that parse
  // need not be the one that is picked: a rename, a reorder, a deletion or a
  // replacement that keeps the count would mark another stage's lines.
  const marked =
    pickedPlace && rawText === undefined
      ? markedStageOf(checked?.view, pickedPlace, {
          stale: ofNow === undefined,
          sources: state.draft.stages.map((one) => sources.of(one.id)),
        })
      : undefined;

  return (
    <section className="wf-design-view" aria-labelledby={headingId}>
      <h2 className="wf-visually-hidden" id={headingId}>
        Design
      </h2>
      <div
        className="wf-visually-hidden"
        role="status"
        data-testid="designer-live"
      >
        <span key={announcement.count}>{announcement.text}</span>
      </div>
      <SpaceBetween size="m">
        {!editable && (
          <Alert type="info" data-testid="read-only-note">
            {READ_ONLY_REASON} You can look at the stages and select one, but
            not change them.
          </Alert>
        )}
        {editable && frozen !== undefined && (
          <Alert type="info" data-testid="stage-keys-frozen">
            {frozen}
          </Alert>
        )}
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
            {opened.failure} The name, the agent and any prompt the editor can
            read are still there to change; the other keys of the file are not
            on the page. A save still keeps them.
          </Alert>
        )}
        {!controlsInPageHeader && (
          <CheckLine status={draft.status} failure={draft.failure} />
        )}
        <EditAlerts state={state} onReload={editor.reload} />
        <Findings diagnostics={findings} />
        <DesignerLayout
          drawing={<WorkflowCanvas graph={graph} selection={selection} />}
          yaml={{
            file: state.saved.name,
            text: history.text,
            ...(marked ? { stage: marked } : {}),
            // Typing writes the text into the editor and into the history in
            // one event, so a single render carries both and the caret stays
            // where it was. While the box is blocked nothing is taken, so the
            // history cannot hold a text the editor refused.
            onChange: (next: string) => {
              if (blocked !== undefined) return;
              editor.setText(next);
              record(next, 'text');
            },
            ...(blocked === undefined ? {} : { blocked }),
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
            const typed = next.prompt ?? '';
            if (promptRead && typed !== picked.prompt) {
              editor.setPrompt(picked.id, typed);
            }
          }}
          onStageDelete={() => {
            if (
              !picked ||
              frozen !== undefined ||
              !canRemoveStage(state.draft)
            ) {
              return;
            }
            editor.remove(picked.id);
            setOpens((count) => count + 1);
            setAnnouncement(({ count }) => ({
              text: `Stage ${picked.name || 'with no name'} deleted.`,
              count: count + 1,
            }));
          }}
          deleteDisabled={frozen !== undefined || !canRemoveStage(state.draft)}
          deleteDisabledReason={
            frozen ?? 'A workflow needs at least one stage.'
          }
        >
          <SpaceBetween size="s">
            {!controlsInPageHeader && (
              <SaveControls
                state={state}
                onSave={() => {
                  if (refusal !== undefined || written === undefined) return;
                  setSent(written);
                  editor.save();
                }}
              />
            )}
            <Button
              iconName="add-plus"
              disabled={frozen !== undefined || !canAddStage(state.draft)}
              disabledReason={
                frozen ?? `A workflow has at most ${MAX_STAGES} stages.`
              }
              onClick={() => editor.add()}
            >
              Add {nextStageName(state.draft)}
            </Button>
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                iconName="undo"
                disabled={
                  !editable ||
                  !history.canUndo ||
                  (undoAdopts && blocked !== undefined)
                }
                disabledReason={editable ? undefined : READ_ONLY_REASON}
                onClick={onUndo}
              >
                Undo
              </Button>
              <Button
                iconName="redo"
                disabled={
                  !editable ||
                  !history.canRedo ||
                  (redoAdopts && blocked !== undefined)
                }
                disabledReason={editable ? undefined : READ_ONLY_REASON}
                onClick={onRedo}
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
