// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from "react";
import YAML, { Scalar } from "yaml";
import { Plus, X } from "lucide-react";
import type { RunEvent, LibraryEntry, WorkstreamSummary } from "./api.ts";
import { dateTime, duration, RUN_STATE, runDuration, runState } from "./runView.ts";
import { ARTIFACT_DRAG, resolveLibrary, suggestPath } from "./api.ts";
import { winningEntry } from "./model/artifactInstruction.ts";
import { CHECK_KIND } from "../../flow/src/schemas/gate.ts";
import type { Edit, GateKind, OutputMode } from "./model/yamlEdit.ts";
import { gatesInRunOrder, stepViews, workflowKey, type OpenWorkflow, type StepView } from "./workflowView.ts";
import type { Problem } from "./validate.ts";
import { DOCS, GATE_FIELD_DOCS, GATE_KIND_DOCS } from "./docs.ts";
import { FieldLabel, InfoTip } from "./InfoTip.tsx";
import { lineDiff, visibleDiff } from "./diff.ts";

export type InspectorTab = "step" | "workflow" | "library" | "run" | "yaml";
const EDIT_TABS: { id: InspectorTab; label: string }[] = [
  { id: "step", label: "Step" },
  { id: "workflow", label: "Workflow" },
  { id: "library", label: "Library" },
  { id: "yaml", label: "YAML" },
];

