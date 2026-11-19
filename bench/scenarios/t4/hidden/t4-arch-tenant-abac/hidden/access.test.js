'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluate, isAllowed, lint } = require('./iam-eval.js');

const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'infra/config/access-config.json'), 'utf8'));
const tenantPolicy = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'infra/shared/tenant-access-policy.json'), 'utf8'));
const supportPolicy = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'infra/shared/support-policy.json'), 'utf8'));
const bucket = config.bucketArn;
const table = config.tableArn;
const tenantPrincipal = { AWS: 'arn:aws:iam::111122223333:role/tenant-session' };
const supportPrincipal = { AWS: config.supportPrincipal };
const tenantContext = (tenant, tier = 'standard', extra = {}) => ({
  'aws:PrincipalTag/tenant': tenant,
  'aws:PrincipalTag/tier': tier,
  ...extra
});
const s3 = (action, resource, context, principal = tenantPrincipal) => ({ action, resource, principal, context });
const ddb = (action, context, principal = tenantPrincipal) => ({ action, resource: table, principal, context });

// Policy documents must be structurally valid before behavior is considered.
test('tenant policy passes the policy linter', () => assert.deepEqual(lint(tenantPolicy), []));
test('support policy passes the policy linter', () => assert.deepEqual(lint(supportPolicy), []));

test('tenant can read an object in its own prefix', () => {
  assert.equal(isAllowed([tenantPolicy], s3('s3:GetObject', `${bucket}/tenants/acme/brief.pdf`, tenantContext('acme'))), true);
});

test('tenant can write an object in its own prefix', () => {
  assert.equal(isAllowed([tenantPolicy], s3('s3:PutObject', `${bucket}/tenants/acme/new.txt`, tenantContext('acme'))), true);
});

test('tenant can delete an object in its own prefix', () => {
  assert.equal(isAllowed([tenantPolicy], s3('s3:DeleteObject', `${bucket}/tenants/acme/old.txt`, tenantContext('acme'))), true);
});

test('tenant can list its own prefix', () => {
  assert.equal(isAllowed([tenantPolicy], s3('s3:ListBucket', bucket, tenantContext('acme', 'standard', { 's3:prefix': ['tenants/acme/'] }))), true);
});

test('tenant cannot read another tenant object', () => {
  assert.equal(isAllowed([tenantPolicy], s3('s3:GetObject', `${bucket}/tenants/other/brief.pdf`, tenantContext('acme'))), false);
});

test('tenant cannot list another tenant prefix', () => {
  assert.equal(isAllowed([tenantPolicy], s3('s3:ListBucket', bucket, tenantContext('acme', 'standard', { 's3:prefix': ['tenants/other/'] }))), false);
});

test('a mixed list request cannot include another tenant prefix', () => {
  assert.equal(isAllowed([tenantPolicy], s3('s3:ListBucket', bucket, tenantContext('acme', 'standard', { 's3:prefix': ['tenants/acme/', 'tenants/other/'] }))), false);
});

test('a list without a prefix is denied', () => {
  assert.equal(isAllowed([tenantPolicy], s3('s3:ListBucket', bucket, tenantContext('acme'))), false);
});

test('missing tenant tag explicitly denies object access', () => {
  assert.equal(evaluate([tenantPolicy], s3('s3:GetObject', `${bucket}/tenants/acme/brief.pdf`, {})), 'deny');
});

test('missing tenant tag explicitly denies metadata access', () => {
  assert.equal(evaluate([tenantPolicy], ddb('dynamodb:GetItem', { 'dynamodb:LeadingKeys': ['acme'] })), 'deny');
});

test('tenant can read its own metadata partition', () => {
  assert.equal(isAllowed([tenantPolicy], ddb('dynamodb:GetItem', tenantContext('acme', 'standard', { 'dynamodb:LeadingKeys': ['acme'] }))), true);
});

test('tenant can query its own metadata partition', () => {
  assert.equal(isAllowed([tenantPolicy], ddb('dynamodb:Query', tenantContext('acme', 'standard', { 'dynamodb:LeadingKeys': ['acme'] }))), true);
});

test('tenant cannot query another metadata partition', () => {
  assert.equal(isAllowed([tenantPolicy], ddb('dynamodb:Query', tenantContext('acme', 'standard', { 'dynamodb:LeadingKeys': ['other'] }))), false);
});

