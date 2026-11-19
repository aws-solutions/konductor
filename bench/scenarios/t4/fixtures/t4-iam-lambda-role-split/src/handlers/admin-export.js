'use strict';
const { CloudClient } = require('../cloud/client');
const { resources } = require('../../config/stages');
const { logStart } = require('../logging');
const { stageOf } = require('../validate');
async function handler(event = {}, context = {}, { client } = {}) {
  const stage = stageOf(event); const r = resources(stage).adminExport;
  client = client || new CloudClient({ stage });
  await logStart(client, stage, 'adminExport');
  await client.request('dynamodb:Scan', r.table, { limit: 500 });
  const object = `exports/${event.exportId || 'daily'}.json`;
  await client.request('s3:PutObject', `${r.bucket}/${object}`, { object });
  return { object };
}
module.exports = { handler };
