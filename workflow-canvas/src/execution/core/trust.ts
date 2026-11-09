// SPDX-License-Identifier: Apache-2.0

// The contract has the command as the only text between backticks in `fix`,
// so a `fix` with more than one pair of backticks offers no command.
const COMMAND = /^[^`]*`([^`]+)`[^`]*$/;

// The one command the page offers to copy: `konductor flow trust` and a
// workflow name, as the contract's `Name` pattern has it, with nothing after.
// The text comes from the server and is meant for a terminal, so anything else
// in it, such as a `;`, a `$(...)` or a second line, is not offered.
const TRUST_COMMAND = /^konductor flow trust [a-z0-9][a-z0-9-]{0,63}$/;

/**
 * The command in the `fix` of a `trust_required` answer, such as
 * `konductor flow trust hello`, for the person to copy and run in a terminal.
 * It is `undefined` when the `fix` has no text in backticks or more than one
 * pair, when that text is not `konductor flow trust` and a workflow name, or
 * when that name is not `workflowName`, the name of the workflow on the page.
 * An unknown `workflowName` offers no command.
 */
export function trustCommandOf(
  fix: string,
  workflowName: string | undefined,
): string | undefined {
  const command = COMMAND.exec(fix)?.[1];
  return command !== undefined &&
    workflowName !== undefined &&
    TRUST_COMMAND.test(command) &&
    command === `konductor flow trust ${workflowName}`
    ? command
    : undefined;
}
