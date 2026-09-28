// SPDX-License-Identifier: Apache-2.0
// The two ways a command can fail. cli.ts turns them into exit codes.

// The command was understood but cannot be carried out: a refused `done`, a
// missing file, an invalid workflow. Exit code 1.
export class FlowError extends Error {}

// The command line itself is wrong: unknown command, missing argument,
// unknown option. Exit code 64.
export class UsageError extends Error {}
