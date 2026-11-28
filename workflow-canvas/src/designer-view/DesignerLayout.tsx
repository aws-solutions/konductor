// SPDX-License-Identifier: Apache-2.0
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import FormField from '@cloudscape-design/components/form-field';
import Multiselect from '@cloudscape-design/components/multiselect';
import Tabs from '@cloudscape-design/components/tabs';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { FieldForm, type FieldFormChange } from './FieldForm';
import { ParamsPanel, type ParamChange } from './ParamsPanel';
import { OutputsPanel, type OutputChange } from './OutputsPanel';
import { ChecksPanel } from './ChecksPanel';
import type {
  DraftCheck,
  DraftOutput,
  DraftParam,
} from '../designer/core/draft';
import { YamlPane, type MarkedStage } from './YamlPane';
import type { AgentOption, FieldValues, StageFieldRule } from './field-rules';
import './designer-layout.css';

/** The workflow file that the YAML tab shows. */
export interface LayoutYaml {
  /** The name of the file, such as `hello.yml`. */
  readonly file: string;
  readonly text: string;
  /** The stage whose lines are marked, if one is picked. */
  readonly stage?: MarkedStage;
  /** Takes the whole text when it is typed over. Without it, read-only. */
  readonly onChange?: (text: string) => void;
  /** Why the text cannot be typed into now, while `onChange` is given. */
  readonly blocked?: string;
}

/** The stage that the Properties tab edits. */
export interface LayoutStage {
  readonly name: string;
  readonly rules: readonly StageFieldRule[];
  readonly values: FieldValues;
  readonly outputs?: readonly DraftOutput[];
  readonly outputsDisabled?: boolean;
  readonly outputsDisabledReason?: string;
  readonly outputsStructuralDisabled?: boolean;
  readonly outputsStructuralDisabledReason?: string;
  readonly doneWhen?: readonly string[];
  readonly doneWhenDisabled?: boolean;
  readonly doneWhenDisabledReason?: string;
  readonly doneWhenError?: string;
  /** The `agent` of the stage when it was loaded, before any edit. */
  readonly originalAgent?: string;
  /** The keys that cannot be changed yet; they are shown as they are. */
  readonly readOnlyKeys?: readonly string[];
}

const YAML_TAB = 'yaml';
const PROPERTIES_TAB = 'properties';

const NO_STAGE = 'Pick a stage in the drawing to edit its keys.';

// The first control of the Properties form a person can type in or choose
// from. A read-only key is not one, and neither is the panel itself when the
// form has no editable key.
const EDITABLE =
  'input:not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled]), button:not([disabled])';

/**
 * The Designer in three columns: the components on the left (`children`),
 * the drawing in the middle, and a side column on the right with a YAML tab
 * and a Properties tab. Each column is a landmark, so a screen reader can
 * jump to one without tabbing through the others. The side column folds with
 * a button. Cloudscape `Tabs` carries the tabs, with every panel kept mounted
 * so neither loses its scroll or its form state on a switch. It takes data
 * and callbacks only; it fetches and saves nothing.
 *
 * `openProperties` counts the times the page has asked for the keys of a
 * stage, as choosing one in the drawing does: each time it goes up, the
 * Properties tab is selected, the side column is unfolded, and the first key
 * a person can edit takes the focus, so the keyboard reaches the form where
 * the drawing says it will.
 */