test('a mixed leading-key request is denied', () => {
  assert.equal(isAllowed([tenantPolicy], ddb('dynamodb:Query', tenantContext('acme', 'standard', { 'dynamodb:LeadingKeys': ['acme', 'other'] }))), false);
});

test('metadata access without a leading key is denied', () => {
  assert.equal(isAllowed([tenantPolicy], ddb('dynamodb:Query', tenantContext('acme'))), false);
});

test('premium tenant can write its own export', () => {
  assert.equal(isAllowed([tenantPolicy], s3('s3:PutObject', `${bucket}/exports/acme/report.json`, tenantContext('acme', 'premium'))), true);
});

test('standard tenant cannot write an export', () => {
  assert.equal(isAllowed([tenantPolicy], s3('s3:PutObject', `${bucket}/exports/acme/report.json`, tenantContext('acme', 'standard'))), false);
});

test('premium tenant cannot write another tenant export', () => {
  assert.equal(isAllowed([tenantPolicy], s3('s3:PutObject', `${bucket}/exports/other/report.json`, tenantContext('acme', 'premium'))), false);
});

test('premium export access is write-only', () => {
  assert.equal(isAllowed([tenantPolicy], s3('s3:GetObject', `${bucket}/exports/acme/report.json`, tenantContext('acme', 'premium'))), false);
});

test('support can get any tenant metadata item', () => {
  assert.equal(isAllowed([supportPolicy], ddb('dynamodb:GetItem', { 'dynamodb:LeadingKeys': ['other'] }, supportPrincipal)), true);
});

test('support can query any tenant metadata items', () => {
  assert.equal(isAllowed([supportPolicy], ddb('dynamodb:Query', {}, supportPrincipal)), true);
});

test('support cannot read document objects', () => {
  assert.equal(evaluate([supportPolicy], s3('s3:GetObject', `${bucket}/tenants/acme/brief.pdf`, {}, supportPrincipal)), 'deny');
});

test('support cannot list document objects', () => {
  assert.equal(evaluate([supportPolicy], s3('s3:ListBucket', bucket, { 's3:prefix': ['tenants/acme/'] }, supportPrincipal)), 'deny');
});

test('support cannot write metadata', () => {
  assert.equal(evaluate([supportPolicy], ddb('dynamodb:PutItem', {}, supportPrincipal)), 'deny');
});

test('support cannot delete metadata', () => {
  assert.equal(evaluate([supportPolicy], ddb('dynamodb:DeleteItem', {}, supportPrincipal)), 'deny');
});

