// SPDX-License-Identifier: Apache-2.0
// The schema of a library entry's entry.yml: what the entry is, apart from its
// guide, template and review guide. `bun run schema` writes it to
// library-entry.schema.json.

import { z } from "zod";

export const LibraryEntrySchema = z
  .object({
    description: z.string().trim().min(1).meta({
      description:
        "One sentence on what the artifact is and what it is for. Engine effect: none. Komposer shows it in the " +
        "library and pre-fills a step's empty instruction from it when the artifact is added to the step.",
      examples: ["The architecture and the decisions behind it."],
    }),
  })
  .strict()
  .meta({
    id: "LibraryEntry",
    title: "fuse-flow library entry",
    description: "library/artifacts/<id>/entry.yml: what one artifact in the library is.",
  });

export type LibraryEntryFile = z.infer<typeof LibraryEntrySchema>;
