'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/db');
const { createTaskService } = require('../src/services/factory');
const { NotFoundError, InvalidTransitionError } = require('../src/errors');
const { makeTask } = require('./fixtures');

test.beforeEach(() => db.reset());

test('createTask stores an OPEN task', async () => {
  const service = createTaskService();
  const input = makeTask();
  const created = await service.createTask(input);
  assert.equal(created.status, 'OPEN');
  assert.equal(created.title, input.title);
});

test('changeStatus applies an allowed transition', async () => {
  const service = createTaskService();
  const input = makeTask();
  await service.createTask(input);
  const updated = await service.changeStatus(input.id, 'IN_PROGRESS');
  assert.equal(updated.status, 'IN_PROGRESS');
});

test('changeStatus rejects a disallowed transition', async () => {
  const service = createTaskService();
  const input = makeTask();
  await service.createTask(input);
  await assert.rejects(service.changeStatus(input.id, 'DONE'), InvalidTransitionError);
});

test('getTask throws NotFoundError for a missing task', async () => {
  await assert.rejects(createTaskService().getTask('missing'), NotFoundError);
});
