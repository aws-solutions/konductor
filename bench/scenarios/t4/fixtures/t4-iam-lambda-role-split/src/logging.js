'use strict';
const { resources } = require('../config/stages');
async function logStart(client, stage, functionName) {
  const group = resources(stage)[functionName].logGroup;
  await client.request('logs:CreateLogGroup', group);
  await client.request('logs:CreateLogStream', group);
  await client.request('logs:PutLogEvents', group, { message: `${functionName} started` });
}
module.exports = { logStart };
