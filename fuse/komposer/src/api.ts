// SPDX-License-Identifier: Apache-2.0
// Typed client for Komposer's local server. The token travels in
// location.hash (#token=...); we read it once, keep it in sessionStorage so a
// reload does not lose it, and strip it from the URL bar.

import type { Session, WorkflowFile } from "./workflowView.ts";

const STORAGE_KEY = "komposer-token";

function readToken(): string {
  const fromHash = /(?:^#|[?&])token=([^&]+)/.exec(location.hash);
  if (fromHash) {
    const token = decodeURIComponent(fromHash[1]);
    sessionStorage.setItem(STORAGE_KEY, token);
    history.replaceState(null, "", location.pathname + location.search);
    return token;
  }
  return sessionStorage.getItem(STORAGE_KEY) ?? "";
}

export const token = readToken();

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  session: () => request<Session>("session"),
  workflows: () => request<{ workflows: WorkflowFile[] }>("workflows"),
  updateWorkflow: (path: string, baseHash: string, text: string) =>
    request<{ path: string; hash: string }>("workflows", {
      method: "PUT",
      body: JSON.stringify({ path, baseHash, text }),
    }),
  saveNewWorkflow: (location: string, folder: string, file: string, text: string) =>
    request<{ path: string; hash: string }>("workflows", {
      method: "POST",
      body: JSON.stringify({ location, folder, file, text }),
    }),
  putWorkingCopy: (path: string, text: string) =>
    request<{ path: string }>("working-copies", { method: "PUT", body: JSON.stringify({ path, text }) }),
  deleteWorkingCopy: (path: string) =>
    request<Record<string, never>>("working-copies", { method: "DELETE", body: JSON.stringify({ path }) }),
  library: () => request<{ entries: LibraryEntry[] }>("library"),
  workstreams: () => request<{ workstreams: WorkstreamSummary[] }>("workstreams"),
  watchUrl: (path: string) => `/api/watch?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`,
};

export interface LibraryEntry {
  id: string;
  level: "project" | "user" | "package";
  folder: string;
  // From the entry's entry.yml.
  description?: string;
  entryProblem?: string;
  files: Record<string, string>;
  guideMissing?: string;
  hides?: "project" | "user" | "package";
  hiddenBy?: "project" | "user" | "package";
}

export interface RunEvent {
  time: string;
  step: string;
  kind: string;
  from: string;
  to: string;
  actor?: "agent" | "owner";
  detail: string;
  backFrom?: string;
  backTo?: string;
}

export interface WorkstreamSummary {
  slug: string;
  workflow?: string;
  workflowPath?: string;
  error?: string;
  steps?: Record<string, unknown>;
  events?: RunEvent[];
  summary?: {
    status: string;
    currentStep?: string;
    started?: string;
    lastEvent?: string;
    ownerWaitMs: number;
    routesBack: { time: string; from: string; to: string }[];
    steps: Record<
      string,
      { status: string; activeMs: number; ownerWaitMs: number; visits: number; skipReason?: string }
    >;
  };
}

// The drag-and-drop type of a library entry dragged from the Library tab.
export const ARTIFACT_DRAG = "application/x-komposer-artifact";

// Where a new artifact goes unless the author says otherwise.
export function suggestPath(id: string): string {
  return id === "code" ? "." : `.konductor/{slug}/${id}.md`;
}

// G/T/R presence for one artifact id, resolved project > personal > package.
export function resolveLibrary(
  entries: LibraryEntry[],
  artifactId: string,
): { level: LibraryEntry["level"]; g: boolean; t: boolean; r: boolean } | null {
  const order: LibraryEntry["level"][] = ["project", "user", "package"];
  const candidates = entries.filter((e) => e.id === artifactId);
  for (const level of order) {
    const e = candidates.find((c) => c.level === level);
    if (e) {
      const t = Object.keys(e.files).some((f) => f.startsWith("template."));
      return { level, g: !!e.files["guide.md"], t, r: !!e.files["review.md"] };
    }
  }
  return null;
}
