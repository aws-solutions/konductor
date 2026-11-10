'use strict';

const { taskFacade } = require('../facades/taskFacade');
const { NotFoundError } = require('../errors');
const { log } = require('../log');

async function handler(event) {
  const correlationId = event.headers?.['x-correlation-id'];
  try {
    const task = await taskFacade.getTask(event.pathParameters.id);
    return { statusCode: 200, body: JSON.stringify(task) };
  } catch (err) {
    if (err instanceof NotFoundError) {
      log('info', 'task not found', { correlationId, taskId: event.pathParameters.id });
      return { statusCode: 404, body: JSON.stringify({ message: 'Not found' }) };
    }
    throw err;
  }
}

module.exports = { handler };
