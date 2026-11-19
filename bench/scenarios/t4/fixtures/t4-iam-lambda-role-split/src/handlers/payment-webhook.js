'use strict';
const { CloudClient } = require('../cloud/client');
const { resources } = require('../../config/stages');
const { logStart } = require('../logging');
const { required, stageOf } = require('../validate');
async function handler(event = {}, context = {}, { client } = {}) {
  const stage = stageOf(event); const r = resources(stage).paymentWebhook;
  client = client || new CloudClient({ stage });
  await logStart(client, stage, 'paymentWebhook');
  const paymentId = required(event.paymentId, 'paymentId');
  await client.request('secretsmanager:GetSecretValue', r.secret, { version: 'current' });
  await client.request('dynamodb:UpdateItem', r.table, { paymentId, status: event.status || 'received' });
  await client.request('sqs:SendMessage', r.queue, { paymentId });
  return { accepted: true, paymentId };
}
module.exports = { handler };