export function DesignerLayout({
  children,
  drawing,
  yaml,
  stage,
  agents,
  openProperties = 0,
  openParams = 0,
  openChecks = 0,
  params,
  checks,
  checksDisabled = false,
  checksDisabledReason,
  checksStructuralDisabled = checksDisabled,
  checksStructuralDisabledReason = checksDisabledReason,
  paramsDisabled = false,
  paramsDisabledReason,
  onParamChange,
  onParamAdd,
  onParamRemove,
  onCheckChange,
  onCheckAdd,
  onCheckRemove,
  onDoneWhenChange,
  onStageChange,
  onOutputChange,
  onOutputAdd,
  onOutputRemove,
  onStageDelete,
  deleteDisabled = false,
  deleteDisabledReason,
}: {
  /** The components a person drags onto the drawing. */
  children?: ReactNode;
  drawing: ReactNode;
  yaml: LayoutYaml;
  /** The picked stage, or `undefined` when none is. */
  stage: LayoutStage | undefined;
  /** The agents of `GET /api/agents`, offered for the `agent` key. */
  agents: readonly AgentOption[];
  /** Goes up when the page asks for the keys of a stage to be shown. */
  openProperties?: number;
  /** Goes up when the intent asks for the parameter editor. */
  openParams?: number;
  openChecks?: number;
  /** The workflow parameter declarations. */
  params?: readonly DraftParam[];
  checks?: readonly DraftCheck[];
  checksDisabled?: boolean;
  checksDisabledReason?: string;
  checksStructuralDisabled?: boolean;
  checksStructuralDisabledReason?: string;
  paramsDisabled?: boolean;
  paramsDisabledReason?: string;
  onParamChange?: (id: string, change: ParamChange) => void;
  onParamAdd?: () => void;
  onParamRemove?: (id: string) => void;
  onCheckChange?: (
    key: string,
    check: Omit<DraftCheck, 'key' | 'sourceIndex'>,
  ) => void;
  onCheckAdd?: () => void;
  onCheckRemove?: (key: string) => void;
  onDoneWhenChange?: (ids: readonly string[]) => void;
  onStageChange: (change: FieldFormChange) => void;
  onOutputChange?: (id: string, change: OutputChange) => void;
  onOutputAdd?: () => void;
  onOutputRemove?: (id: string) => void;
  /** Deletes the picked stage. Without it, no delete control is shown. */
  onStageDelete?: () => void;
  deleteDisabled?: boolean;
  deleteDisabledReason?: string;
}) {
  const id = useId();
  const [tab, setTab] = useState<string>(YAML_TAB);
  const [folded, setFolded] = useState(false);
  const propertiesPanel = useRef<HTMLDivElement>(null);
  const asked = useRef(openProperties);
  const paramsAsked = useRef(openParams);
  const checksAsked = useRef(openChecks);
  const [panel, setPanel] = useState<'stage' | 'params' | 'checks'>('stage');
  // An ask for the keys of a stage that the focus has not answered yet.
  const [wanted, setWanted] = useState(false);
  const sideId = `${id}-side`;

  useEffect(() => {
    if (openProperties === asked.current) return;
    asked.current = openProperties;
    setPanel('stage');
    setTab(PROPERTIES_TAB);
    setFolded(false);
    setWanted(true);
  }, [openProperties]);

  useEffect(() => {
    if (openParams === paramsAsked.current) return;
    paramsAsked.current = openParams;
    setPanel('params');
    setTab(PROPERTIES_TAB);
    setFolded(false);
    setWanted(true);
  }, [openParams]);

  useEffect(() => {
    if (openChecks === checksAsked.current) return;
    checksAsked.current = openChecks;
    setPanel('checks');
    setTab(PROPERTIES_TAB);
    setFolded(false);
    setWanted(true);
  }, [openChecks]);

  // The focus moves for an ask that has not been answered yet, and the ask is
  // spent by that: every other way of reaching this tab, the arrow keys among
  // them, leaves the focus where the person put it. Cloudscape owns the panel
  // that holds the form, so the fallback is that panel, which is the focusable
  // element the form sits in.
  useEffect(() => {
    if (!wanted || tab !== PROPERTIES_TAB || folded) return;
    setWanted(false);
    const form = propertiesPanel.current;
    const panel = form?.closest<HTMLElement>('[role="tabpanel"]');
    (form?.querySelector<HTMLElement>(EDITABLE) ?? panel)?.focus();
  }, [wanted, tab, folded]);

  const stageProperties = stage ? (
    <SpaceBetween size="m">
      <FieldForm
        stageName={stage.name}
        rules={stage.rules}
        agents={agents}
        originalAgent={stage.originalAgent}
        values={stage.values}
        {...(stage.readOnlyKeys ? { readOnlyKeys: stage.readOnlyKeys } : {})}
        onChange={onStageChange}
      />
      {onOutputChange && onOutputAdd && onOutputRemove && (
        <OutputsPanel
          outputs={stage.outputs ?? []}
          disabled={stage.outputsDisabled}
          disabledReason={stage.outputsDisabledReason}
          structuralDisabled={stage.outputsStructuralDisabled}
          structuralDisabledReason={stage.outputsStructuralDisabledReason}
          onChange={onOutputChange}
          onAdd={onOutputAdd}
          onRemove={onOutputRemove}
        />
      )}
      {onDoneWhenChange && (
        <FormField
          label="done_when"
          errorText={stage.doneWhenError}
          constraintText={stage.doneWhenDisabledReason}
        >
          <Multiselect
            selectedOptions={(stage.doneWhen ?? []).map((key) => ({
              value: key,
              label:
                (checks ?? []).find((check) => check.key === key)?.id ?? key,
            }))}
            options={(checks ?? []).map(({ key, id }) => ({
              value: key,
              label: id,
            }))}
            placeholder="Choose checks"
            invalid={stage.doneWhenError !== undefined}
            disabled={stage.doneWhenDisabled}
            onChange={({ detail }) =>
              onDoneWhenChange(
                detail.selectedOptions.flatMap((option) =>
                  option.value ? [option.value] : [],
                ),
              )
            }
          />
        </FormField>
      )}
      {onStageDelete && (
        <Button
          disabled={deleteDisabled}
          disabledReason={deleteDisabledReason}
          onClick={onStageDelete}
        >
          Delete stage
        </Button>
      )}
    </SpaceBetween>
  ) : (
    <p className="wf-layout-note">{NO_STAGE}</p>
  );
  const properties =
    panel === 'checks' &&
    checks &&
    onCheckChange &&
    onCheckAdd &&
    onCheckRemove ? (
      <ChecksPanel
        checks={checks}
        disabled={checksDisabled}
        disabledReason={checksDisabledReason}
        structuralDisabled={checksStructuralDisabled}
        structuralDisabledReason={checksStructuralDisabledReason}
        onChange={onCheckChange}
        onAdd={onCheckAdd}
        onRemove={onCheckRemove}
      />
    ) : panel === 'params' &&
      params &&
      onParamChange &&
      onParamAdd &&
      onParamRemove ? (
      <ParamsPanel
        params={params}
        disabled={paramsDisabled}
        disabledReason={paramsDisabledReason}
        onChange={onParamChange}
        onAdd={onParamAdd}
        onRemove={onParamRemove}
      />
    ) : (
      stageProperties
    );

  return (
    <div className="wf-layout" data-folded={folded ? 'true' : undefined}>
      <section className="wf-layout-left" aria-label="Components">
        {children}
      </section>
      <section className="wf-layout-drawing" aria-label="Drawing">
        {drawing}
      </section>
      <aside className="wf-layout-side" aria-label="Side panel">
        <div className="wf-layout-fold">
          <Button
            ariaExpanded={!folded}
            ariaControls={sideId}
            onClick={() => setFolded((was) => !was)}
          >
            {folded ? 'Show the side panel' : 'Hide the side panel'}
          </Button>
        </div>
        <div id={sideId} className="wf-layout-side-body" hidden={folded}>
          <Tabs
            ariaLabel="Side panel"
            activeTabId={tab}
            onChange={({ detail }) => setTab(detail.activeTabId)}
            tabs={[
              {
                id: YAML_TAB,
                label: 'YAML',
                contentRenderStrategy: 'eager',
                content: (
                  <YamlPane
                    file={yaml.file}
                    text={yaml.text}
                    stage={yaml.stage}
                    {...(yaml.onChange ? { onChange: yaml.onChange } : {})}
                    {...(yaml.blocked === undefined
                      ? {}
                      : { blocked: yaml.blocked })}
                  />
                ),
              },
              {
                id: PROPERTIES_TAB,
                label: 'Properties',
                contentRenderStrategy: 'eager',
                content: <div ref={propertiesPanel}>{properties}</div>,
              },
            ]}
          />
        </div>
      </aside>
    </div>
  );
}
