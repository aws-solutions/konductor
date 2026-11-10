'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/db');
const { taskFacade } = require('../src/facades/taskFacade');
const getTask = require('../src/handlers/getTask');
const updateTaskStatus = require('../src/handlers/updateTaskStatus');
const { makeTask, makeEvent } = require('./fixtures');

test.beforeEach(() => db.reset());

test('getTask returns 200 with the task', async () => {
  const input = makeTask();
  await taskFacade.createTask(input);
  const res = await getTask.handler(makeEvent({ id: input.id }));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).id, input.id);
});

test('getTask returns 404 for a missing task', async () => {
  const res = await getTask.handler(makeEvent({ id: 'nope' }));
  assert.equal(res.statusCode, 404);
});

test('updateTaskStatus returns 200 with the new status', async () => {
  const input = makeTask();
  await taskFacade.createTask(input);
  const res = await updateTaskStatus.handler(makeEvent({ id: input.id, body: { status: 'IN_PROGRESS' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).status, 'IN_PROGRESS');
});

test('updateTaskStatus returns 404 for a missing task', async () => {
  const res = await updateTaskStatus.handler(makeEvent({ id: 'nope', body: { status: 'DONE' } }));
  assert.equal(res.statusCode, 404);
});
