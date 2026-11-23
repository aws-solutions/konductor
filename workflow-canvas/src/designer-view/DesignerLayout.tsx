// SPDX-License-Identifier: Apache-2.0
import Button from '@cloudscape-design/components/button';
import Tabs from '@cloudscape-design/components/tabs';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { FieldForm, type FieldFormChange } from './FieldForm';
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
  const [tab, setTab] = useState<string>(YAML_TAB);
  const [folded, setFolded] = useState(false);
  const propertiesPanel = useRef<HTMLDivElement>(null);
  const asked = useRef(openProperties);
  // An ask for the keys of a stage that the focus has not answered yet.
  const [wanted, setWanted] = useState(false);
  const sideId = `${id}-side`;

  useEffect(() => {
    if (openProperties === asked.current) return;
    asked.current = openProperties;
    setTab(PROPERTIES_TAB);
    setFolded(false);
    setWanted(true);
  }, [openProperties]);

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

  const properties = stage ? (
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
