'use strict';

const { createTaskService } = require('../services/factory');

const taskFacade = {
  async createTask(input) {
    return createTaskService().createTask(input);
  },

  async getTask(id) {
    return createTaskService().getTask(id);
  },

  async changeStatus(id, nextStatus) {
    return createTaskService().changeStatus(id, nextStatus);
  },
};

module.exports = { taskFacade };
