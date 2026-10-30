// SPDX-License-Identifier: Apache-2.0
import type { StageReason } from './model.ts';

/** How the stub answers `POST /api/run` for a workflow. */
export interface Behavior {
  /** The workflow needs trust and has none. */
  untrusted?: boolean;
  /** A run of the workspace is active, and another program started it. */
  busy?: boolean;
  /** The harness of the run is not installed or not signed in. */
  harnessUnavailable?: boolean;
  /**
   * The run stops at the stage in this place of the list, or at the last
   * stage if the list is shorter, and that stage is blocked for this reason.
   */
  blocks?: { stage: number; reason: StageReason };
}

export interface Fixture {
  text: string;
  behavior: Behavior;
}

// The same workflow under each name, so that every fixture shows the keys of
// the first release. The `prompt_file` is a path only: the stub reads no
// files.
const workflow = (
  name: string,
  extraStages = '',
): string => `format: konductor/1
name: ${name}
version: 0.1.0
intent:
  outcome: Add a greeting to the README
  accept:
    - id: readme-exists
      file: README.md
params:
  goal:
    description: What the workflow should accomplish.
    default: Add a greeting to the README
stages:
  - name: draft
    agent: k-developer
    prompt: Write the greeting to README.md.
  - name: review
    agent: k-quality-assurance
    prompt_file: review.md
${extraStages}`;

const WRAP_UP = `  - name: wrap-up
    agent: k-developer
`;

/**
 * The workflows the stub can serve as its root. `hello` runs and passes. The
 * others show what a client must handle: a workflow that needs trust, a run
 * that ends with a blocked stage, and a run that another program started.
 */
export const FIXTURES: Readonly<Record<string, Fixture>> = {
  hello: { text: workflow('hello'), behavior: {} },
  untrusted: { text: workflow('untrusted'), behavior: { untrusted: true } },
  blocked: {
    text: workflow('blocked', WRAP_UP),
    behavior: { blocks: { stage: 1, reason: 'RESULT_MISSING' } },
  },
  busy: { text: workflow('busy'), behavior: { busy: true } },
};

/** The workflow the stub serves unless it is told another, and so the root. */
export const SAMPLE_ROOT = 'hello';

/** The files at the start: one per fixture, by name. */
export const SAMPLE_FILES: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(FIXTURES).map(([name, fixture]) => [name, fixture.text]),
  );
