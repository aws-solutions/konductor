'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { FakeCloudClient } = require('../src/cloud/fake-client');
test('fake client records action and resource', async () => { const c = new FakeCloudClient(); await c.request('demo:Read', 'arn:demo:item'); assert.deepEqual(c.calls[0].action, 'demo:Read'); assert.equal(c.calls[0].resource, 'arn:demo:item'); });
