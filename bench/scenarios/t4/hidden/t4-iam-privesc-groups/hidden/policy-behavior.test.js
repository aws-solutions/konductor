'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decide, evaluate, lint } = require('./iam-eval');

const root = path.resolve(__dirname, '..');
const readPolicy = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const developer = () => readPolicy('iam/groups/developers.json');
const analyst = () => readPolicy('iam/groups/analysts.json');
const onCall = () => readPolicy('iam/groups/on-call.json');
const boundary = () => readPolicy('iam/permissions-boundary.json');
const principal = (name) => ({ AWS: `arn:aws:iam::111122223333:user/${name}` });
const request = (action, resource, name, context = {}) => ({
  action,
  resource,
  principal: principal(name),
  context: { 'aws:username': name, ...context }
});
const allowed = (identity, req) => decide({ identity: [identity], boundary: [boundary()] }, req);
const denied = (identity, req) => assert.equal(evaluate([identity], req), 'deny');

test('developer policy passes structural validation', () => {
  assert.deepEqual(lint(readPolicy('iam/groups/developers.json')), []);
});

test('analyst policy passes structural validation', () => {
  assert.deepEqual(lint(readPolicy('iam/groups/analysts.json')), []);
});

test('on-call policy passes structural validation', () => {
  assert.deepEqual(lint(readPolicy('iam/groups/on-call.json')), []);
});

test('permissions boundary passes structural validation', () => {
  assert.deepEqual(lint(readPolicy('iam/permissions-boundary.json')), []);
});

test('developers can create a team function', () => {
  assert.equal(allowed(developer(), request('lambda:CreateFunction', 'arn:aws:lambda:us-east-2:111122223333:function:team-api', 'dev-alex')), true);
});

test('developers can update team function code', () => {
  assert.equal(allowed(developer(), request('lambda:UpdateFunctionCode', 'arn:aws:lambda:us-east-2:111122223333:function:team-worker', 'dev-alex')), true);
});

test('developers can invoke a team function', () => {
  assert.equal(allowed(developer(), request('lambda:InvokeFunction', 'arn:aws:lambda:us-east-2:111122223333:function:team-api', 'dev-alex')), true);
});

test('developers can pass the existing team execution role', () => {
  assert.equal(allowed(developer(), request('iam:PassRole', 'arn:aws:iam::111122223333:role/team-function-execution', 'dev-alex')), true);
});

test('developers can rotate their own access key', () => {
  assert.equal(allowed(developer(), request('iam:CreateAccessKey', 'arn:aws:iam::111122223333:user/dev-alex', 'dev-alex')), true);
});

test('developers can read their function logs', () => {
  assert.equal(allowed(developer(), request('logs:FilterLogEvents', 'arn:aws:logs:us-east-2:111122223333:log-group:/platform/team-api:*', 'dev-alex')), true);
});

test('analysts can read a lake object', () => {
  assert.equal(allowed(analyst(), request('s3:GetObject', 'arn:aws:s3:::analytics-lake-111122223333/events/2025-02-14.json', 'analyst-rin')), true);
});

test('analysts can run a read workgroup query', () => {
  assert.equal(allowed(analyst(), request('athena:StartQueryExecution', 'arn:aws:athena:us-east-2:111122223333:workgroup/analytics-read', 'analyst-rin')), true);
});

test('analysts can read catalog tables', () => {
  assert.equal(allowed(analyst(), request('glue:GetTable', 'arn:aws:glue:us-east-2:111122223333:table/analytics/events', 'analyst-rin')), true);
});

test('on-call can restart a listed service', () => {
  assert.equal(allowed(onCall(), request('ecs:UpdateService', 'arn:aws:ecs:us-east-2:111122223333:service/operations/platform-api', 'oncall-jamie')), true);
});

test('on-call can read operational metrics', () => {
  assert.equal(allowed(onCall(), request('cloudwatch:GetMetricData', '*', 'oncall-jamie', { 'cloudwatch:namespace': 'Platform/Operations' })), true);
});

test('developers cannot create policy versions', () => {
  denied(developer(), request('iam:CreatePolicyVersion', 'arn:aws:iam::111122223333:policy/team-policy', 'dev-alex'));
});

test('developers cannot select a new default policy version', () => {
  denied(developer(), request('iam:SetDefaultPolicyVersion', 'arn:aws:iam::111122223333:policy/team-policy', 'dev-alex'));
});

test('developers cannot pass the account admin role', () => {
  denied(developer(), request('iam:PassRole', 'arn:aws:iam::111122223333:role/account-admin', 'dev-alex'));
});

test('developers cannot attach a policy to a user', () => {
  denied(developer(), request('iam:AttachUserPolicy', 'arn:aws:iam::111122223333:user/dev-alex', 'dev-alex'));
});

test('developers cannot put an inline user policy', () => {
  denied(developer(), request('iam:PutUserPolicy', 'arn:aws:iam::111122223333:user/dev-alex', 'dev-alex'));
});

test('developers cannot edit a role trust policy', () => {
  denied(developer(), request('iam:UpdateAssumeRolePolicy', 'arn:aws:iam::111122223333:role/team-function-execution', 'dev-alex'));
});

test('developers cannot create a key for another user', () => {
  denied(developer(), request('iam:CreateAccessKey', 'arn:aws:iam::111122223333:user/oncall-jamie', 'dev-alex'));
});

test('developers cannot use organization administration', () => {
  denied(developer(), request('organizations:CreateAccount', '*', 'dev-alex'));
});

test('developers cannot use STS to change identity', () => {
  denied(developer(), request('sts:AssumeRole', 'arn:aws:iam::111122223333:role/account-admin', 'dev-alex'));
});

test('on-call cannot create a key for another user', () => {
  denied(onCall(), request('iam:CreateAccessKey', 'arn:aws:iam::111122223333:user/dev-alex', 'oncall-jamie'));
});

test('on-call cannot create another users login profile', () => {
  denied(onCall(), request('iam:CreateLoginProfile', 'arn:aws:iam::111122223333:user/dev-alex', 'oncall-jamie'));
});
