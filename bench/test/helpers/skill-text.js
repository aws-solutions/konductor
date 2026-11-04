// SPDX-License-Identifier: Apache-2.0
/**
 * Test helper: the skill text a lint needs
 *
 * `lintTask` refuses to run without `options.skillText`, because the rubric quoting rule, the
 * target_section check and the skill-only-wording check cannot run without it. Most lint tests are
 * about other conditions and have no skill text of their own, so they call the linter through
 * `withSkillText`, which supplies a minimal text: one heading, the task's `target_section`, and a
 * sentence that no rubric quotes and no check pattern uses. The wrapped linter behaves exactly as
 * the strict one except that the section check passes. A test that is about the missing text
 * itself must call the strict `lintTask`.
 */

/** A skill text whose only heading is `task.target_section`, or a plain one when the task has none. */
function skillTextFor(task) {
  let heading = 'Recording a change';
  try {
    if (task !== null && typeof task === 'object' && typeof task.target_section === 'string' && task.target_section.trim() !== '') {
      heading = task.target_section.replace(/[\r\n]+/g, ' ');
    }
  } catch {
    // A hostile task whose property read throws gets the plain text; the lint reports the task.
  }
  return `# Skill\n\n## ${heading}\n\nWrite an entry for each user-facing change.\n`;
}

/**
 * Wraps `lint` (`lintTask`) so that a call without `options.skillText` gets one built from the
 * task. An explicit `skillText`, even a wrong one, is passed through unchanged, and so is every
 * other option.
 */
function withSkillText(lint) {
  return function lintedWithSkillText(task, snapshots, options) {
    const given = options !== null && typeof options === 'object' && typeof options.skillText === 'string';
    if (given) return lint(task, snapshots, options);
    const base = options !== null && typeof options === 'object' ? options : {};
    return lint(task, snapshots, { ...base, skillText: skillTextFor(task) });
  };
}

module.exports = { skillTextFor, withSkillText };
