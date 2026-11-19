'use strict';
const { CloudClient } = require('../cloud/client');
const { resources } = require('../../config/stages');
const { logStart } = require('../logging');
const { required, stageOf } = require('../validate');
async function handler(event = {}, context = {}, { client } = {}) {
  const stage = stageOf(event); const r = resources(stage).fulfilmentWorker;
  client = client || new CloudClient({ stage });
  await logStart(client, stage, 'fulfilmentWorker');
  const receipt = required(event.receiptHandle || 'receipt-local', 'receiptHandle');
  await client.request('sqs:GetQueueAttributes', r.queue, { names: ['ApproximateNumberOfMessages'] });
  await client.request('sqs:ReceiveMessage', r.queue, { maxNumber: 1 });
  await client.request('sqs:ChangeMessageVisibility', r.queue, { receipt, timeout: event.visibilityTimeout || 30 });
  await client.request('dynamodb:UpdateItem', r.table, { shipmentId: event.shipmentId || 'shipment-local' });
  if (event.redrive === true) await client.request('sqs:SendMessage', r.deadLetterQueue, { receipt });
  await client.request('sqs:DeleteMessage', r.queue, { receipt });
  return { processed: true, redriven: event.redrive === true };
}
module.exports = { handler };
