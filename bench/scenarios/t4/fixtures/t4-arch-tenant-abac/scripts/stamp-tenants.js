#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'config', 'tenants.json');
const output = path.join(root, 'infra', 'tenants');
const args = new Set(process.argv.slice(2));

function loadTenants() {
  const parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
  if (!Array.isArray(parsed.tenants) || parsed.tenants.length === 0) throw new Error('tenant catalog is empty');
  return parsed.tenants;
}

function policyFor(tenant) {
  return {
    Version: '2012-10-17',
    Statement: [{
      Sid: 'TenantDocumentAccess',
      Effect: 'Allow',
      Action: ['s3:GetObject', 's3:PutObject'],
      Resource: `arn:aws:s3:::ledger-tenant-documents-example/tenants/${tenant.id}/*`
    }]
  };
}

function render(tenant) { return `${JSON.stringify(policyFor(tenant), null, 2)}
`; }
function fileFor(tenant) { return path.join(output, `${tenant.id}-policy.json`); }

function main() {
  const tenants = loadTenants();
  if (args.has('--check')) {
    const mismatches = tenants.filter((tenant) => !fs.existsSync(fileFor(tenant)) || fs.readFileSync(fileFor(tenant), 'utf8') !== render(tenant));
    if (mismatches.length) {
      console.error(`tenant policy mismatch: ${mismatches.map((t) => t.id).join(', ')}`);
      process.exitCode = 1;
    }
    return;
  }
  fs.mkdirSync(output, { recursive: true });
  for (const tenant of tenants) fs.writeFileSync(fileFor(tenant), render(tenant));
}

main();
