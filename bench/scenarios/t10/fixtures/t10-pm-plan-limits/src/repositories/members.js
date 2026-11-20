'use strict';
const { makeId } = require('../lib/ids');
function memberRepository(store) {
  return {
    list(accountId) { return (store.read().members || []).filter(m => m.accountId === accountId); },
    async invite(input) { return store.withLock(async () => { const data = store.read(); data.members = data.members || []; const member = { id: makeId('mem'), accountId: input.accountId, email: input.email, state: 'invited' }; data.members.push(member); store.write(data); return member; }); },
    activate(memberId) { const data = store.read(); let result; data.members = (data.members || []).map(m => m.id === memberId ? (result = {...m, state: 'active'}) : m); store.write(data); return result || null; }
  };
}
module.exports = { memberRepository };
