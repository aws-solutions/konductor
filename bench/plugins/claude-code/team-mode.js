// SPDX-License-Identifier: Apache-2.0
'use strict';

// Steps 2 and 3 of konductor's own Claude Code guide (docs/user-guide/tasks/install-claude-code.md at f5d18459): team
// mode on (env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS) and the guide's permissions.allow list, written into the run's
// settings.json beside what `konductor install --harness claude` put there (its SessionStart hook). Konductor arms only.
// Node built-ins only: run-cc-compare.sh copies this file unchanged into its frozen bench (cc-team-mode.patch).

const fs = require('node:fs');
const path = require('node:path');

const TEAM_ENV = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS';
// The guide's list, in its order.
const GUIDE_ALLOW = Object.freeze([
  'Read', 'Edit', 'Write', 'Glob', 'Grep', 'TodoWrite',
  'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git blame*)', 'Bash(git show*)', 'Bash(git add*)',
  'Bash(git commit*)', 'Bash(git branch*)', 'Bash(git checkout*)', 'Bash(git switch*)', 'Bash(git stash*)',
  'Bash(git fetch*)', 'Bash(git rebase*)', 'Bash(npm *)', 'Bash(ls *)', 'Bash(find *)', 'Bash(grep *)',
]);

/**
 * Merges team mode and the guide's allow list into `<configDir>/settings.json` and returns the install.log line.
 * Keeps every other key (the install's hooks); allow entries already there stay, first. Refuses a settings.json that
 * is a symlink or not a JSON object, so nothing outside the run's config directory is written.
 */
function applyTeamMode(configDir) {
  const file = path.join(configDir, 'settings.json');
  let settings = {};
  if (fs.existsSync(file)) {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`refused: ${file} is a symlink`);
    settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error(`refused: ${file} is not a JSON object`);
  }
  const allow = settings.permissions?.allow ?? [];
  settings.env = { ...settings.env, [TEAM_ENV]: '1' };
  settings.permissions = { ...settings.permissions, allow: [...allow, ...GUIDE_ALLOW.filter((a) => !allow.includes(a))] };
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return `team mode: settings.json env ${TEAM_ENV}=1, permissions.allow ${settings.permissions.allow.length} entries (guide steps 2 and 3)`;
}

module.exports = { TEAM_ENV, GUIDE_ALLOW, applyTeamMode };