const tenant17Allows = [
  ['tenant 17 reads brief', s3('s3:GetObject', `${bucket}/tenants/tenant-17/brief.pdf`, tenantContext('tenant-17'))],
  ['tenant 17 reads notes', s3('s3:GetObject', `${bucket}/tenants/tenant-17/notes.txt`, tenantContext('tenant-17'))],
  ['tenant 17 reads nested file', s3('s3:GetObject', `${bucket}/tenants/tenant-17/folder/data.json`, tenantContext('tenant-17'))],
  ['tenant 17 reads a second file', s3('s3:GetObject', `${bucket}/tenants/tenant-17/archive.pdf`, tenantContext('tenant-17'))],
  ['tenant 17 reads a manifest', s3('s3:GetObject', `${bucket}/tenants/tenant-17/manifest.json`, tenantContext('tenant-17'))],
  ['tenant 17 writes brief', s3('s3:PutObject', `${bucket}/tenants/tenant-17/brief.pdf`, tenantContext('tenant-17'))],
  ['tenant 17 writes notes', s3('s3:PutObject', `${bucket}/tenants/tenant-17/notes.txt`, tenantContext('tenant-17'))],
  ['tenant 17 writes nested file', s3('s3:PutObject', `${bucket}/tenants/tenant-17/folder/data.json`, tenantContext('tenant-17'))],
  ['tenant 17 writes an archive', s3('s3:PutObject', `${bucket}/tenants/tenant-17/archive.pdf`, tenantContext('tenant-17'))],
  ['tenant 17 writes a manifest', s3('s3:PutObject', `${bucket}/tenants/tenant-17/manifest.json`, tenantContext('tenant-17'))],
  ['tenant 17 deletes brief', s3('s3:DeleteObject', `${bucket}/tenants/tenant-17/brief.pdf`, tenantContext('tenant-17'))],
  ['tenant 17 deletes notes', s3('s3:DeleteObject', `${bucket}/tenants/tenant-17/notes.txt`, tenantContext('tenant-17'))],
  ['tenant 17 deletes nested file', s3('s3:DeleteObject', `${bucket}/tenants/tenant-17/folder/data.json`, tenantContext('tenant-17'))],
  ['tenant 17 deletes an archive', s3('s3:DeleteObject', `${bucket}/tenants/tenant-17/archive.pdf`, tenantContext('tenant-17'))],
  ['tenant 17 deletes a manifest', s3('s3:DeleteObject', `${bucket}/tenants/tenant-17/manifest.json`, tenantContext('tenant-17'))],
  ['tenant 17 lists the root prefix', s3('s3:ListBucket', bucket, tenantContext('tenant-17', 'standard', { 's3:prefix': ['tenants/tenant-17'] }))],
  ['tenant 17 lists the slash prefix', s3('s3:ListBucket', bucket, tenantContext('tenant-17', 'standard', { 's3:prefix': ['tenants/tenant-17/'] }))],
  ['tenant 17 lists a nested prefix', s3('s3:ListBucket', bucket, tenantContext('tenant-17', 'standard', { 's3:prefix': ['tenants/tenant-17/*'] }))],
  ['tenant 17 gets metadata', ddb('dynamodb:GetItem', tenantContext('tenant-17', 'standard', { 'dynamodb:LeadingKeys': ['tenant-17'] }))],
  ['tenant 17 puts metadata', ddb('dynamodb:PutItem', tenantContext('tenant-17', 'standard', { 'dynamodb:LeadingKeys': ['tenant-17'] }))],
  ['tenant 17 updates metadata', ddb('dynamodb:UpdateItem', tenantContext('tenant-17', 'standard', { 'dynamodb:LeadingKeys': ['tenant-17'] }))],
  ['tenant 17 deletes metadata', ddb('dynamodb:DeleteItem', tenantContext('tenant-17', 'standard', { 'dynamodb:LeadingKeys': ['tenant-17'] }))],
  ['tenant 17 queries metadata', ddb('dynamodb:Query', tenantContext('tenant-17', 'standard', { 'dynamodb:LeadingKeys': ['tenant-17'] }))],
  ['tenant 17 queries with a repeated key', ddb('dynamodb:Query', tenantContext('tenant-17', 'standard', { 'dynamodb:LeadingKeys': ['tenant-17', 'tenant-17'] }))],
  ['tenant 17 gets metadata with a scalar key', ddb('dynamodb:GetItem', tenantContext('tenant-17', 'standard', { 'dynamodb:LeadingKeys': 'tenant-17' }))],
  ['tenant 17 writes a premium export', s3('s3:PutObject', `${bucket}/exports/tenant-17/report.json`, tenantContext('tenant-17', 'premium'))],
  ['tenant 17 writes another premium export', s3('s3:PutObject', `${bucket}/exports/tenant-17/monthly.json`, tenantContext('tenant-17', 'premium'))],
  ['tenant 17 writes a third premium export', s3('s3:PutObject', `${bucket}/exports/tenant-17/annual.json`, tenantContext('tenant-17', 'premium'))],
  ['tenant 17 writes a fourth premium export', s3('s3:PutObject', `${bucket}/exports/tenant-17/latest.json`, tenantContext('tenant-17', 'premium'))]
];

for (const [name, request] of tenant17Allows) {
  test(`allows ${name}`, () => assert.equal(isAllowed([tenantPolicy], request), true));
}

