// SPDX-License-Identifier: Apache-2.0
// One screen: the workflow list on the left, the selected workflow's steps in the middle.

import { useEffect, useState } from "react";
import { StepsFlow } from "./StepsFlow.tsx";
import { workflows, workflowsDir, type Workflow } from "./workflows.ts";

const gateCount = (w: Workflow) => w.steps.reduce((n, s) => n + s.gates.length, 0);
const stem = (file: string) => file.replace(/\.yml$/, "");
const fromHash = () => decodeURIComponent(location.hash.slice(1));

function WorkflowList({ current, onOpen }: { current: string; onOpen: (path: string) => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = workflows.filter((w) => !q || w.path.toLowerCase().includes(q));
  const grouped = new Set(workflows.map((w) => w.dir)).size > 1;

  return (
    <div className="lane">
      <div className="lane-head">
        <div className="brand-disc" />
        <div className="brand-name">fuse-flow</div>
      </div>
      <div className="lane-search">
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search workflows"
        />
      </div>
      <div className="lane-list">
        {shown.map((w, i) => (
          <div key={w.path} style={{ display: "contents" }}>
            {grouped && w.dir !== shown[i - 1]?.dir && <div className="lane-group">{w.dir || "/"}</div>}
            <button
              className={`lane-row${w.path === current ? " is-current" : ""}`}
              onClick={() => onOpen(w.path)}
              title={`${workflowsDir}/${w.path}`}
            >
              <span className="lane-row-name">{stem(w.file)}</span>
              <span className="lane-row-meta">
                {w.error ? "invalid" : `${w.steps.length} steps · ${gateCount(w)} gates`}
              </span>
            </button>
          </div>
        ))}
        {shown.length === 0 && <div className="lane-empty">No match.</div>}
      </div>
      <div className="lane-foot">{workflowsDir}</div>
    </div>
  );
}

function WorkflowView({ workflow }: { workflow: Workflow }) {
  return (
    <div className="center">
      <div className="center-head">
        <div className="center-title">{workflow.file}</div>
      </div>
      <div className="center-body">
        {workflow.error && <div className="error">{workflow.error}</div>}
        <div className="fields">
          <label className="field">
            Description
            <input className="input" value={workflow.description} readOnly />
          </label>
          <label className="field">
            Max fix cycles
            <input className="input mono" value={workflow.maxFixCycles ?? ""} readOnly />
          </label>
        </div>
        <StepsFlow workflow={workflow} />
      </div>
    </div>
  );
}

export function App() {
  const [current, setCurrent] = useState(() => fromHash() || workflows[0]?.path || "");

  useEffect(() => {
    const onHash = () => setCurrent(fromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const open = (path: string) => {
    location.hash = encodeURIComponent(path);
    setCurrent(path);
  };
  const workflow = workflows.find((w) => w.path === current);

  return (
    <div className="screen">
      <WorkflowList current={current} onOpen={open} />
      {workflow ? <WorkflowView workflow={workflow} /> : <div className="center-empty">Select a workflow</div>}
    </div>
  );
}
