// SPDX-License-Identifier: Apache-2.0
import Button from '@cloudscape-design/components/button';
import Tabs from '@cloudscape-design/components/tabs';
import { useId, useState, type ReactNode } from 'react';
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

/**
 * The Designer in three columns: the components on the left (`children`),
 * the drawing in the middle, and a side column on the right with a YAML tab
 * and a Properties tab. Each column is a landmark, so a screen reader can
 * jump to one without tabbing through the others. The side column folds with
 * a button. Cloudscape `Tabs` carries the tabs, with every panel kept mounted
 * so neither loses its scroll or its form state on a switch. It takes data
 * and callbacks only; it fetches and saves nothing.
 */
export function DesignerLayout({
  children,
  drawing,
  yaml,
  stage,
  agents,
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
  onStageChange: (change: FieldFormChange) => void;
}) {
  const id = useId();
  const [tab, setTab] = useState<string>(YAML_TAB);
  const [folded, setFolded] = useState(false);
  const sideId = `${id}-side`;

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
                content: properties,
              },
            ]}
          />
        </div>
      </aside>
    </div>
  );
}
