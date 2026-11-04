// SPDX-License-Identifier: Apache-2.0
/**
 * Fields the tested model must never see.
 *
 * The subject (the model under test) gets the task request (`task.task`), the skill text its arm
 * allows, and the start workspace. It must not get what grades it: the checks, the rubric and the
 * reference solution. A subject that can read a check can write to it, and then both arms measure
 * check reading and not the skill. The rule is a requirement on every runner, stated here so it is
 * not left implicit; a runner can enforce it by refusing to build a subject prompt, tool list or
 * workspace from any key in `HIDDEN_FROM_SUBJECT`.
 *
 * `checks` also covers the negatives that go with them. `reference` is a workspace snapshot passed
 * to `lintTask`, not a field of a task.
 *
 * Pure: no I/O.
 */
const HIDDEN_FROM_SUBJECT = Object.freeze(['checks', 'rubric', 'reference']);

module.exports = { HIDDEN_FROM_SUBJECT };
