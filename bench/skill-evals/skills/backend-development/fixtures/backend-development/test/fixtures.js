'use strict';

let counter = 0;

function makeTask(overrides = {}) {
  counter += 1;
  return { id: `task-${counter}`, title: `Task ${counter}`, ...overrides };
}

function makeEvent({ id, body, correlationId = 'corr-test' } = {}) {
  return {
    headers: { 'x-correlation-id': correlationId },
    pathParameters: { id },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

module.exports = { makeTask, makeEvent };
