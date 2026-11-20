'use strict';
const os = require('node:os');
const path = require('node:path');
const { createJsonStore } = require('./store/json-store');
const { accountRepository } = require('./repositories/accounts');
const { projectRepository } = require('./repositories/projects');
const { memberRepository } = require('./repositories/members');
const { accountService } = require('./services/accounts');
const { projectService } = require('./services/projects');
const { makeRouter } = require('./http/router');
function createApp(options = {}) { const store = options.store || createJsonStore(options.file || path.join(os.tmpdir(), 'sprig-track.json'), {accounts:[], projects:[], members:[]}); const accounts = accountRepository(store); const projects = projectRepository(store); const members = memberRepository(store); const as = accountService(accounts); const ps = projectService(projects, accounts, options); const route = makeRouter({ 'GET /health': async () => ({status:200, body:{ok:true}}), 'GET /v1/accounts/:accountId': async ({accountId}) => { const r=as.get(accountId); return r.ok?{status:200,body:r.value}:{status:404,body:{error:r.error}}; }, 'POST /v1/accounts/:accountId/projects': async ({accountId}, body) => { const r=ps.create(accountId, body); return r.ok?{status:201,body:r.value}:{status:r.error.code==='project_name_taken'?409:400,body:{error:r.error}}; }, 'GET /v1/accounts/:accountId/projects': async ({accountId}) => ({status:200,body:ps.list(accountId)}), 'POST /v1/accounts/:accountId/members/invite': async ({accountId}, body) => ({status:201,body:await members.invite({accountId,email:body.email})}) }); return { store, accounts, projects, members, accountService:as, projectService:ps, handle:route }; }
module.exports = { createApp };
