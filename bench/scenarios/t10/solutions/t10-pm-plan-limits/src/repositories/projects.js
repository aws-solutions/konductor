'use strict';
const { makeId } = require('../lib/ids');
function projectRepository(store) {
  return {
    list(accountId) { return (store.read().projects || []).filter(p => p.accountId === accountId); },
    get(projectId) { return (store.read().projects || []).find(p => p.id === projectId) || null; },
    countProjects(accountId) { return this.list(accountId).filter(p => p.status === 'active').length; },
    countActiveProjects(accountId) { return this.countProjects(accountId); },
    insert(input) { const data = store.read(); const project = { id: input.id || makeId('proj'), accountId: input.accountId, name: input.name, status: input.status || 'active', createdAt: input.createdAt || new Date().toISOString() }; data.projects = data.projects || []; data.projects.push(project); store.write(data); return project; },
    archive(projectId) { const data = store.read(); let result = null; data.projects = (data.projects || []).map(p => { if (p.id === projectId) { result = {...p, status: 'archived'}; return result; } return p; }); store.write(data); return result; },
    remove(projectId) { const data = store.read(); let result = null; data.projects = (data.projects || []).map(p => { if (p.id === projectId) { result = {...p, status: 'deleted'}; return result; } return p; }); store.write(data); return result; },
    withAccountLock(accountId, work) { return store.withLock(work); }
  };
}
module.exports = { projectRepository };
