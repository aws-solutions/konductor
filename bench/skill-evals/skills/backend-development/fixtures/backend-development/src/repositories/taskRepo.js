'use strict';

const { db } = require('../db');

const TABLE = 'tasks';

const taskRepo = {
  async create(task) {
    await db.put(TABLE, task.id, task, { condition: { exists: false } });
    return db.get(TABLE, task.id);
  },

  async getById(id) {
    return db.get(TABLE, id);
  },

  async save(task) {
    return db.put(TABLE, task.id, task);
  },
};

module.exports = { taskRepo };
