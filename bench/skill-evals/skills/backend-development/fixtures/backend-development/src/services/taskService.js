'use strict';

const { NotFoundError, InvalidTransitionError } = require('../errors');

const ALLOWED = {
  OPEN: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['DONE', 'OPEN'],
  DONE: [],
  CANCELLED: [],
};

class TaskService {
  constructor(repo) {
    this.repo = repo;
  }

  async createTask({ id, title }) {
    return this.repo.create({ id, title, status: 'OPEN' });
  }

  async getTask(id) {
    const task = await this.repo.getById(id);
    if (!task) throw new NotFoundError(`Task ${id} not found`);
    return task;
  }

  async changeStatus(id, nextStatus) {
    const task = await this.getTask(id);
    if (!ALLOWED[task.status].includes(nextStatus)) {
      throw new InvalidTransitionError(`Cannot move task from ${task.status} to ${nextStatus}`);
    }
    task.status = nextStatus;
    return this.repo.save(task);
  }
}

module.exports = { TaskService };