const additionalDenials = [
  ['another tenant object write', s3('s3:PutObject', `${bucket}/tenants/other/report.json`, tenantContext('acme'))],
  ['another tenant object delete', s3('s3:DeleteObject', `${bucket}/tenants/other/report.json`, tenantContext('acme'))],
  ['another tenant object version read', s3('s3:GetObjectVersion', `${bucket}/tenants/other/report.json`, tenantContext('acme'))],
  ['lookalike tenant prefix read', s3('s3:GetObject', `${bucket}/tenants/acme-2/report.json`, tenantContext('acme'))],
  ['other list prefix without trailing slash', s3('s3:ListBucket', bucket, tenantContext('acme', 'standard', { 's3:prefix': ['tenants/other'] }))],
  ['other list prefix with a sibling value', s3('s3:ListBucket', bucket, tenantContext('acme', 'standard', { 's3:prefix': ['tenants/other/', 'exports/acme/'] }))],
  ['other metadata get', ddb('dynamodb:GetItem', tenantContext('acme', 'standard', { 'dynamodb:LeadingKeys': ['other'] }))],
  ['other metadata put', ddb('dynamodb:PutItem', tenantContext('acme', 'standard', { 'dynamodb:LeadingKeys': ['other'] }))],
  ['other metadata update', ddb('dynamodb:UpdateItem', tenantContext('acme', 'standard', { 'dynamodb:LeadingKeys': ['other'] }))],
  ['other metadata delete', ddb('dynamodb:DeleteItem', tenantContext('acme', 'standard', { 'dynamodb:LeadingKeys': ['other'] }))],
  ['other metadata query', ddb('dynamodb:Query', tenantContext('acme', 'standard', { 'dynamodb:LeadingKeys': ['other'] }))],
  ['missing tag cannot put object', s3('s3:PutObject', `${bucket}/tenants/acme/report.json`, {})],
  ['missing tag cannot delete object', s3('s3:DeleteObject', `${bucket}/tenants/acme/report.json`, {})],
  ['missing tag cannot list bucket', s3('s3:ListBucket', bucket, { 's3:prefix': ['tenants/acme/'] })],
  ['missing tag cannot put metadata', ddb('dynamodb:PutItem', { 'dynamodb:LeadingKeys': ['acme'] })],
  ['missing tag cannot update metadata', ddb('dynamodb:UpdateItem', { 'dynamodb:LeadingKeys': ['acme'] })],
  ['missing tag cannot delete metadata', ddb('dynamodb:DeleteItem', { 'dynamodb:LeadingKeys': ['acme'] })],
  ['missing tag cannot query metadata', ddb('dynamodb:Query', { 'dynamodb:LeadingKeys': ['acme'] })],
  ['standard tenant cannot put export under its id', s3('s3:PutObject', `${bucket}/exports/acme/report.json`, tenantContext('acme', 'standard'))],
  ['premium tenant cannot put export under another id', s3('s3:PutObject', `${bucket}/exports/other/report.json`, tenantContext('acme', 'premium'))],
  ['tenant without tier cannot put export', s3('s3:PutObject', `${bucket}/exports/acme/report.json`, { 'aws:PrincipalTag/tenant': 'acme' })],
  ['premium tenant cannot delete export', s3('s3:DeleteObject', `${bucket}/exports/acme/report.json`, tenantContext('acme', 'premium'))],
  ['support cannot read an export', s3('s3:GetObject', `${bucket}/exports/other/report.json`, {}, supportPrincipal)],
  ['support cannot put a document', s3('s3:PutObject', `${bucket}/tenants/other/report.json`, {}, supportPrincipal)],
  ['support cannot delete a document', s3('s3:DeleteObject', `${bucket}/tenants/other/report.json`, {}, supportPrincipal)],
  ['support cannot read object versions', s3('s3:GetObjectVersion', `${bucket}/tenants/other/report.json`, {}, supportPrincipal)],
  ['support cannot batch write metadata', ddb('dynamodb:BatchWriteItem', {}, supportPrincipal)],
  ['support cannot transact-write metadata', ddb('dynamodb:TransactWriteItems', {}, supportPrincipal)],
  ['support cannot create a metadata table', ddb('dynamodb:CreateTable', {}, supportPrincipal)],
  ['tenant cannot create a table', ddb('dynamodb:CreateTable', tenantContext('acme', 'standard', { 'dynamodb:LeadingKeys': ['acme'] }))],
  ['tenant cannot read a table without a leading key', ddb('dynamodb:GetItem', tenantContext('acme'))]
];

for (const [name, request] of additionalDenials) {
  const policy = request.principal && request.principal.AWS === config.supportPrincipal ? supportPolicy : tenantPolicy;
  test(`denies ${name}`, () => assert.equal(isAllowed([policy], request), false));
}
