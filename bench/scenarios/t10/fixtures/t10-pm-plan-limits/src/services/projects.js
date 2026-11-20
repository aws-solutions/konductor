'use strict';
const { ok, fail } = require('../lib/result');
const { clean, sameText } = require('../lib/strings');
function projectService(projects, accounts, options = {}) {
  const now = options.now || (() => new Date());
  return {
    create(accountId, input) {
      const account = accounts.get(accountId);
      if (!account) return fail('account_not_found', 'account not found');
      if (!input || !clean(input.name)) return fail('invalid_project', 'name is required');
      const duplicate = projects.list(accountId).some(p => sameText(p.name, input.name) && p.status !== 'deleted');
      if (duplicate) return fail('project_name_taken', 'project name already exists');
      return ok(projects.insert({ accountId, name: clean(input.name), createdAt: now().toISOString() }));
    },
    list(accountId) { return projects.list(accountId); }
  };
}
module.exports = { projectService };
