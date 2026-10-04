// SPDX-License-Identifier: Apache-2.0

import type { WorkstreamSummary } from "./api.ts";

export type RunState = "PENDING" | "IN_PROGRESS" | "AWAITING_OWNER" | "BLOCKED" | "COMPLETED" | "SKIPPED";

export const RUN_STATE: Record<RunState, { label: string; className: string }> = {
  PENDING: { label: "not started", className: "pending" },
  IN_PROGRESS: { label: "in progress", className: "progress" },
  AWAITING_OWNER: { label: "waiting for owner", className: "waiting" },
  BLOCKED: { label: "blocked", className: "blocked" },
  COMPLETED: { label: "completed", className: "completed" },
  SKIPPED: { label: "skipped", className: "skipped" },
};

export function runState(value?: string): RunState {
  return value && value in RUN_STATE ? (value as RunState) : "PENDING";
}

export function duration(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function runDuration(run: WorkstreamSummary, now = Date.now()): number {
  const start = Date.parse(run.summary?.started ?? "");
  if (Number.isNaN(start)) return 0;
  const completed = run.summary?.status === "COMPLETED";
  const end = completed ? Date.parse(run.summary?.lastEvent ?? "") : now;
  return Math.max(0, (Number.isNaN(end) ? now : end) - start);
}

export function dateTime(value?: string): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function runOption(run: WorkstreamSummary): string {
  return `${run.slug} · ${RUN_STATE[runState(run.summary?.status)].label}`;
}
