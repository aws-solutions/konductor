// SPDX-License-Identifier: Apache-2.0
// Writes one JSON Schema file per schema in this folder (workflow, step,
// artifact, gate, condition, the policy file and a library entry's entry.yml)
// into workflows/schemas/, so editors can validate workflow files and show
// each field's description. The files refer to each other by relative path.
//
//   bun run schema            write the files
//   bun run schema --check    exit 1 if a file is not what this would write

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import "./workflow.ts"; // registers the Workflow, Step, Artifact and Gate schemas by id
import "./policy.ts"; // registers the Policy schema
import "./library.ts"; // registers the LibraryEntry schema

export const JSON_SCHEMA_DIR = resolve(import.meta.dir, "..", "..", "workflows", "schemas");

// The id each schema registers with, and the file it is written to.
const FILES: Record<string, string> = {
  Workflow: "workflow.schema.json",
  Step: "step.schema.json",
  Artifact: "artifact.schema.json",
  Gate: "gate.schema.json",
  Condition: "condition.schema.json",
  Policy: "policy.schema.json",
  LibraryEntry: "library-entry.schema.json",
};

// File name -> content.
export function jsonSchemas(): Record<string, string> {
  const { schemas } = z.toJSONSchema(z.globalRegistry, {
    // The shape a person writes, before defaults and transforms are applied.
    io: "input",
    // Draft 7 is the newest draft that every common YAML editor supports.
    target: "draft-7",
    uri: (id) => `./${FILES[id]}`,
    override: ({ jsonSchema }) => {
      // Zod copies the registry id into the output; in draft 7 `id` is not a keyword.
      delete jsonSchema.id;
      // Zod marks every integer with the safe-integer bounds; they are noise in a tooltip.
      if (jsonSchema.maximum === Number.MAX_SAFE_INTEGER) delete jsonSchema.maximum;
      if (jsonSchema.minimum === Number.MIN_SAFE_INTEGER) delete jsonSchema.minimum;
      // Zod refers to another schema through a one-item allOf; refer to it directly.
      const only = jsonSchema.allOf?.length === 1 && Object.keys(jsonSchema).length === 1 ? jsonSchema.allOf[0] : undefined;
      if (only && typeof only === "object" && "$ref" in only) {
        delete jsonSchema.allOf;
        Object.assign(jsonSchema, only);
      }
    },
  });
  const unexpected = Object.keys(schemas).filter((id) => !(id in FILES));
  if (unexpected.length) throw new Error(`no file name for schema id(s): ${unexpected.join(", ")}`);
  return Object.fromEntries(Object.entries(FILES).map(([id, file]) => [file, `${JSON.stringify(schemas[id], null, 2)}\n`]));
}

if (import.meta.main) {
  const expected = jsonSchemas();
  if (process.argv.includes("--check")) {
    const stale = Object.entries(expected)
      .map(([file, content]) => [join(JSON_SCHEMA_DIR, file), content])
      .filter(([path, content]) => !existsSync(path) || readFileSync(path, "utf8") !== content)
      .map(([path]) => path);
    if (stale.length) {
      console.error(`out of date: ${stale.join(", ")}; run: bun run schema`);
      process.exit(1);
    }
    console.log(`${JSON_SCHEMA_DIR} is up to date`);
  } else {
    mkdirSync(JSON_SCHEMA_DIR, { recursive: true });
    for (const [file, content] of Object.entries(expected)) writeFileSync(join(JSON_SCHEMA_DIR, file), content);
    console.log(`wrote ${Object.keys(expected).join(", ")} to ${JSON_SCHEMA_DIR}`);
  }
}
