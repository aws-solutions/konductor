'use strict';
const { CloudClient } = require('../cloud/client');
const { resources } = require('../../config/stages');
const { logStart } = require('../logging');
const { required, stageOf } = require('../validate');
async function handler(event = {}, context = {}, { client } = {}) {
  const stage = stageOf(event); const r = resources(stage).createOrder;
  client = client || new CloudClient({ stage });
  await logStart(client, stage, 'createOrder');
  const orderId = required(event.orderId, 'orderId');
  await client.request('dynamodb:PutItem', r.table, { orderId, customerId: event.customerId || 'unknown' });
  return { statusCode: 201, orderId, requestId: context.awsRequestId || 'local-request' };
}
module.exports = { handler };
