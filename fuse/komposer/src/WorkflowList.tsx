// SPDX-License-Identifier: Apache-2.0
// Left lane: the workflow list grouped Project / Personal / fuse-flow, with
// folder rows, search, and the (inert for now) + button.

import { useState } from "react";
import { Plus } from "lucide-react";
import type { LibraryEntry, WorkstreamSummary } from "./api.ts";
import { gateCount, workflowKey, type LocationId, type OpenWorkflow } from "./workflowView.ts";
import { problemsForText } from "./validate.ts";
import { stepViews } from "./workflowView.ts";

const LOCATION_ORDER: LocationId[] = ["project", "personal", "fuse-flow"];
const LOCATION_LABEL: Record<LocationId, string> = {
  project: "Project",
  personal: "Personal",
  "fuse-flow": "fuse-flow",
};
const LOCATION_ROOT: Record<LocationId, string> = {
  project: ".konductor/workflows/",
  personal: "~/.konductor/workflows/",
  "fuse-flow": "fuse-flow/workflows/",
};

function stem(file: string) {
  return file.replace(/\.ya?ml$/, "");
}

export function WorkflowList({
  workflows,
  currentKey,
  onOpen,
  workstreams,
  onNew,
}: {
  workflows: OpenWorkflow[];
  currentKey: string | null;
  onOpen: (key: string) => void;
  workstreams: WorkstreamSummary[];
  onNew: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const groups = LOCATION_ORDER.map((loc) => {
    const inLoc = workflows
      .filter((w) => w.location === loc && (!q || `${w.dir}${w.file}`.toLowerCase().includes(q)))
      .sort((a, b) => `${a.dir}${a.file}`.localeCompare(`${b.dir}${b.file}`));
    return { loc, workflows: inLoc };
  }).filter((g) => g.workflows.length > 0);

  const runsFor = (w: OpenWorkflow) => workstreams.filter((ws) => ws.workflowPath === w.path);

  return (
    <div className="lane">
      <div className="lane-head">
        <div className="brand-disc" />
        <div className="brand-name">Komposer</div>
      </div>
      <div className="lane-search">
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search workflows"
        />
        <button className="new-workflow-btn" title="New workflow" onClick={onNew}>
          <Plus size={18} strokeWidth={1.75} />
        </button>
      </div>
      <div className="lane-list">
        {groups.map((group) => {
          const shownFolders = new Set<string>();
          return (
            <div key={group.loc}>
              <div className="lane-group-head">
                <span className="lane-group-label">{LOCATION_LABEL[group.loc]}</span>
                <span className="lane-group-root">{LOCATION_ROOT[group.loc]}</span>
              </div>
              {group.workflows.map((w) => {
                const key = workflowKey(w);
                const parts = w.dir.split("/").filter(Boolean);
                const folderRows: React.ReactNode[] = [];
                parts.forEach((part, depth) => {
                  const prefix = parts.slice(0, depth + 1).join("/");
                  if (!shownFolders.has(prefix)) {
                    shownFolders.add(prefix);
                    folderRows.push(
                      <div key={prefix} className="lane-folder-row" style={{ paddingLeft: `${10 + depth * 12}px` }}>
                        {part}/
                      </div>,
                    );
                  }
                });
                const steps = stepViews(w);
                const problemCount = problemsForText(w.openText).length;
                const dirty = !w.onDisk || w.openText !== w.text;
                const nRuns = runsFor(w).length;
                return (
                  <div key={key}>
                    {folderRows}
                    <button
                      className={`lane-row${key === currentKey ? " is-current" : ""}`}
                      onClick={() => onOpen(key)}
                      title={w.path}
                      style={{ paddingLeft: `${10 + parts.length * 12}px` }}
                    >
                      <span className="lane-row-head">
                        <span className="lane-row-name">{stem(w.file)}</span>
                        {problemCount > 0 && <span className="dot dot-problem" title="Has problems" />}
                        {dirty && <span className="dot dot-unsaved" title="Unsaved changes" />}
                      </span>
                      <span className="lane-row-meta">
                        {steps.length} steps · {gateCount(steps)} gates
                        {nRuns ? ` · ${nRuns} runs` : ""}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
        {groups.length === 0 && <div className="lane-empty">No match.</div>}
      </div>
    </div>
  );
}

export type { LibraryEntry };
