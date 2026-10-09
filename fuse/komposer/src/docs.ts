// SPDX-License-Identifier: Apache-2.0
// Field tooltip text, read from the schemas' `.meta({ description })` at
// build time rather than copied into Komposer. Each
// description ends with an "Engine effect:" sentence; we split on it.

import type { ZodType } from "zod";
import { ArtifactSchema, StepSchema } from "../../flow/src/schemas/step.ts";
import { WorkflowSchema } from "../../flow/src/schemas/workflow.ts";
import { GateSchema } from "../../flow/src/schemas/gate.ts";

export interface FieldDoc {
  yamlKey: string;
  required: boolean;
  description: string;
  engineEffect?: string;
}

function split(description: string): { description: string; engineEffect?: string } {
  const marker = "Engine effect:";
  const idx = description.indexOf(marker);
  if (idx < 0) return { description };
  return { description: description.slice(0, idx).trim(), engineEffect: description.slice(idx + marker.length).trim() };
}

function doc(yamlKey: string, required: boolean, schema: ZodType): FieldDoc {
  const { description = "" } = (schema.meta?.() ?? {}) as { description?: string };
  return { yamlKey, required, ...split(description) };
}

// WorkflowSchema is a refined (superRefine) schema; the base object schema's
// shape lives on its inner type.
const wfShape =
  (WorkflowSchema.def as unknown as { innerType?: { shape: Record<string, ZodType> } }).innerType?.shape ??
  (WorkflowSchema as unknown as { shape: Record<string, ZodType> }).shape;
const stepShape = StepSchema.shape;
const artifactShape = ArtifactSchema.shape;

export const DOCS: Record<string, FieldDoc> = {
  wfName: doc("name", true, wfShape.name),
  wfDescription: doc("description", false, wfShape.description),
  version: doc("version: 1", true, wfShape.version),
  id: doc("id", true, stepShape.id),
  title: doc("title", false, stepShape.title),
  description: doc("description", false, stepShape.description),
  phase: doc("phase", false, stepShape.phase),
  instruction: doc("instruction", true, stepShape.instruction),
  condition: doc("condition", false, stepShape.condition),
  consumes: doc("consumes", false, stepShape.consumes),
  produces: doc("produces", false, stepShape.produces),
  optional_produces: doc("optional_produces", false, stepShape.optional_produces),
  updates: doc("updates", false, stepShape.updates),
  gates: doc("gates", false, stepShape.gates),
  artifact: doc("artifact", true, artifactShape.artifact),
  path: doc("path", true, artifactShape.path),
  artDescription: doc("description", false, artifactShape.description),
};

// Gate-kind docs: GateSchema is a union of per-kind mapping shapes (plus a
// string form); we pull each kind's text-field description from the first
// mapping option that has it.
type ShapeHolder = { def?: { shape?: Record<string, ZodType> } };

function gateUnionOptions(): ShapeHolder[] {
  return (GateSchema.def as unknown as { options: ShapeHolder[] }).options;
}

function fieldFromGateUnion(key: string, required: boolean): FieldDoc {
  for (const option of gateUnionOptions()) {
    const field = option.def?.shape?.[key];
    if (field) return doc(key, required, field);
  }
  return { yamlKey: key, required, description: "" };
}

export const GATE_KIND_DOCS: Record<"owner-action" | "check" | "script" | "agent", FieldDoc> = {
  "owner-action": fieldFromGateUnion("owner-action", true),
  check: fieldFromGateUnion("check", true),
  script: fieldFromGateUnion("script", true),
  agent: fieldFromGateUnion("agent", true),
};

export const GATE_FIELD_DOCS = {
  maxRounds: fieldFromGateUnion("max_rounds", false),
  guide: fieldFromGateUnion("guide", false),
  routeBack: fieldFromGateUnion("route_back_to", false),
  gateDescription: fieldFromGateUnion("description", false),
};
