'use strict';

const { db } = require('../db');
const { log } = require('../log');

async function handler(event) {
  const correlationId = event.headers?.['x-correlation-id'];
  const id = event.pathParameters.id;
  const { status } = JSON.parse(event.body);

  const task = await db.get('tasks', id);
  if (!task) {
    log('info', 'task not found', { correlationId, taskId: id });
    return { statusCode: 404, body: JSON.stringify({ message: 'Not found' }) };
  }

  const updated = await db.update('tasks', id, { status });
  log('info', 'task status changed', { correlationId, taskId: id, from: task.status, to: status });
  return { statusCode: 200, body: JSON.stringify(updated) };
}

module.exports = { handler };
