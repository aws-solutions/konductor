// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXAMPLE = new URL(
  '../../../workflow-engine/examples/hello-plan.yml',
  import.meta.url,
);

/**
 * The `hello-plan` example of the workflow engine, a file of every slice 1
 * key, named `hello` so the stub serves it as its root. The stub reads only
 * the root, and the name of a file must be the name of the workflow.
 */
export const HELLO_PLAN_TEXT = renamed(
  readFileSync(fileURLToPath(EXAMPLE), 'utf8'),
);

// Throws when the example has no `name: hello-plan` line, so a change to the
// example fails here and not as a page that shows some other workflow.
function renamed(text: string): string {
  const hello = text.replace(/^name: hello-plan$/m, 'name: hello');
  if (hello === text) {
    throw new Error(
      `${fileURLToPath(EXAMPLE)} has no line "name: hello-plan" to rename.`,
    );
  }
  return hello;
}
