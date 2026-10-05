// SPDX-License-Identifier: Apache-2.0
// Left lane: the workflow list grouped Project / Personal / fuse-flow, with
// folder rows that open and close (kept in localStorage), search, and the +
// button. While searching, every match is shown.

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { folderPrefixes, useFolderState } from "./folders.ts";
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
  const folders = useFolderState("komposer-workflow-folders");
  // A section or folder is shown open while searching, so no match is hidden.
  const sectionOpen = (loc: LocationId) => !!q || folders.isOpen(`${loc}:`, "", true);
  const folderOpen = (loc: LocationId, prefix: string, name: string) => !!q || folders.isOpen(`${loc}:${prefix}`, name);

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
              <button
                className="lane-group-head lane-toggle"
                aria-expanded={sectionOpen(group.loc)}
                onClick={() => folders.toggle(`${group.loc}:`, "", true)}
              >
                <Chevron open={sectionOpen(group.loc)} />
                <span className="lane-group-label">{LOCATION_LABEL[group.loc]}</span>
                <span className="lane-group-root">{LOCATION_ROOT[group.loc]}</span>
              </button>
              {sectionOpen(group.loc) &&
                group.workflows.map((w) => {
                  const key = workflowKey(w);
                  const parts = folderPrefixes(w.dir);
                  const folderRows: React.ReactNode[] = [];
                  // A row is shown when every folder above it is open.
                  let visible = true;
                  parts.forEach(({ prefix, name }, depth) => {
                    if (!visible) return;
                    const open = folderOpen(group.loc, prefix, name);
                    if (!shownFolders.has(prefix)) {
                      shownFolders.add(prefix);
                      folderRows.push(
                        <button
                          key={prefix}
                          className="lane-folder-row lane-toggle"
                          aria-expanded={open}
                          style={{ paddingLeft: `${10 + depth * 12}px` }}
                          onClick={() => folders.toggle(`${group.loc}:${prefix}`, name)}
                        >
                          <Chevron open={open} />
                          {name}/
                        </button>,
                      );
                    }
                    visible = open;
                  });
                  if (!visible) return <div key={key}>{folderRows}</div>;
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

export function Chevron({ open }: { open: boolean }) {
  return open ? (
    <ChevronDown size={12} strokeWidth={2} className="lane-chevron" />
  ) : (
    <ChevronRight size={12} strokeWidth={2} className="lane-chevron" />
  );
}

export type { LibraryEntry };
