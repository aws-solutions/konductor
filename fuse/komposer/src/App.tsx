// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { api, ApiError, suggestPath, type LibraryEntry, type ReviewGuides, type WorkstreamSummary } from "./api.ts";
import { applyEdit, type Edit, type OutputMode } from "./model/yamlEdit.ts";
import { addArtifactEdits, describeFrom, insertArtifactStepEdits } from "./model/artifactInstruction.ts";
import {
  artifactCount,
  openWorkflow,
  newStepKey,
  routeBackCount,
  stepViews,
  workflowKey,
  type LocationId,
  type OpenWorkflow,
  type Session,
} from "./workflowView.ts";
import { problemsByStep, problemsForText } from "./validate.ts";
import { WorkflowList } from "./WorkflowList.tsx";
import { Flow } from "./Flow.tsx";
import { Inspector, type InspectorTab } from "./Inspector.tsx";
import { dateTime, duration, RUN_STATE, runDuration, runOption, runState } from "./runView.ts";

type SaveModal = { type: "save"; asNew: boolean; location: LocationId; folder: string; name: string; error?: string };
type NewModal = { type: "new"; location: LocationId; folder: string; name: string; error?: string };
type Modal = SaveModal | NewModal;
type DiskVersion = { text: string; hash: string; at: string };

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [workflows, setWorkflows] = useState<OpenWorkflow[]>([]);
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [workstreams, setWorkstreams] = useState<WorkstreamSummary[]>([]);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tab, setTab] = useState<InspectorTab>("step");
  const [compareRequest, setCompareRequest] = useState(0);
  const [runSlug, setRunSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPaths, setShowPaths] = useState(false);
  const [showDescriptions, setShowDescriptions] = useState(true);
  const [hoveredArtifact, setHoveredArtifact] = useState<string | null>(null);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [modal, setModal] = useState<Modal | null>(null);
  const [diskVersions, setDiskVersions] = useState<Record<string, DiskVersion>>({});
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = (message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2400);
  };
  const replaceWorkflow = (key: string, next: OpenWorkflow) =>
    setWorkflows((all) => all.map((w) => (workflowKey(w) === key ? next : w)));
  const reloadData = async () => {
    const [s, w, l, ws] = await Promise.all([api.session(), api.workflows(), api.library(), api.workstreams()]);
    const opened = w.workflows.map((file) => openWorkflow(file));
    setSession(s);
    setWorkflows(opened);
    setLibrary(l.entries);
    setWorkstreams(ws.workstreams);
    setCurrentKey((key) =>
      key && opened.some((x) => workflowKey(x) === key) ? key : opened[0] ? workflowKey(opened[0]) : null,
    );
  };
  useEffect(() => {
    reloadData().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const workflow = useMemo(() => workflows.find((w) => workflowKey(w) === currentKey) ?? null, [workflows, currentKey]);
  const steps = useMemo(() => (workflow ? stepViews(workflow) : []), [workflow]);
  const problems = useMemo(() => (workflow ? problemsForText(workflow.openText) : []), [workflow]);
  const byStep = useMemo(() => problemsByStep(problems), [problems]);
  const dirty = !!workflow && workflow.openText !== workflow.text;
  const disk = currentKey ? diskVersions[currentKey] : undefined;
  const runsForWorkflow = workflow ? workstreams.filter((item) => item.workflowPath === workflow.path) : [];
  const run = runSlug ? runsForWorkflow.find((item) => item.slug === runSlug) : undefined;

  // Working copies are the crash-safe form of every edit; equal text removes it.
  useEffect(() => {
    if (!workflow) return;
    const timer = window.setTimeout(() => {
      const op =
        workflow.openText === workflow.text
          ? api.deleteWorkingCopy(workflow.path)
          : api.putWorkingCopy(workflow.path, workflow.openText);
      op.catch((e) => showToast(e instanceof Error ? e.message : String(e)));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [workflow?.path, workflow?.openText, workflow?.text]);

  // The review guides the engine gives the open text's agent gates. Asked
  // again shortly after each edit; a failed request leaves the last answer.
  const [guides, setGuides] = useState<{ path: string; result: ReviewGuides } | null>(null);
  const reviewGuides = guides && guides.path === workflow?.path ? guides.result : null;
  useEffect(() => {
    if (!workflow) return;
    let current = true;
    const timer = window.setTimeout(() => {
      api
        .reviewGuides(workflow.path, workflow.openText)
        .then((result) => current && setGuides({ path: workflow.path, result }))
        .catch(() => {});
    }, 300);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [workflow?.path, workflow?.openText]);

  // Watch the open original. Clean files reload silently; dirty files retain their text and get the conflict banner.
  useEffect(() => {
    if (!workflow?.onDisk) return;
    const source = new EventSource(api.watchUrl(workflow.path));
    source.addEventListener("change", async (event) => {
      const change = JSON.parse((event as MessageEvent).data) as { hash: string | null };
      if (!change.hash || change.hash === workflow.hash) return;
      const listed = (await api.workflows()).workflows.find((w) => w.path === workflow.path);
      if (!listed) return;
      const fresh = openWorkflow(listed);
      const key = workflowKey(workflow);
      if (workflow.openText === workflow.text) replaceWorkflow(key, fresh);
      else
        setDiskVersions((all) => ({
          ...all,
          [key]: {
            text: listed.text,
            hash: listed.hash,
            at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        }));
    });
    return () => source.close();
  }, [workflow?.path, workflow?.hash, workflow?.openText, workflow?.text, workflow?.onDisk]);

  // Applies one edit, or several in order as one change: either all apply or none.
  const apply = (edits: Edit | Edit[]) => {
    if (!workflow || !currentKey) return;
    const list = Array.isArray(edits) ? edits : [edits];
    try {
      let nextText = workflow.openText;
      const stepKeys = [...workflow.stepKeys];
      for (const edit of list) {
        nextText = applyEdit(nextText, edit);
        if (edit.op === "insertStep") stepKeys.splice(edit.at, 0, newStepKey());
        if (edit.op === "deleteStep") stepKeys.splice(edit.index, 1);
        if (edit.op === "moveStep") {
          const [key] = stepKeys.splice(edit.from, 1);
          stepKeys.splice(edit.to, 0, key);
        }
      }
      const next = openWorkflow({
        ...workflow,
        stepKeys,
        workingCopy: nextText === workflow.text ? undefined : nextText,
      });
      replaceWorkflow(currentKey, next);
      for (const edit of list) {
        if (edit.op === "insertStep") setSelectedIndex(edit.at);
        if (edit.op === "moveStep") setSelectedIndex(edit.to);
        if (edit.op === "deleteStep")
          setSelectedIndex((i) => Math.max(0, Math.min(i > edit.index ? i - 1 : i, steps.length - 2)));
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };
  // Adding an artifact pre-fills a generated instruction (decision 18).
  const addArtifact = (step: number, mode: OutputMode, artifact: string, path = suggestPath(artifact)) => {
    if (!workflow) return;
    try {
      apply(addArtifactEdits(workflow.openText, step, mode, artifact, path, describeFrom(library)));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };
  const insertArtifactStep = (at: number, artifact: string) => {
    if (!workflow) return;
    try {
      apply(insertArtifactStepEdits(workflow.openText, at, artifact, suggestPath(artifact), describeFrom(library)));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };
  const uniqueStepId = () => {
    let id = "new-step",
      n = 2;
    while (steps.some((s) => s.id === id)) id = `new-step-${n++}`;
    return id;
  };
  const openWorkflowKey = (key: string) => {
    setCurrentKey(key);
    setSelectedIndex(0);
    setTab("step");
    setCompareRequest(0);
    setRunSlug(null);
    setProblemsOpen(false);
  };

  const discard = async () => {
    if (!workflow || !currentKey) return;
    await api.deleteWorkingCopy(workflow.path);
    const base = disk ? { text: disk.text, hash: disk.hash } : { text: workflow.text, hash: workflow.hash };
    replaceWorkflow(currentKey, openWorkflow({ ...workflow, ...base, workingCopy: undefined }, true));
    setDiskVersions((all) => {
      const next = { ...all };
      delete next[currentKey];
      return next;
    });
    showToast(`Discarded changes to ${workflow.file}`);
  };

  const openRun = (slug: string) => {
    setRunSlug(slug);
    setTab("run");
    setProblemsOpen(false);
  };
  const closeRun = () => {
    setRunSlug(null);
    setCompareRequest(0);
    setTab("step");
  };
  const openWorkflowStep = (key: string, stepIndex: number) => {
    setCurrentKey(key);
    setSelectedIndex(stepIndex);
    setRunSlug(null);
    setCompareRequest(0);
    setTab("step");
  };

  const createNew = () => setModal({ type: "new", location: "project", folder: "", name: "" });
  const confirmNew = () => {
    if (!session || modal?.type !== "new" || !/^[a-z0-9][a-z0-9-]*$/.test(modal.name)) return;
    const location = session.locations.find((x) => x.id === modal.location)!;
    const dir = modal.folder ? `${modal.folder.replace(/^\/+|\/+$/g, "")}/` : "";
    const file = `${modal.name}.yml`;

    if (workflows.some((w) => w.location === modal.location && w.dir === dir.replace(/\/$/, "") && w.file === file)) {
      setModal({ ...modal, error: "A workflow with this file name exists there." });
      return;
    }
    const text = `version: 1\nname: ${modal.name}\nsteps:\n  - id: new-step\n    instruction: >\n      \n`;
    const created = openWorkflow({
      location: modal.location,
      dir: dir.replace(/\/$/, ""),
      file,
      path: `${location.path}/${dir}${file}`,
      onDisk: false,
      text: "",
      hash: "",
      workingCopy: text,
    });
    setWorkflows((all) => [...all, created]);
    setCurrentKey(workflowKey(created));
    setSelectedIndex(0);
    setTab("step");
    setModal(null);
  };

  const openSave = () =>
    workflow &&
    setModal({
      type: "save",
      asNew: !workflow.onDisk,
      location: workflow.location,
      folder: workflow.dir,
      name: workflow.file.replace(/\.ya?ml$/, ""),
    });
  const save = async () => {
    if (!workflow || !currentKey || modal?.type !== "save") return;
    try {
      if (modal.asNew) {
        const result = await api.saveNewWorkflow(modal.location, modal.folder, modal.name, workflow.openText);
        await api.deleteWorkingCopy(workflow.path);
        const dir = modal.folder.replace(/^\/+|\/+$/g, "");
        const file = `${modal.name}.yml`;
        const saved = openWorkflow({
          location: modal.location,
          dir,
          file,
          path: result.path,
          onDisk: true,
          text: workflow.openText,
          hash: result.hash,
        });
        setWorkflows((all) =>
          all.flatMap((entry) => {
            if (workflowKey(entry) !== currentKey) return [entry];
            if (!workflow.onDisk) return [saved];
            // The original as it is on disk now: its disk version when the
            // file changed underneath the working copy.
            const base = disk ? { text: disk.text, hash: disk.hash } : {};
            const original = openWorkflow({ ...workflow, ...base, workingCopy: undefined }, true);
            return [original, saved];
          }),
        );
        setDiskVersions((all) => {
          const next = { ...all };
          delete next[currentKey];
          return next;
        });
        setCurrentKey(workflowKey(saved));
        showToast(`Saved ${result.path}`);
      } else {
        const result = await api.updateWorkflow(workflow.path, workflow.hash, workflow.openText);
        await api.deleteWorkingCopy(workflow.path);
        replaceWorkflow(
          currentKey,
          openWorkflow({ ...workflow, text: workflow.openText, hash: result.hash, workingCopy: undefined }, true),
        );
        setDiskVersions((all) => {
          const next = { ...all };
          delete next[currentKey];
          return next;
        });
        showToast(`Updated ${workflow.path}`);
      }
      setModal(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && !modal.asNew) {
        const listed = (await api.workflows()).workflows.find((w) => w.path === workflow.path);
        if (listed)
          setDiskVersions((all) => ({
            ...all,
            [currentKey]: {
              text: listed.text,
              hash: listed.hash,
              at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            },
          }));
        setModal(null);
      } else setModal({ ...modal, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const loadDisk = async () => {
    if (!workflow || !currentKey || !disk) return;
    await api.deleteWorkingCopy(workflow.path);
    replaceWorkflow(
      currentKey,
      openWorkflow({ ...workflow, text: disk.text, hash: disk.hash, workingCopy: undefined }, true),
    );
    setDiskVersions((all) => {
      const next = { ...all };
      delete next[currentKey];
      return next;
    });
    showToast("Loaded disk version");
  };
  const keepEdits = () => {
    if (!workflow || !currentKey || !disk) return;
    replaceWorkflow(
      currentKey,
      openWorkflow({ ...workflow, text: disk.text, hash: disk.hash, workingCopy: workflow.openText }, true),
    );
    setDiskVersions((all) => {
      const next = { ...all };
      delete next[currentKey];
      return next;
    });
    showToast("Kept my edits");
  };

  if (error) return <div className="app-error">Failed to load Komposer: {error}</div>;
  if (!session || !workflow) return <div className="app-loading">Loading…</div>;
  const status = run
    ? "run · read-only"
    : !workflow.onDisk
      ? "new · working copy"
      : dirty
        ? "modified · working copy"
        : "saved";
  const activeRuns = workstreams.filter((w) => w.workflowPath === workflow.path && w.summary?.status !== "COMPLETED");
  const structural = structureChanges(workflow, steps);

  return (
    <div className="screen">
      <WorkflowList
        workflows={workflows}
        currentKey={currentKey}
        onOpen={openWorkflowKey}
        workstreams={workstreams}
        onNew={createNew}
      />
      <div className="center">
        <div className="center-header">
          <div className="center-header-main">
            <div className="center-header-title">{workflow.file}</div>
            <div className="center-header-sub">
              <span className={`center-header-status${dirty ? " is-dirty" : ""}`}>{status}</span>
              <span className="center-header-path mono">{workflow.path}</span>
            </div>
          </div>
          {!run && problems.length > 0 && (
            <button className="problems-chip" onClick={() => setProblemsOpen((v) => !v)}>
              {problems.length} problem{problems.length === 1 ? "" : "s"}
            </button>
          )}
          {!run && dirty && workflow.onDisk && (
            <button className="discard-btn" onClick={discard}>
              Discard changes
            </button>
          )}
          {!run && (
            <button
              className={`save-btn${dirty && !problems.length ? " is-enabled" : " is-disabled"}`}
              disabled={!dirty || !!problems.length}
              title={problems.length ? "Fix the problems to save" : ""}
              onClick={openSave}
            >
              Save…
            </button>
          )}
          {problemsOpen && (
            <div className="problems-popover">
              {problems.map((p, i) => (
                <button
                  key={i}
                  className="problems-popover-row"
                  onClick={() => {
                    if (p.stepIndex >= 0) {
                      setSelectedIndex(p.stepIndex);
                      setTab("step");
                    }
                    setProblemsOpen(false);
                  }}
                >
                  <span className="mono">
                    {p.stepIndex >= 0 ? `${p.stepIndex + 1} · ${steps[p.stepIndex]?.id ?? ""}` : "workflow"}
                  </span>
                  <span className="problems-popover-msg">{p.message}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {disk && (
          <div className="disk-banner">
            <span>
              {workflow.file} changed on disk at {disk.at}. Your working copy has unsaved edits.
            </span>
            <button
              onClick={() => {
                setTab("yaml");
                setCompareRequest((request) => request + 1);
              }}
            >
              Compare
            </button>
            <button onClick={loadDisk}>Load disk version</button>
            <button className="keep" onClick={keepEdits}>
              Keep my edits
            </button>
          </div>
        )}
        <div className="toolbar">
          <span className="toolbar-counts">
            {steps.length} steps · {artifactCount(steps)} artifacts · {routeBackCount(steps)} routes back
          </span>
          <span className="grow" />
          <button className={`toggle-pill-btn${showPaths ? " is-on" : ""}`} onClick={() => setShowPaths((v) => !v)}>
            paths
          </button>
          <button
            className={`toggle-pill-btn${showDescriptions ? " is-on" : ""}`}
            onClick={() => setShowDescriptions((v) => !v)}
          >
            descriptions
          </button>
          <select
            className="runs-select"
            value={runSlug ?? ""}
            onChange={(event) => (event.target.value ? openRun(event.target.value) : closeRun())}
          >
            <option value="">{runsForWorkflow.length ? `Runs · ${runsForWorkflow.length}` : "No runs"}</option>
            {runsForWorkflow.map((item) => (
              <option key={item.slug} value={item.slug}>
                {runOption(item)}
              </option>
            ))}
          </select>
        </div>
        {run && <RunBanner run={run} onClose={closeRun} />}
        <Flow
          steps={steps}
          selectedIndex={selectedIndex}
          onSelect={(i) => {
            setSelectedIndex(i);
            setTab(run ? "run" : "step");
          }}
          problemsByStep={byStep}
          library={library}
          showPaths={showPaths}
          showDescriptions={showDescriptions}
          hoveredArtifact={hoveredArtifact}
          onHoverArtifact={setHoveredArtifact}
          onInsert={(at) => apply({ op: "insertStep", at, step: { id: uniqueStepId(), instruction: "" } })}
          onAppend={() => apply({ op: "insertStep", at: steps.length, step: { id: uniqueStepId(), instruction: "" } })}
          onMove={(from, to) => apply({ op: "moveStep", from, to })}
          onDelete={(index) => apply({ op: "deleteStep", index })}
          onDropArtifact={(step, artifact) => addArtifact(step, "produces", artifact)}
          onDropArtifactAt={insertArtifactStep}
          run={run}
        />
      </div>
      <Inspector
        tab={tab}
        onTab={(next) => {
          setTab(next);
          if (next !== "yaml") setCompareRequest(0);
          setProblemsOpen(false);
        }}
        workflow={workflow}
        steps={steps}
        selectedIndex={selectedIndex}
        problems={problems.filter((p) => p.stepIndex === selectedIndex)}
        library={library}
        workstreams={workstreams}
        diffBase={disk?.text ?? workflow.text}
        compareRequest={compareRequest}
        onEdit={apply}
        onAddArtifact={addArtifact}
        reviewGuides={reviewGuides}
        allWorkflows={workflows}
        run={run}
        onOpenRun={openRun}
        onOpenWorkflowStep={openWorkflowStep}
      />
      {modal && (
        <ModalView
          modal={modal}
          setModal={setModal}
          session={session}
          workflow={workflow}
          structural={structural}
          activeRuns={activeRuns}
          onConfirm={modal.type === "new" ? confirmNew : save}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function RunBanner({ run, onClose }: { run: WorkstreamSummary; onClose: () => void }) {
  const info = RUN_STATE[runState(run.summary?.status)];
  return (
    <div className="run-banner">
      <div className="run-banner-head">
        <strong>{run.slug}</strong>
        <span className={`run-state-pill ${info.className}`}>{info.label}</span>
        <span>
          started {dateTime(run.summary?.started)} · {duration(runDuration(run))}
        </span>
        <button onClick={onClose}>Close run</button>
      </div>
      <div className="run-legend">
        {Object.values(RUN_STATE).map((state) => (
          <span key={state.className}>
            <i className={state.className} />
            {state.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ModalView({
  modal,
  setModal,
  session,
  workflow,
  structural,
  activeRuns,
  onConfirm,
}: {
  modal: Modal;
  setModal: (m: Modal | null) => void;
  session: Session;
  workflow: OpenWorkflow;
  structural: string[];
  activeRuns: WorkstreamSummary[];
  onConfirm: () => void;
}) {
  const asNew = modal.type === "new" || modal.asNew;
  const valid = /^[a-z0-9][a-z0-9-]*$/.test(modal.name);
  const location = session.locations.find((x) => x.id === modal.location)!;
  const preview = `${location.path}/${modal.folder ? `${modal.folder.replace(/^\/+|\/+$/g, "")}/` : ""}${modal.name || "…"}.yml`;
  const warning = modal.type === "save" && !modal.asNew && structural.length > 0 && activeRuns.length > 0;
  const patch = (fields: Partial<Modal>) => setModal({ ...modal, ...fields } as Modal);
  return (
    <div className="modal-backdrop" onClick={() => setModal(null)}>
      <div className="save-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <h2>{modal.type === "new" ? "New workflow" : `Save ${workflow.file}`}</h2>
          <button className="icon-mini" onClick={() => setModal(null)}>
            <X />
          </button>
        </div>
        {modal.type === "save" && (
          <div className="save-options">
            <button
              className={!modal.asNew ? "is-selected" : ""}
              onClick={() => patch({ asNew: false, error: undefined })}
            >
              <strong>Update original</strong>
              <small>{workflow.path}</small>
            </button>
            <button
              className={modal.asNew ? "is-selected" : ""}
              onClick={() => patch({ asNew: true, error: undefined })}
            >
              <strong>Save as new file</strong>
              <small>leaves {workflow.file} as it is</small>
            </button>
          </div>
        )}
        {asNew && (
          <>
            <div className="segmented">
              {session.locations.map((x) => (
                <button
                  key={x.id}
                  className={`segmented-opt${modal.location === x.id ? " is-active" : ""}`}
                  onClick={() => patch({ location: x.id })}
                >
                  {x.id === "fuse-flow" ? "fuse-flow" : x.id}
                </button>
              ))}
            </div>
            <label className="field">
              <span className="field-label-row">Folder</span>
              <input
                className="field-input"
                value={modal.folder}
                onChange={(e) => patch({ folder: e.target.value, error: undefined })}
              />
            </label>
            <label className="field">
              <span className="field-label-row">File name</span>
              <input
                className="field-input mono-input"
                value={modal.name}
                onChange={(e) => patch({ name: e.target.value, error: undefined })}
                data-error={!!modal.name && !valid}
              />
            </label>
            <div className="target-preview">{preview}</div>
            {modal.name && !valid && <div className="field-error">Lower-case letters, digits and hyphens.</div>}
          </>
        )}
        {warning && (
          <div className="workstream-warning">
            <strong>
              {activeRuns.length} workstream{activeRuns.length === 1 ? "" : "s"} in progress on this workflow. Progress
              is stored by step id.
            </strong>
            {activeRuns.map((run) => (
              <div key={run.slug}>
                {run.slug} · {run.summary?.status.toLowerCase().replaceAll("_", " ")}
                {run.summary?.currentStep ? ` at ${run.summary.currentStep}` : ""}
              </div>
            ))}
            <div>{structural.join(" · ")}</div>
          </div>
        )}
        {modal.error && <div className="field-error">{modal.error}</div>}
        <div className="modal-actions">
          <button onClick={() => setModal(null)}>Cancel</button>
          <button className="primary-button" disabled={asNew && !valid} onClick={onConfirm}>
            {modal.type === "new" ? "Create" : warning ? "Save anyway" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function structureChanges(workflow: OpenWorkflow, currentSteps: ReturnType<typeof stepViews>): string[] {
  const current = workflow.stepKeys.map((key, index) => ({ key, id: currentSteps[index]?.id ?? "", index }));
  const out: string[] = [];
  workflow.savedSteps.forEach((saved) => {
    const now = current.find((step) => step.key === saved.key);
    if (!now) {
      out.push(`deleted ${saved.id}`);
      return;
    }
    if (now.id !== saved.id) out.push(`renamed ${saved.id} → ${now.id}`);
  });
  current
    .filter((step) => !workflow.savedSteps.some((saved) => saved.key === step.key))
    .forEach((step) => out.push(`added ${step.id}`));

  const savedCommon = workflow.savedSteps.filter((saved) => current.some((step) => step.key === saved.key));
  const currentCommon = current.filter((step) => workflow.savedSteps.some((saved) => saved.key === step.key));
  savedCommon.forEach((saved, savedRank) => {
    const currentRank = currentCommon.findIndex((step) => step.key === saved.key);
    if (currentRank === savedRank) return;
    const now = currentCommon[currentRank];
    const savedIndex = workflow.savedSteps.findIndex((step) => step.key === saved.key);
    out.push(`moved ${now.id} ${savedIndex + 1} → ${now.index + 1}`);
  });
  return out;
}
