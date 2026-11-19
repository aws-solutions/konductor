'use strict';

const { MemoryStore } = require('../src/store/memory-store');

function fixtureStore() {
  return new MemoryStore({
    issues: [
      { id: 'ISS-1', title: 'One', status: 'open', assigneeId: 'u-1', createdAt: '2025-01-01T00:00:00.000Z' },
      { id: 'ISS-2', title: 'Two', status: 'open', assigneeId: 'u-1', createdAt: '2025-01-02T00:00:00.000Z' },
      { id: 'ISS-3', title: 'Three', status: 'closed', assigneeId: 'u-2', createdAt: '2025-01-03T00:00:00.000Z' },
    ],
    comments: [],
    users: [{ id: 'u-1', name: 'Ari Stone' }, { id: 'u-2', name: 'Morgan Lee' }],
  });
}

module.exports = { fixtureStore };
