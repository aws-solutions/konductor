'use strict';
const { makeId } = require('../lib/ids');
function accountRepository(store) {
  return {
    list() { return store.read().accounts || []; },
    get(accountId) { return this.list().find(a => a.id === accountId) || null; },
    create(input) { const data = store.read(); const account = { id: input.id || makeId('acct'), name: input.name, plan: input.plan || 'free', projectLimitOverride: input.projectLimitOverride || null }; data.accounts = data.accounts || []; data.accounts.push(account); store.write(data); return account; },
    save(account) { const data = store.read(); data.accounts = (data.accounts || []).map(a => a.id === account.id ? account : a); store.write(data); return account; }
  };
}
module.exports = { accountRepository };
