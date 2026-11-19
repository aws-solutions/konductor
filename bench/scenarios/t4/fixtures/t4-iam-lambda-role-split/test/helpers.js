'use strict';
const { FakeCloudClient } = require('../src/cloud/fake-client');
function fake() { return new FakeCloudClient({ stage: 'staging' }); }
module.exports = { fake };
