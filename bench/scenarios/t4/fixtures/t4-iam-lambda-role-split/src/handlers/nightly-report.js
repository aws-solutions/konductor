'use strict';
const { CloudClient } = require('../cloud/client');
const { resources } = require('../../config/stages');
const { logStart } = require('../logging');
const { stageOf } = require('../validate');
async function handler(event = {}, context = {}, { client } = {}) {
  const stage = stageOf(event); const r = resources(stage).nightlyReport;
  client = client || new CloudClient({ stage });
  await logStart(client, stage, 'nightlyReport');
  const reportDate = event.reportDate || '2025-01-15';
  await client.request('dynamodb:Query', r.index, { reportDate });
  const object = `reports/${reportDate}.json`;
  await client.request('s3:PutObject', `${r.bucket}/${object}`, { reportDate });
  return { reportDate, object };
}
module.exports = { handler };
