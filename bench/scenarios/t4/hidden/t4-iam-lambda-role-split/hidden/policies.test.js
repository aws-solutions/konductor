'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluate, isAllowed, lint } = require('./iam-eval.js');
const { resources } = require('../config/stages');
const { FakeCloudClient } = require('../src/cloud/fake-client');

const root = path.resolve(__dirname, '..');
const policyNames = ['create-order', 'payment-webhook', 'fulfilment-worker', 'nightly-report', 'admin-export'];
const modules = {
  'create-order': require('../src/handlers/create-order').handler,
  'payment-webhook': require('../src/handlers/payment-webhook').handler,
  'fulfilment-worker': require('../src/handlers/fulfilment-worker').handler,
  'nightly-report': require('../src/handlers/nightly-report').handler,
  'admin-export': require('../src/handlers/admin-export').handler,
};
const events = {
  'create-order': { orderId: 'order-1001', customerId: 'customer-22' },
  'payment-webhook': { paymentId: 'payment-77', status: 'settled' },
  'fulfilment-worker': { receiptHandle: 'receipt-3', shipmentId: 'shipment-3' },
  'nightly-report': { reportDate: '2025-01-15' },
  'admin-export': { exportId: 'export-9' },
};

function policy(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'infra', 'iam', `${name}.json`), 'utf8'));
}
function request(call) {
  return { action: call.action, resource: call.resource, principal: { AWS: 'arn:aws:iam::111122223333:role/demo' }, context: {} };
}
async function callsFor(name, stage, extra = {}) {
  const client = new FakeCloudClient({ stage });
  await modules[name]({ ...events[name], stage, ...extra }, {}, { client });
  return client.calls;
}

for (const name of policyNames) {
  test(`${name} policy has a valid document`, () => {
    assert.deepEqual(lint(policy(name)), []);
  });
}

for (const name of policyNames) {
  for (const stage of ['staging', 'prod']) {
    test(`${name} allows every call it makes in ${stage}`, async () => {
      const calls = await callsFor(name, stage);
      assert.ok(calls.length > 0);
      for (const call of calls) assert.equal(isAllowed([policy(name)], request(call)), true, `${call.action} ${call.resource}`);
    });
  }
}

for (const stage of ['staging', 'prod']) {
  test(`fulfilment-worker allows its redrive path in ${stage}`, async () => {
    const calls = await callsFor('fulfilment-worker', stage, { redrive: true });
    const redrive = calls.find((call) => call.resource.includes('fulfilment-dlq'));
    assert.ok(redrive);
    assert.equal(redrive.action, 'sqs:SendMessage');
    assert.equal(isAllowed([policy('fulfilment-worker')], request(redrive)), true);
  });
}

for (const name of policyNames) {
  for (const stage of ['staging', 'prod']) {
    test(`${name} permits only its own log calls in ${stage}`, async () => {
      const calls = await callsFor(name, stage);
      const logs = calls.filter((call) => call.action.startsWith('logs:'));
      assert.equal(logs.length, 3);
      for (const call of logs) assert.equal(isAllowed([policy(name)], request(call)), true);
    });
  }
}

for (let i = 0; i < policyNames.length; i += 1) {
  const name = policyNames[i];
  const other = policyNames[(i + 1) % policyNames.length];
  test(`${name} denies a non-log call made by ${other}`, async () => {
    const calls = (await callsFor(other, 'staging')).filter((call) => !call.action.startsWith('logs:'));
    assert.ok(calls.length > 0);
    assert.equal(isAllowed([policy(name)], request(calls[0])), false);
  });
}

for (const name of policyNames) {
  for (const stage of ['staging', 'prod']) {
    test(`${name} denies deleting the legacy table in ${stage}`, () => {
      const legacy = resources(stage).legacy;
      assert.equal(isAllowed([policy(name)], {
        action: 'dynamodb:DeleteTable', resource: legacy.table,
        principal: { AWS: 'arn:aws:iam::111122223333:role/demo' }, context: {},
      }), false);
    });
  }
}

for (const name of policyNames) {
  test(`${name} denies an object delete in the legacy bucket`, () => {
    const legacy = resources('staging').legacy;
    assert.equal(isAllowed([policy(name)], {
      action: 's3:DeleteObject', resource: `${legacy.bucket}/old/report.json`,
      principal: { AWS: 'arn:aws:iam::111122223333:role/demo' }, context: {},
    }), false);
  });
}

for (const name of policyNames) {
  test(`${name} denies reading another function's secret`, () => {
    const legacy = resources('prod').legacy;
    assert.equal(isAllowed([policy(name)], {
      action: 'secretsmanager:GetSecretValue', resource: legacy.secret,
      principal: { AWS: 'arn:aws:iam::111122223333:role/demo' }, context: {},
    }), false);
  });
}

for (const name of policyNames) {
  test(`${name} denies an IAM role change`, () => {
    assert.equal(isAllowed([policy(name)], {
      action: 'iam:CreateRole', resource: 'arn:aws:iam::111122223333:role/staging-legacy-runner',
      principal: { AWS: 'arn:aws:iam::111122223333:role/demo' }, context: {},
    }), false);
  });
}
