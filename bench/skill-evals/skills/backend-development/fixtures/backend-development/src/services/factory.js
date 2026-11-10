'use strict';

const { TaskService } = require('./taskService');
const { taskRepo } = require('../repositories/taskRepo');

function createTaskService() {
  return new TaskService(taskRepo);
}

module.exports = { createTaskService };