export function Inspector({
  tab,
  onTab,
  workflow,
  steps,
  selectedIndex,
  problems,
  library,
  workstreams,
  diffBase,
  compareRequest,
  onEdit,
  onAddArtifact,
  allWorkflows,
  run,
  onOpenRun,
  onOpenWorkflowStep,
}: {
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  workflow: OpenWorkflow;
  steps: StepView[];
  selectedIndex: number;
  problems: Problem[];
  library: LibraryEntry[];
  workstreams: WorkstreamSummary[];
  diffBase: string;
  compareRequest: number;
  onEdit: (edit: Edit) => void;
  // Adds an artifact to a step, with the instruction pre-fill of decision 18.
  onAddArtifact: (step: number, mode: OutputMode, artifact: string, path?: string) => void;
  allWorkflows: OpenWorkflow[];
  run?: WorkstreamSummary;
  onOpenRun: (slug: string) => void;
  onOpenWorkflowStep: (workflowKey: string, stepIndex: number) => void;
}) {
  // The library entry a G T R badge asked to open; the counter re-opens the same id.
  const [libraryFocus, setLibraryFocus] = useState<{ id: string; n: number } | null>(null);
  const openLibraryEntry = (id: string) => {
    setLibraryFocus((current) => ({ id, n: (current?.n ?? 0) + 1 }));
    onTab("library");
  };
  return (
    <div className="inspector">
      <div className="inspector-tabs">
        {(run
          ? [
              { id: "run" as const, label: "Run" },
              { id: "yaml" as const, label: "YAML" },
            ]
          : EDIT_TABS
        ).map((t) => (
          <button key={t.id} className={`inspector-tab${tab === t.id ? " is-active" : ""}`} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {tab === "step" && (
          <StepTab
            step={steps[selectedIndex]}
            steps={steps}
            selectedIndex={selectedIndex}
            problems={problems}
            library={library}
            text={workflow.openText}
            onEdit={onEdit}
            onAddArtifact={onAddArtifact}
            onLibrary={() => onTab("library")}
            onOpenLibraryEntry={openLibraryEntry}
          />
        )}
        {tab === "workflow" && (
          <WorkflowTab workflow={workflow} workstreams={workstreams} onEdit={onEdit} onOpenRun={onOpenRun} />
        )}
        {tab === "library" && (
          <LibraryTab
            library={library}
            allWorkflows={allWorkflows}
            steps={steps}
            selectedIndex={selectedIndex}
            onAddArtifact={onAddArtifact}
            onOpenWorkflowStep={onOpenWorkflowStep}
            focus={libraryFocus}
          />
        )}
        {tab === "run" && run && <RunTab run={run} selectedStep={steps[selectedIndex]?.id} />}
        {tab === "yaml" && <YamlTab text={workflow.openText} base={diffBase} compareRequest={compareRequest} />}
      </div>
    </div>
  );
}

function StepTab({
  step,
  steps,
  selectedIndex,
  problems,
  library,
  text,
  onEdit,
  onAddArtifact,
  onLibrary,
  onOpenLibraryEntry,
}: {
  step?: StepView;
  steps: StepView[];
  selectedIndex: number;
  problems: Problem[];
  library: LibraryEntry[];
  text: string;
  onEdit: (edit: Edit) => void;
  onAddArtifact: (step: number, mode: OutputMode, artifact: string, path?: string) => void;
  onLibrary: () => void;
  onOpenLibraryEntry: (id: string) => void;
}) {
  const [expand, setExpand] = useState(false);
  const [outputId, setOutputId] = useState("");
  if (!step) return <div className="inspector-empty">No step selected.</div>;
  const err = (field: Problem["field"]) =>
    problems
      .filter((p) => p.field === field)
      .map((p) => p.message)
      .join(" ");
  const phases = [...new Set(steps.map((s) => s.phase).filter((p): p is string => !!p))];
  const available: { id: string; from: string }[] = [];
  steps.slice(0, selectedIndex).forEach((s) =>
    s.artifacts.forEach((a) => {
      if (!available.some((x) => x.id === a.artifact)) available.push({ id: a.artifact, from: s.id });
    }),
  );
  const gateOrder = gatesInRunOrder(step.gates);
  const differs = gateOrder.some((g, i) => g.fileIndex !== i);
  const style = instructionStyle(text, selectedIndex);
  const setStep = (key: "id" | "title" | "phase" | "description", value: string) =>
    onEdit({ op: "setStepField", step: selectedIndex, key, value: value || null });
  const setCondition = (kind: GateKind, value: string, description?: string) =>
    onEdit({
      op: "setCondition",
      step: selectedIndex,
      condition: { kind, text: value, ...(description ? { description } : {}) },
    });

  return (
    <div className="inspector-section-stack">
      <div className="field-grid">
        <label className="field full-span">
          <FieldLabel label="Title" doc={DOCS.title} />
          <input
            className="field-input title-input"
            value={step.title ?? ""}
            placeholder={step.id}
            onChange={(e) => setStep("title", e.target.value)}
          />
        </label>
        <label className="field">
          <FieldLabel label="Id" doc={DOCS.id} />
          <input
            className="field-input mono-input"
            value={step.id}
            onChange={(e) => setStep("id", e.target.value)}
            data-error={!!err("id")}
          />
        </label>
        <label className="field">
          <FieldLabel label="Phase" doc={DOCS.phase} />
          <input
            className="field-input"
            list="kp-phases"
            value={step.phase ?? ""}
            onChange={(e) => setStep("phase", e.target.value)}
          />
          <datalist id="kp-phases">
            {phases.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        {err("id") && <div className="field-error full-span">{err("id")}</div>}
        <label className="field full-span">
          <FieldLabel label="Description" doc={DOCS.description} />
          <input
            className="field-input"
            value={step.description ?? ""}
            onChange={(e) => setStep("description", e.target.value)}
          />
        </label>
      </div>

      <div className="field-block">
        <div className="field-block-head">
          <FieldLabel label="Instruction" doc={DOCS.instruction} />
          <span className="grow" />
          <select
            className="mode-select"
            value={style}
            onChange={(e) =>
              onEdit({
                op: "setInstruction",
                step: selectedIndex,
                text: step.instruction ?? "",
                style: e.target.value as ">" | "|",
              })
            }
          >
            <option value=">">&gt; folded</option>
            <option value="|">| literal</option>
          </select>
          <button className="text-button" onClick={() => setExpand(true)}>
            Expand
          </button>
        </div>
        <textarea
          className="field-textarea"
          rows={clampRows(step.instruction)}
          value={step.instruction ?? ""}
          onChange={(e) => onEdit({ op: "setInstruction", step: selectedIndex, text: e.target.value, style })}
          data-error={!!err("instr")}
        />
        {err("instr") && <div className="field-error">{err("instr")}</div>}
      </div>

      <div className="field-block">
        <div className="field-block-head">
          <FieldLabel label="Condition" doc={DOCS.condition} />
        </div>
        <div className="segmented">
          {(["none", "check", "script", "agent", "owner-action"] as const).map((kind) => (
            <button
              key={kind}
              className={`segmented-opt${(step.condition?.kind ?? "none") === kind ? " is-active" : ""}`}
              onClick={() =>
                kind === "none"
                  ? onEdit({ op: "setCondition", step: selectedIndex, condition: null })
                  : setCondition(
                      kind,
                      kind === "check" ? "default" : (step.condition?.text ?? ""),
                      step.condition?.description,
                    )
              }
            >
              {kind === "owner-action" ? "owner" : kind}
            </button>
          ))}
        </div>
        {step.condition && (
          <>
            <input
              className="field-input"
              value={step.condition.text}
              placeholder={conditionPlaceholder(step.condition.kind)}
              onChange={(e) => setCondition(step.condition!.kind, e.target.value, step.condition!.description)}
              data-error={!!err("cond")}
            />
            <label className="mini-field">
              <span className="mini-label">
                description <span className="field-tag is-optional">optional</span>
                <InfoTip doc={GATE_FIELD_DOCS.gateDescription} />
              </span>
              <input
                className="field-input"
                value={step.condition.description ?? ""}
                onChange={(e) => setCondition(step.condition!.kind, step.condition!.text, e.target.value)}
              />
            </label>
          </>
        )}
        {err("cond") && <div className="field-error">{err("cond")}</div>}
      </div>

      <div className="field-block">
        <div className="field-block-head">
          <FieldLabel label="Consumes" doc={DOCS.consumes} />
        </div>
        <div className="pill-row">
          {available.map((a) => {
            const on = step.consumes.includes(a.id);
            return (
              <button
                key={a.id}
                className={`toggle-pill${on ? " is-on" : ""}`}
                title={`from ${a.from}`}
                onClick={() =>
                  onEdit({
                    op: "setConsumes",
                    step: selectedIndex,
                    ids: on
                      ? step.consumes.filter((id) => id !== a.id)
                      : [
                          ...step.consumes.filter((id) => available.some((v) => v.id === id)),
                          a.id,
                          ...step.consumes.filter((id) => !available.some((v) => v.id === id)),
                        ],
                  })
                }
              >
                {a.id} <small>{a.from}</small>
              </button>
            );
          })}
          {step.consumes
            .filter((id) => !available.some((a) => a.id === id))
            .map((id) => (
              <button
                key={id}
                className="toggle-pill is-bad"
                onClick={() =>
                  onEdit({ op: "setConsumes", step: selectedIndex, ids: step.consumes.filter((x) => x !== id) })
                }
              >
                {id} × remove
              </button>
            ))}
        </div>
      </div>

      <div className="field-block">
        <div className="field-block-head">
          <FieldLabel label="Outputs" doc={DOCS.produces} />
          <span className="grow" />
          <button className="text-button" onClick={onLibrary}>
            Library
          </button>
        </div>
        <div className="output-rows">
          {step.artifacts.map((a, flatIndex) => {
            const index = step.artifacts.slice(0, flatIndex).filter((x) => x.role === a.role).length;
            const entry = resolveLibrary(library, a.artifact);
            const fieldErr = problems
              .filter((p) => p.field === "art" && p.itemIndex === flatIndex)
              .map((p) => p.message)
              .join(" ");
            return (
              <div key={`${a.role}-${index}`} className="output-row">
                <div className="output-row-head">
                  <select
                    className="mode-select"
                    value={a.role}
                    onChange={(e) =>
                      onEdit({
                        op: "changeOutputMode",
                        step: selectedIndex,
                        mode: a.role,
                        index,
                        to: e.target.value as OutputMode,
                      })
                    }
                  >
                    <option value="produces">produces</option>
                    <option value="optional_produces">optional_produces</option>
                    <option value="updates">updates</option>
                  </select>
                  <InfoTip doc={DOCS[a.role]} />
                  <button
                    type="button"
                    className={`library-badge${entry ? "" : " is-missing"}`}
                    title={entry ? `Open ${a.artifact} in the library` : `Search the library for ${a.artifact}`}
                    onClick={() => onOpenLibraryEntry(a.artifact)}
                  >
                    {entry ? `${entry.g ? "G" : ""} ${entry.t ? "T" : ""} ${entry.r ? "R" : ""}` : "no guide"}
                  </button>
                  <button
                    className="icon-mini"
                    onClick={() => onEdit({ op: "removeOutput", step: selectedIndex, mode: a.role, index })}
                  >
                    <X size={14} />
                  </button>
                </div>
                <label className="mini-field">
                  <span className="mini-label">
                    artifact <span className="field-tag is-required">required</span>
                    <InfoTip doc={DOCS.artifact} />
                  </span>
                  <input
                    className="field-input mono-input"
                    list="kp-library"
                    value={a.artifact}
                    onChange={(e) =>
                      onEdit({
                        op: "setOutput",
                        step: selectedIndex,
                        mode: a.role,
                        index,
                        fields: { artifact: e.target.value },
                      })
                    }
                    data-error={!!fieldErr}
                  />
                </label>
                <label className="mini-field">
                  <span className="mini-label">
                    path <span className="field-tag is-required">required</span>
                    <InfoTip doc={DOCS.path} />
                  </span>
                  <input
                    className="field-input"
                    value={a.path}
                    onChange={(e) =>
                      onEdit({
                        op: "setOutput",
                        step: selectedIndex,
                        mode: a.role,
                        index,
                        fields: { path: e.target.value },
                      })
                    }
                  />
                </label>
                <label className="mini-field">
                  <span className="mini-label">
                    description <span className="field-tag is-optional">optional</span>
                    <InfoTip doc={DOCS.artDescription} />
                  </span>
                  <input
                    className="field-input"
                    value={a.description ?? ""}
                    onChange={(e) =>
                      onEdit({
                        op: "setOutput",
                        step: selectedIndex,
                        mode: a.role,
                        index,
                        fields: { description: e.target.value || null },
                      })
                    }
                  />
                </label>
                {fieldErr && <div className="field-error">{fieldErr}</div>}
              </div>
            );
          })}
          <datalist id="kp-library">
            {[...new Set(library.map((e) => e.id))].map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
          <div className="add-row">
            <input
              className="field-input mono-input"
              list="kp-library"
              placeholder="artifact id"
              value={outputId}
              onChange={(e) => setOutputId(e.target.value)}
            />
            <button
              className="add-button"
              onClick={() => {
                const id = outputId.trim();
                if (!id) return;
                onAddArtifact(selectedIndex, "produces", id);
                setOutputId("");
              }}
            >
              <Plus size={14} /> Add
            </button>
          </div>
        </div>
      </div>

      <div className="field-block">
        <div className="field-block-head">
          <FieldLabel label="Gates" doc={DOCS.gates} />
          {differs && <span className="run-order-note">shown in run order; file order differs</span>}
        </div>
        <div className="gate-rows">
          {gateOrder.map(({ gate, fileIndex }, orderIndex) => {
            const gateProblems = problems.filter((p) => p.field === "gate" && p.itemIndex === fileIndex);
            const gateTextErr = gateProblems
              .filter((p) => p.subfield === "text" || !p.subfield)
              .map((p) => p.message)
              .join(" ");
            const routeErr = gateProblems
              .filter((p) => p.subfield === "route")
              .map((p) => p.message)
              .join(" ");
            const maxRoundsErr = gateProblems
              .filter((p) => p.subfield === "maxRounds")
              .map((p) => p.message)
              .join(" ");
            const remainingErr = gateProblems
              .filter((p) => p.subfield !== "route")
              .map((p) => p.message)
              .join(" ");
            return (
              <div key={fileIndex} className="gate-row">
                <div className="gate-row-head">
                  <span className="gate-row-num">{orderIndex + 1}</span>
                  <select
                    className="kind-select"
                    value={gate.kind}
                    onChange={(e) => {
                      const kind = e.target.value as GateKind;
                      onEdit({
                        op: "setGate",
                        step: selectedIndex,
                        index: fileIndex,
                        fields: {
                          kind,
                          ...(kind === "check" && !CHECK_KIND.test(gate.text) ? { text: "default" } : {}),
                        },
                      });
                    }}
                  >
                    <option value="check">check</option>
                    <option value="script">script</option>
                    <option value="agent">agent</option>
                    <option value="owner-action">owner-action</option>
                  </select>
                  <span className="grow" />
                  <button
                    className="icon-mini"
                    onClick={() => onEdit({ op: "removeGate", step: selectedIndex, index: fileIndex })}
                  >
                    <X size={14} />
                  </button>
                </div>
                <label className="mini-field">
                  <span className="mini-label">
                    {gateTextLabel(gate.kind)} <span className="field-tag is-required">required</span>
                    <InfoTip doc={GATE_KIND_DOCS[gate.kind]} />
                  </span>
                  <input
                    className="field-input"
                    value={gate.text}
                    onChange={(e) =>
                      onEdit({ op: "setGate", step: selectedIndex, index: fileIndex, fields: { text: e.target.value } })
                    }
                    data-error={!!gateTextErr}
                  />
                </label>
                {gate.kind === "agent" && (
                  <div className="field-grid">
                    <label className="mini-field">
                      <span className="mini-label">
                        max_rounds <FieldLabel label="" doc={GATE_FIELD_DOCS.maxRounds} />
                      </span>
                      <input
                        className="field-input"
                        type="number"
                        min={1}
                        placeholder="2"
                        value={gate.max_rounds ?? ""}
                        data-error={!!maxRoundsErr}
                        onChange={(e) =>
                          onEdit({
                            op: "setGate",
                            step: selectedIndex,
                            index: fileIndex,
                            fields: { max_rounds: e.target.value ? Number(e.target.value) : null },
                          })
                        }
                      />
                    </label>
                    <label className="mini-field">
                      <span className="mini-label">
                        guide <FieldLabel label="" doc={GATE_FIELD_DOCS.guide} />
                      </span>
                      <input
                        className="field-input"
                        value={gate.guide ?? ""}
                        onChange={(e) =>
                          onEdit({
                            op: "setGate",
                            step: selectedIndex,
                            index: fileIndex,
                            fields: { guide: e.target.value || null },
                          })
                        }
                      />
                    </label>
                  </div>
                )}
                <label className="mini-field">
                  <span className="mini-label">
                    route_back_to <FieldLabel label="" doc={GATE_FIELD_DOCS.routeBack} />
                  </span>
                  <div className="pill-row route-pills" data-error={!!routeErr}>
                    {steps.slice(0, selectedIndex + 1).map((s, i) => {
                      const on = gate.route_back_to.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          className={`toggle-pill${on ? " is-on" : ""}`}
                          onClick={() =>
                            onEdit({
                              op: "setGate",
                              step: selectedIndex,
                              index: fileIndex,
                              fields: {
                                route_back_to: on
                                  ? gate.route_back_to.filter((id) => id !== s.id)
                                  : [...gate.route_back_to, s.id],
                              },
                            })
                          }
                        >
                          {s.id}
                          {i === selectedIndex ? " (this)" : ""}
                        </button>
                      );
                    })}
                    {gate.route_back_to
                      .filter((target) => !steps.slice(0, selectedIndex + 1).some((step) => step.id === target))
                      .map((target) => (
                        <button
                          key={target}
                          className="toggle-pill is-bad"
                          onClick={() =>
                            onEdit({
                              op: "setGate",
                              step: selectedIndex,
                              index: fileIndex,
                              fields: { route_back_to: gate.route_back_to.filter((id) => id !== target) },
                            })
                          }
                        >
                          {target} × remove
                        </button>
                      ))}
                  </div>
                  {routeErr && <span className="field-error">{routeErr}</span>}
                </label>
                <label className="mini-field">
                  <span className="mini-label">
                    description <span className="field-tag is-optional">optional</span>
                    <InfoTip doc={GATE_FIELD_DOCS.gateDescription} />
                  </span>
                  <input
                    className="field-input"
                    value={gate.description ?? ""}
                    onChange={(e) =>
                      onEdit({
                        op: "setGate",
                        step: selectedIndex,
                        index: fileIndex,
                        fields: { description: e.target.value || null },
                      })
                    }
                  />
                </label>
                {remainingErr && <div className="field-error">{remainingErr}</div>}
              </div>
            );
          })}
          <div className="gate-adds">
            {(["check", "script", "agent", "owner-action"] as GateKind[]).map((kind) => (
              <button
                key={kind}
                onClick={() =>
                  onEdit({
                    op: "addGate",
                    step: selectedIndex,
                    gate: { kind, text: kind === "check" ? "default" : "" },
                  })
                }
              >
                + {kind}
              </button>
            ))}
          </div>
        </div>
      </div>
      {expand && (
        <div className="modal-backdrop">
          <div className="expand-modal">
            <div className="modal-title-row">
              <h2>Instruction</h2>
              <button className="icon-mini" onClick={() => setExpand(false)}>
                <X />
              </button>
            </div>
            <textarea
              autoFocus
              value={step.instruction ?? ""}
              onChange={(e) => onEdit({ op: "setInstruction", step: selectedIndex, text: e.target.value, style })}
            />
            <div className="expand-meta">
              {(step.instruction ?? "").trim().split(/\s+/).filter(Boolean).length} words ·{" "}
              {(step.instruction ?? "").split(/\n\s*\n/).filter(Boolean).length} paragraphs{" "}
              <button className="primary-button" onClick={() => setExpand(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowTab({
  workflow,
  workstreams,
  onEdit,
  onOpenRun,
}: {
  workflow: OpenWorkflow;
  workstreams: WorkstreamSummary[];
  onEdit: (edit: Edit) => void;
  onOpenRun: (slug: string) => void;
}) {
  const name = workflow.parsed?.name ?? workflow.rawWorkflow.name;
  const description = workflow.parsed?.description ?? workflow.rawWorkflow.description ?? "";
  return (
    <div className="inspector-section-stack">
      <label className="field">
        <FieldLabel label="Name" doc={DOCS.wfName} />
        <input
          className="field-input"
          value={name}
          onChange={(e) => onEdit({ op: "setWorkflowField", key: "name", value: e.target.value })}
        />
      </label>
      <label className="field">
        <FieldLabel label="Description" doc={DOCS.wfDescription} />
        <textarea
          className="field-textarea"
          rows={4}
          value={description}
          onChange={(e) => onEdit({ op: "setWorkflowField", key: "description", value: e.target.value || null })}
        />
      </label>
      <div className="field-block">
        <div className="field-block-head">
          <span className="field-label-row">
            File <FieldLabel label="" doc={DOCS.version} />
          </span>
        </div>
        <div className="location-pill-row">
          <span className="location-pill">{workflow.location}</span>
          <span className="file-path mono">{workflow.path}</span>
        </div>
      </div>
      <div className="field-block">
        <div className="field-block-head">Workstreams</div>
        {workstreams
          .filter((w) => w.workflowPath === workflow.path)
          .map((w) => (
            <button key={w.slug} className="workstream-row" onClick={() => onOpenRun(w.slug)}>
              <span className="mono">{w.slug}</span>
              <span className="workstream-meta">
                {w.summary?.currentStep ? `at ${w.summary.currentStep} · ` : ""}
                {w.summary?.status}
              </span>
            </button>
          ))}
        {!workstreams.some((w) => w.workflowPath === workflow.path) && <div className="inspector-empty">No runs.</div>}
      </div>
    </div>
  );
}

function LibraryTab({
  library,
  allWorkflows,
  steps,
  selectedIndex,
  onAddArtifact,
  onOpenWorkflowStep,
  focus,
}: {
  library: LibraryEntry[];
  allWorkflows: OpenWorkflow[];
  steps: StepView[];
  selectedIndex: number;
  onAddArtifact: (step: number, mode: OutputMode, artifact: string, path?: string) => void;
  onOpenWorkflowStep: (workflowKey: string, stepIndex: number) => void;
  focus: { id: string; n: number } | null;
}) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<"all" | LibraryEntry["level"]>("all");
  const [open, setOpen] = useState<LibraryEntry | null>(null);
  const [file, setFile] = useState("");
  const [mode, setMode] = useState<OutputMode>("produces");
  const [path, setPath] = useState("");
  const selectedStep = steps[selectedIndex];
  const levelLabel = (value: LibraryEntry["level"]) =>
    ({ project: "project", user: "personal", package: "fuse-flow" })[value];
  const usage = (id: string) =>
    allWorkflows.flatMap((candidate) =>
      stepViews(candidate).flatMap((step, stepIndex) => [
        ...step.artifacts
          .filter((artifact) => artifact.artifact === id)
          .map((artifact) => ({ candidate, step, stepIndex, mode: artifact.role })),
        ...(step.consumes.includes(id) ? [{ candidate, step, stepIndex, mode: "consumes" }] : []),
      ]),
    );
  const add = (id: string, addMode = mode, addPath = path || suggestPath(id)) => {
    if (!selectedStep) return;
    onAddArtifact(selectedIndex, addMode, id, addPath);
  };
  const openEntry = (entry: LibraryEntry) => {
    setOpen(entry);
    setFile(Object.keys(entry.files)[0] ?? "");
    setPath(suggestPath(entry.id));
  };
  // A G T R badge opens the entry its artifact resolves to, or searches for an id with none.
  useEffect(() => {
    if (!focus) return;
    const entry = winningEntry(library, focus.id);
    if (entry) openEntry(entry);
    else {
      setOpen(null);
      setQuery(focus.id);
    }
  }, [focus?.n]);
  const filtered = library.filter(
    (entry) =>
      (level === "all" || entry.level === level) && (!query.trim() || entry.id.includes(query.trim().toLowerCase())),
  );
  const unknown = query.trim().toLowerCase();
  const noLibrary = [...new Set(steps.flatMap((step) => step.artifacts.map((artifact) => artifact.artifact)))].filter(
    (id) => !library.some((entry) => entry.id === id),
  );

  if (open) {
    const files = Object.keys(open.files);
    const shownFile = files.includes(file) ? file : files[0];
    const used = usage(open.id);
    return (
      <div className="inspector-section-stack library-detail">
        <button className="text-button back-button" onClick={() => setOpen(null)}>
          ← Library
        </button>
        <div>
          <div className="library-detail-title">
            <strong>{open.id}</strong>
            <span className="library-level-pill">{levelLabel(open.level)}</span>
          </div>
          {(open.hides || open.hiddenBy) && (
            <div className="library-override">
              {open.hiddenBy ? `hidden by ${levelLabel(open.hiddenBy)}` : `hides ${levelLabel(open.hides!)}`}
            </div>
          )}
          {open.description && <p className="library-detail-description">{open.description}</p>}
          {open.entryProblem && <div className="library-entry-problem">{open.entryProblem}</div>}
          <div className="file-path mono">{open.folder}</div>
        </div>
        {files.length > 0 && (
          <>
            <div className="library-file-tabs">
              {files.map((name) => (
                <button key={name} className={shownFile === name ? "is-active" : ""} onClick={() => setFile(name)}>
                  {name}
                </button>
              ))}
            </div>
            <pre className="library-file">{open.files[shownFile]}</pre>
          </>
        )}
        <div className="field-block">
          <div className="field-block-head">Add to {selectedStep?.id ?? "step"}</div>
          <div className="segmented">
            {(["produces", "optional_produces", "updates"] as OutputMode[]).map((value) => (
              <button
                key={value}
                className={`segmented-opt${mode === value ? " is-active" : ""}`}
                onClick={() => setMode(value)}
              >
                {value === "optional_produces" ? "may produce" : value}
              </button>
            ))}
          </div>
          <input
            className="field-input"
            value={path}
            placeholder={suggestPath(open.id)}
            onChange={(event) => setPath(event.target.value)}
          />
          <button className="primary-button" onClick={() => add(open.id)}>
            Add
          </button>
        </div>
        <div className="field-block">
          <div className="field-block-head">Used by · {used.length}</div>
          {used.map(({ candidate, step, stepIndex, mode: usedMode }, index) => (
            <button
              key={`${candidate.path}-${step.id}-${index}`}
              className="library-used-row"
              onClick={() => onOpenWorkflowStep(workflowKey(candidate), stepIndex)}
            >
              <span>
                <strong>{candidate.file.replace(/\.ya?ml$/, "")}</strong> · {step.id}
              </span>
              <small>{usedMode}</small>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="inspector-section-stack">
      <input
        className="field-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search artifacts or type a new id"
      />
      <div className="library-toolbar">
        <div className="segmented">
          {(["all", "project", "user", "package"] as const).map((value) => (
            <button
              key={value}
              className={`segmented-opt${level === value ? " is-active" : ""}`}
              onClick={() => setLevel(value)}
            >
              {value === "user" ? "personal" : value === "package" ? "fuse-flow" : value}
            </button>
          ))}
        </div>
        <span className="library-add-to">
          ADD TO <strong>{selectedStep?.id}</strong>
        </span>
      </div>
      <div className="library-list">
        {filtered.map((entry) => {
          const used = usage(entry.id);
          const workflows = new Set(used.map((item) => item.candidate.path)).size;
          const hidden = !!entry.hiddenBy;
          return (
            <div
              key={`${entry.id}-${entry.level}`}
              className={`library-row${hidden ? " is-hidden" : ""}`}
              draggable
              onDragStart={(event) => event.dataTransfer.setData(ARTIFACT_DRAG, entry.id)}
              onClick={() => openEntry(entry)}
            >
              <span className="mono library-row-id">{entry.id}</span>
              <span className="chip-gtr">
                <span className={entry.files["guide.md"] ? "lit" : "dim"}>G</span>
                <span className={Object.keys(entry.files).some((name) => name.startsWith("template.")) ? "lit" : "dim"}>
                  T
                </span>
                <span className={entry.files["review.md"] ? "lit" : "dim"}>R</span>
              </span>
              <span className="library-level-pill">{levelLabel(entry.level)}</span>
              {entry.description ? (
                <span className="library-description">{entry.description}</span>
              ) : entry.entryProblem ? (
                <span className="library-description is-missing">entry.yml has a problem</span>
              ) : null}
              <span className="library-meta">
                {(entry.hides || entry.hiddenBy) && (
                  <span className="library-override">
                    {entry.hiddenBy ? `hidden by ${levelLabel(entry.hiddenBy)}` : `hides ${levelLabel(entry.hides!)}`}
                  </span>
                )}
                <span className="library-used">
                  {used.length ? `${used.length} steps · ${workflows} workflows` : "unused"}
                </span>
              </span>
              <button
                className="icon-mini"
                title={`Add to ${selectedStep?.id}`}
                onClick={(event) => {
                  event.stopPropagation();
                  add(entry.id, "produces", suggestPath(entry.id));
                }}
              >
                <Plus size={14} />
              </button>
            </div>
          );
        })}
      </div>
      {unknown && !library.some((entry) => entry.id === unknown) && /^[a-z0-9][a-z0-9-]*$/.test(unknown) && (
        <button className="library-new" onClick={() => add(unknown, "produces", suggestPath(unknown))}>
          + Add {unknown}, no library entry
        </button>
      )}
      {noLibrary.length > 0 && (
        <div className="library-missing-footer">
          <span>In this workflow, no library entry · {noLibrary.length}</span>
          <div>
            {noLibrary.map((id) => (
              <span key={id}>{id}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RunTab({ run, selectedStep }: { run: WorkstreamSummary; selectedStep?: string }) {
  const [all, setAll] = useState(false);
  const events = (run.events ?? []).filter((event) => all || event.step === selectedStep);
  const summary = run.summary;
  const routes = summary?.routesBack ?? [];
  return (
    <div className="inspector-section-stack">
      <div className="run-stats">
        <Stat label="state" value={RUN_STATE[runState(summary?.status)].label} />
        <Stat label={summary?.status === "COMPLETED" ? "took" : "running for"} value={duration(runDuration(run))} />
        <Stat label="waited for owner" value={duration(summary?.ownerWaitMs ?? 0)} />
        <Stat label="sent back" value={routes.length ? `${routes[0].from} → ${routes[0].to}` : "never"} />
      </div>
      <div className="segmented">
        <button className={`segmented-opt${!all ? " is-active" : ""}`} onClick={() => setAll(false)}>
          Step · {selectedStep}
        </button>
        <button className={`segmented-opt${all ? " is-active" : ""}`} onClick={() => setAll(true)}>
          All events
        </button>
      </div>
      <div className="event-list">
        {events.map((event, index) => (
          <EventRow
            key={`${event.time}-${event.step}-${index}`}
            event={event}
            showStep={all}
            selected={all && event.step === selectedStep}
          />
        ))}
        {events.length === 0 && <div className="inspector-empty">No events for this step.</div>}
      </div>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="run-stat">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
function EventRow({ event, showStep, selected }: { event: RunEvent; showStep: boolean; selected: boolean }) {
  const from = RUN_STATE[runState(event.from)];
  const to = RUN_STATE[runState(event.to)];
  return (
    <div className={`event-row${selected ? " is-selected" : ""}`}>
      <time>{dateTime(event.time)}</time>
      <div>
        {showStep && <div className="event-step">{event.step}</div>}
        <div className="event-change">
          {event.from !== event.to && (
            <>
              <span className={`run-state-pill ${from.className}`}>{from.label}</span>
              <span>→</span>
            </>
          )}
          <span className={`run-state-pill ${to.className}`}>{to.label}</span>
          {event.actor && <span className="event-actor">· {event.actor}</span>}
        </div>
        {event.detail && <div className="event-detail">{event.detail}</div>}
      </div>
    </div>
  );
}

function YamlTab({ text, base, compareRequest }: { text: string; base: string; compareRequest: number }) {
  const [view, setView] = useState<"file" | "changes">("file");
  useEffect(() => {
    if (compareRequest > 0) setView("changes");
  }, [compareRequest]);
  const changed = lineDiff(base, text).filter((l) => l.kind !== " ").length;
  return (
    <div className="yaml-tab">
      <div className="segmented">
        <button className={`segmented-opt${view === "file" ? " is-active" : ""}`} onClick={() => setView("file")}>
          File
        </button>
        <button className={`segmented-opt${view === "changes" ? " is-active" : ""}`} onClick={() => setView("changes")}>
          Changes · {changed}
        </button>
      </div>
      {view === "file" ? (
        <pre className="yaml-pre">{text}</pre>
      ) : (
        <pre className="yaml-pre diff-pre">
          {visibleDiff(lineDiff(base, text)).map((line, i) => (
            <span
              key={i}
              className={`diff-${line.kind === "…" ? "skip" : line.kind === "+" ? "add" : line.kind === "-" ? "remove" : "same"}`}
            >
              {line.kind === " " ? "  " : line.kind === "…" ? "  " : `${line.kind} `}
              {line.text}
              {"\n"}
            </span>
          ))}
        </pre>
      )}
    </div>
  );
}

function instructionStyle(text: string, step: number): ">" | "|" {
  const document = YAML.parseDocument(text);
  const instruction = document.getIn(["steps", step, "instruction"], true);
  return instruction instanceof Scalar && instruction.type === Scalar.BLOCK_LITERAL ? "|" : ">";
}
function clampRows(text?: string) {
  return Math.min(16, Math.max(5, (text?.split("\n").length ?? 1) + 1));
}
function conditionPlaceholder(kind: string) {
  return (
    (
      {
        check: "check kind, e.g. default",
        script: "shell command; success runs the step",
        agent: "when the step applies",
        "owner-action": "what to ask the owner",
      } as Record<string, string>
    )[kind] ?? ""
  );
}
function gateTextLabel(kind: string) {
  return (
    (
      {
        check: "check kind",
        script: "command",
        agent: "what to review",
        "owner-action": "what the owner does",
      } as Record<string, string>
    )[kind] ?? "text"
  );
}
