'use strict';
const { makeId } = require('../lib/ids');
const { clean, sameText } = require('../lib/strings');

class ProjectLimitError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ProjectLimitError'; this.code = code; this.details = details; }
}

function createProjectLimitService({ accounts, projects, plans, clock = () => new Date(), nearLimitRatio = 0.8, enforce = true }) {
  function nowDate() { const value = clock(); return value instanceof Date ? value : new Date(value); }
  function activeCount(accountId) { return projects.countActiveProjects ? projects.countActiveProjects(accountId) : projects.countProjects(accountId); }
  function resolved(account) {
    const now = nowDate();
    const override = account.projectLimitOverride;
    if (override && Number.isInteger(override.limit) && override.limit >= 1 && (!override.expiresAt || Date.parse(override.expiresAt) > now.getTime())) {
      return { limit: override.limit, source: 'override', expiresAt: override.expiresAt || null };
    }
    const plan = plans[account.plan] || plans.free;
    return { limit: plan.maxActiveProjects === null ? null : plan.maxActiveProjects, source: 'plan', expiresAt: null };
  }
  function usage(accountId) {
    const account = accounts.get(accountId);
    if (!account) throw new ProjectLimitError('account_not_found', 'account not found');
    const activeProjects = activeCount(accountId);
    const chosen = resolved(account);
    const nearLimit = chosen.limit !== null && activeProjects / chosen.limit >= nearLimitRatio;
    return { accountId, plan: account.plan, activeProjects, limit: chosen.limit, remaining: chosen.limit === null ? null : Math.max(0, chosen.limit - activeProjects), nearLimit, warning: nearLimit ? 'project limit is nearly reached' : null, source: chosen.source, expiresAt: chosen.expiresAt };
  }
  function validateName(input) {
    if (!input || !clean(input.name) || clean(input.name).length > 80) throw new ProjectLimitError('invalid_project', 'name is required and must be at most 80 characters');
    return clean(input.name);
  }
  async function createProject(accountId, input) {
    const account = accounts.get(accountId);
    if (!account) throw new ProjectLimitError('account_not_found', 'account not found');
    const name = validateName(input);
    return projects.withAccountLock(accountId, async () => {
      const before = usage(accountId);
      if (enforce && before.limit !== null && before.activeProjects >= before.limit) {
        throw new ProjectLimitError('project_limit_reached', 'active project limit reached', { activeProjects: before.activeProjects, limit: before.limit });
      }
      if (projects.list(accountId).some(p => sameText(p.name, name) && p.status !== 'deleted')) throw new ProjectLimitError('project_name_taken', 'project name already exists');
      return projects.insert({ id: makeId('proj'), accountId, name, createdAt: nowDate().toISOString() });
    });
  }
  function setOverride(accountId, limit, expiresAt) {
    const account = accounts.get(accountId);
    if (!account) throw new ProjectLimitError('account_not_found', 'account not found');
    if (!Number.isInteger(limit) || limit < 1) throw new ProjectLimitError('invalid_project_limit', 'limit must be a positive integer');
    if (expiresAt !== undefined && expiresAt !== null && (typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt)))) throw new ProjectLimitError('invalid_project_limit', 'expiresAt must be an ISO timestamp');
    account.projectLimitOverride = { limit, expiresAt: expiresAt || null };
    accounts.save(account);
    return usage(accountId);
  }
  return { getUsage: usage, createProject, setProjectLimitOverride: setOverride, ProjectLimitError };
}

module.exports = { createProjectLimitService, ProjectLimitError };
