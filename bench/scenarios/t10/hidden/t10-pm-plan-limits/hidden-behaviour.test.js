'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJsonStore } = require('./src/store/json-store');
const { createApp } = require('./src/app');
const { projectRepository } = require('./src/repositories/projects');
const { ProjectLimitError } = require('./src/services/project-limits');
const { loadConfig } = require('./src/config');
function make(initial, now = '2025-02-01T00:00:00.000Z', options = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hidden-limit-')), 'store.json');
  return createApp({ store: createJsonStore(file, initial), clock: () => new Date(now), ...options });
}
const empty = () => ({ accounts: [], projects: [], members: [] });
const account = (plan = 'free', id = 'a') => ({ id, name: 'Hidden team', plan });
const project = (id, status = 'active', name = id) => ({ id, accountId: 'a', name, status });

test('catalogue exposes the finite limits and unlimited legacy value', () => {
  const plans = loadConfig(__dirname).plans;
  assert.deepStrictEqual({free: plans.free.maxActiveProjects, team: plans.team.maxActiveProjects, business: plans.business.maxActiveProjects, legacy: plans.legacy.maxActiveProjects}, {free:3, team:10, business:25, legacy:null});
});
test('countProjects counts active records only', () => {
  const s = createJsonStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hidden-repo-')), 'x.json'), {projects:[project('a'), project('b','archived'), project('c','deleted')]});
  assert.strictEqual(projectRepository(s).countProjects('a'), 1);
});
test('Free permits exactly three and rejects the next create', async () => {
  const x = make({accounts:[account()], projects:[], members:[]});
  for (const name of ['one','two','three']) assert.strictEqual((await x.handle('POST','/v1/accounts/a/projects',{name})).status, 201);
  const out = await x.handle('POST','/v1/accounts/a/projects',{name:'four'});
  assert.strictEqual(out.status, 409); assert.strictEqual(out.body.error.code, 'project_limit_reached'); assert.strictEqual(out.body.error.details.limit, 3);
});
test('Team and Business use their catalogue counts', async () => {
  const team = make({accounts:[account('team')], projects:[], members:[]});
  const business = make({accounts:[account('business')], projects:[], members:[]});
  assert.strictEqual((await team.handle('GET','/v1/accounts/a/projects/limit',{})).body.limit, 10);
  assert.strictEqual((await business.handle('GET','/v1/accounts/a/projects/limit',{})).body.limit, 25);
});
test('legacy remains unlimited even with more than the Free count', async () => {
  const x = make({accounts:[account('legacy')], projects:Array.from({length:8},(_,i)=>project(`p${i}`)), members:[]});
  const usage = await x.handle('GET','/v1/accounts/a/projects/limit',{});
  assert.strictEqual(usage.body.limit, null); assert.strictEqual(usage.body.remaining, null);
  assert.strictEqual((await x.handle('POST','/v1/accounts/a/projects',{name:'extra'})).status, 201);
});
test('existing over-limit data is retained while new admission is blocked', async () => {
  const x = make({accounts:[account()], projects:[project('one'),project('two'),project('three'),project('four')], members:[]});
  assert.strictEqual((await x.handle('GET','/v1/accounts/a/projects',{})).body.length, 4);
  assert.strictEqual((await x.handle('POST','/v1/accounts/a/projects',{name:'five'})).body.error.code, 'project_limit_reached');
});
test('near-limit warning turns on at the finite boundary', async () => {
  const x = make({accounts:[account()], projects:[project('one'),project('two')], members:[]});
  assert.strictEqual((await x.handle('GET','/v1/accounts/a/projects/limit',{})).body.nearLimit, false);
  await x.handle('POST','/v1/accounts/a/projects',{name:'three'});
  const usage = await x.handle('GET','/v1/accounts/a/projects/limit',{});
  assert.strictEqual(usage.body.nearLimit, true); assert.match(usage.body.warning, /limit/i);
});
test('archived and deleted records are excluded from warning and capacity', async () => {
  const x = make({accounts:[account()], projects:[project('old','archived'),project('gone','deleted'),project('live')], members:[]});
  const usage = await x.handle('GET','/v1/accounts/a/projects/limit',{});
  assert.strictEqual(usage.body.activeProjects, 1); assert.strictEqual(usage.body.remaining, 2);
  assert.strictEqual((await x.handle('POST','/v1/accounts/a/projects',{name:'new'})).status, 201);
});
test('the usage response exposes the configured unit fields', async () => {
  const x = make({accounts:[account()], projects:[project('one')], members:[]});
  const usage = (await x.handle('GET','/v1/accounts/a/projects/limit',{})).body;
  assert.deepStrictEqual(Object.keys(usage).sort(), ['accountId','activeProjects','expiresAt','limit','nearLimit','plan','remaining','source','warning'].sort());
  assert.strictEqual(usage.activeProjects, 1);
});
test('two simultaneous creates cannot consume one final slot twice', async () => {
  const x = make({accounts:[account()], projects:[project('one'),project('two')], members:[]});
  const results = await Promise.all(['left','right'].map(name => x.handle('POST','/v1/accounts/a/projects',{name})));
  assert.deepStrictEqual(results.map(r => r.status).sort((a,b)=>a-b), [201,409]);
});
test('support override is account-scoped and reports its source', async () => {
  const x = make({accounts:[account(),account('team','b')], projects:[], members:[]});
  const changed = await x.handle('POST','/v1/accounts/a/project-limit-override',{limit:5,expiresAt:'2025-03-01T00:00:00Z'});
  assert.strictEqual(changed.status, 200); assert.strictEqual(changed.body.source, 'override'); assert.strictEqual(changed.body.limit, 5);
  assert.strictEqual((await x.handle('GET','/v1/accounts/b/projects/limit',{})).body.limit, 10);
});
test('an override expires using absolute UTC time', async () => {
  const x = make({accounts:[account()], projects:[], members:[]}, '2025-04-01T00:00:00Z');
  await x.handle('POST','/v1/accounts/a/project-limit-override',{limit:5,expiresAt:'2025-03-01T12:00:00-05:00'});
  const usage = await x.handle('GET','/v1/accounts/a/projects/limit',{});
  assert.strictEqual(usage.body.source, 'plan'); assert.strictEqual(usage.body.limit, 3);
});
test('invalid support limits have a stable error code', async () => {
  const x = make({accounts:[account()], projects:[], members:[]});
  const out = await x.handle('POST','/v1/accounts/a/project-limit-override',{limit:0});
  assert.strictEqual(out.status, 400); assert.strictEqual(out.body.error.code, 'invalid_project_limit');
  assert.throws(() => { throw new ProjectLimitError('x','x'); }, ProjectLimitError);
});
test('batch returns ordered partial success with HTTP 207', async () => {
  const x = make({accounts:[account()], projects:[project('one')], members:[]});
  const out = await x.handle('POST','/v1/accounts/a/projects/batch',{projects:[{name:'two'},{name:'three'},{name:'four'}]});
  assert.strictEqual(out.status, 207); assert.strictEqual(out.body.results.length, 3);
  assert.strictEqual(out.body.results[0].ok, true); assert.strictEqual(out.body.results[1].ok, true); assert.strictEqual(out.body.results[2].error.code, 'project_limit_reached');
});
test('batch keeps duplicate and limit errors at their own rows', async () => {
  const x = make({accounts:[account()], projects:[project('one','active','same'),project('two')], members:[]});
  const out = await x.handle('POST','/v1/accounts/a/projects/batch',{projects:[{name:'same'},{name:'new'},{name:'last'}]});
  assert.strictEqual(out.body.results[0].error.code, 'project_name_taken'); assert.strictEqual(out.body.results[1].ok, true); assert.strictEqual(out.body.results[2].error.code, 'project_limit_reached');
});
test('the same limit service powers direct creates and the route', async () => {
  const x = make({accounts:[account()], projects:[project('one'),project('two'),project('three')], members:[]});
  await assert.rejects(() => x.projectLimitService.createProject('a',{name:'direct'}), error => error instanceof ProjectLimitError && error.code === 'project_limit_reached');
});
test('shadow option observes the limit without rejecting admission', async () => {
  const x = make({accounts:[account()], projects:[project('one'),project('two'),project('three')], members:[]}, undefined, {enforceProjectLimits:false});
  assert.strictEqual((await x.handle('POST','/v1/accounts/a/projects',{name:'allowed-in-shadow'})).status, 201);
});
test('missing accounts return the named usage error', async () => {
  const x = make(empty());
  const out = await x.handle('GET','/v1/accounts/missing/projects/limit',{});
  assert.strictEqual(out.status, 404); assert.strictEqual(out.body.error.code, 'account_not_found');
});
