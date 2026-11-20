'use strict';
const os = require('node:os');
const path = require('node:path');
const { createJsonStore } = require('./store/json-store');
const { accountRepository } = require('./repositories/accounts');
const { projectRepository } = require('./repositories/projects');
const { memberRepository } = require('./repositories/members');
const { accountService } = require('./services/accounts');
const { projectService } = require('./services/projects');
const { createProjectLimitService, ProjectLimitError } = require('./services/project-limits');
const { loadConfig } = require('./config');
const { makeRouter } = require('./http/router');
const { statusFor } = require('./http/errors');
function createApp(options = {}) {
  const config = loadConfig(options.root || path.join(__dirname, '..'));
  const store = options.store || createJsonStore(options.file || path.join(os.tmpdir(), 'sprig-track.json'), {accounts:[], projects:[], members:[]});
  const accounts = accountRepository(store); const projects = projectRepository(store); const members = memberRepository(store);
  const as = accountService(accounts); const ps = projectService(projects, accounts, options);
  const limits = createProjectLimitService({ accounts, projects, plans: options.plans || config.plans, clock: options.clock, nearLimitRatio: config.defaults.nearLimitRatio, enforce: options.enforceProjectLimits !== false });
  const failure = (error) => ({ status: statusFor(error.code), body: { error: { code: error.code, message: error.message, ...(Object.keys(error.details || {}).length ? { details: error.details } : {}) } } });
  const route = makeRouter({
    'GET /health': async () => ({status:200, body:{ok:true}}),
    'GET /v1/accounts/:accountId': async ({accountId}) => { const r=as.get(accountId); return r.ok?{status:200,body:r.value}:{status:404,body:{error:r.error}}; },
    'POST /v1/accounts/:accountId/projects': async ({accountId}, body) => { try { return {status:201, body:await limits.createProject(accountId, body)}; } catch (error) { return failure(error); } },
    'GET /v1/accounts/:accountId/projects': async ({accountId}) => ({status:200,body:projects.list(accountId)}),
    'GET /v1/accounts/:accountId/projects/limit': async ({accountId}) => { try { return {status:200,body:limits.getUsage(accountId)}; } catch (error) { return failure(error); } },
    'POST /v1/accounts/:accountId/projects/batch': async ({accountId}, body) => { const rows = Array.isArray(body && body.projects) ? body.projects : []; const results=[]; for (const input of rows.slice(0, config.defaults.batchMaxRows)) { try { results.push({ok:true, project:await limits.createProject(accountId,input)}); } catch (error) { results.push({ok:false, error:{code:error.code, message:error.message}}); } } return {status:207, body:{results}}; },
    'POST /v1/accounts/:accountId/project-limit-override': async ({accountId}, body) => { try { return {status:200,body:limits.setProjectLimitOverride(accountId, body && body.limit, body && body.expiresAt)}; } catch (error) { return failure(error); } },
    'POST /v1/accounts/:accountId/members/invite': async ({accountId}, body) => ({status:201,body:await members.invite({accountId,email:body.email})})
  });
  return { store, accounts, projects, members, accountService:as, projectService:ps, projectLimitService:limits, handle:route };
}
module.exports = { createApp };
