// SPDX-License-Identifier: Apache-2.0
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { FieldForm, type FieldFormChange } from './FieldForm';
import { YamlPane, type MarkedStage } from './YamlPane';
import type { AgentOption, FieldValues, StageFieldRule } from './field-rules';
import { tabKeyTarget } from './tab-keys';
import './designer-layout.css';

/** The workflow file that the YAML tab shows. */
export interface LayoutYaml {
  /** The name of the file, such as `hello.yml`. */
  readonly file: string;
  readonly text: string;
  /** The stage whose lines are marked, if one is picked. */
  readonly stage?: MarkedStage;
}

/** The stage that the Properties tab edits. */
export interface LayoutStage {
  readonly name: string;
  readonly rules: readonly StageFieldRule[];
  readonly values: FieldValues;
  /** The `agent` of the stage when it was loaded, before any edit. */
  readonly originalAgent?: string;
  /** The keys that cannot be changed yet; they are shown as they are. */
  readonly readOnlyKeys?: readonly string[];
}

const TABS = [
  { id: 'yaml', label: 'YAML' },
  { id: 'properties', label: 'Properties' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const NO_STAGE = 'Pick a stage in the drawing to edit its keys.';

// The first control of the Properties form a person can type in or choose
// from. A read-only key is not one, and neither is the panel itself when the
// form has no editable key.
const EDITABLE =
  'input:not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled]), button:not([disabled])';

/**
 * The Designer in three columns: the components on the left (`children`),
 * the drawing in the middle, and a side column on the right with a YAML tab
 * and a Properties tab. The side column folds with a button. The tabs follow
 * the WAI-ARIA tabs pattern: Tab reaches the selected tab, and the arrow
 * keys, Home and End select another, with modifier keys left to the browser.
 * It takes data and callbacks only; it fetches and saves nothing.
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
  onStageChange,
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
  onStageChange: (change: FieldFormChange) => void;
}) {
  const id = useId();
  const [tab, setTab] = useState<TabId>('yaml');
  const [folded, setFolded] = useState(false);
  const tabs = useRef(new Map<TabId, HTMLButtonElement>());
  const properties = useRef<HTMLDivElement>(null);
  const asked = useRef(openProperties);
  const sideId = `${id}-side`;
  const tabId = (tabName: TabId) => `${id}-${tabName}-tab`;
  const panelId = (tabName: TabId) => `${id}-${tabName}-panel`;

  useEffect(() => {
    if (openProperties === asked.current) return;
    asked.current = openProperties;
    setTab('properties');
    setFolded(false);
  }, [openProperties]);

  // After the panel is on show, so the field to focus is in the page.
  useEffect(() => {
    if (openProperties === 0 || tab !== 'properties' || folded) return;
    const panel = properties.current;
    (panel?.querySelector<HTMLElement>(EDITABLE) ?? panel)?.focus();
  }, [openProperties, tab, folded]);

  const onKeyDown = (event: KeyboardEvent) => {
    const index = TABS.findIndex((one) => one.id === tab);
    const target = tabKeyTarget(event, index, TABS.length);
    const next = target === undefined ? undefined : TABS[target];
    if (!next) return;
    event.preventDefault();
    setTab(next.id);
    tabs.current.get(next.id)?.focus();
  };

  const panels: Record<TabId, ReactNode> = {
    yaml: <YamlPane file={yaml.file} text={yaml.text} stage={yaml.stage} />,
    properties: stage ? (
      <FieldForm
        stageName={stage.name}
        rules={stage.rules}
        agents={agents}
        originalAgent={stage.originalAgent}
        values={stage.values}
        {...(stage.readOnlyKeys ? { readOnlyKeys: stage.readOnlyKeys } : {})}
        onChange={onStageChange}
      />
    ) : (
      <p className="wf-layout-note">{NO_STAGE}</p>
    ),
  };

  return (
    <div className="wf-layout" data-folded={folded ? 'true' : undefined}>
      <div className="wf-layout-left">{children}</div>
      <div className="wf-layout-drawing">{drawing}</div>
      <div className="wf-layout-side">
        <button
          type="button"
          className="wf-layout-fold"
          aria-expanded={!folded}
          aria-controls={sideId}
          onClick={() => setFolded((was) => !was)}
        >
          {folded ? 'Show the side panel' : 'Hide the side panel'}
        </button>
        <div id={sideId} className="wf-layout-side-body" hidden={folded}>
          <div
            role="tablist"
            aria-label="Side panel"
            className="wf-layout-tabs"
            onKeyDown={onKeyDown}
          >
            {TABS.map((one) => {
              const selected = one.id === tab;
              return (
                <button
                  key={one.id}
                  ref={(element) => {
                    if (element) tabs.current.set(one.id, element);
                    else tabs.current.delete(one.id);
                  }}
                  type="button"
                  role="tab"
                  id={tabId(one.id)}
                  aria-selected={selected}
                  aria-controls={panelId(one.id)}
                  tabIndex={selected ? 0 : -1}
                  className="wf-layout-tab"
                  onClick={() => setTab(one.id)}
                >
                  {one.label}
                </button>
              );
            })}
          </div>
          {TABS.map((one) => (
            <div
              key={one.id}
              ref={one.id === 'properties' ? properties : undefined}
              role="tabpanel"
              id={panelId(one.id)}
              aria-labelledby={tabId(one.id)}
              tabIndex={0}
              hidden={one.id !== tab}
              className="wf-layout-panel"
            >
              {panels[one.id]}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
