'use strict';

function createStore(seed = {}) {
  const accounts = new Map((seed.accounts || []).map((a) => [a.id, structuredClone(a)]));
  const journal = [...(seed.journal || [])].map((line) => structuredClone(line));
  const transfers = new Map((seed.transfers || []).map((t) => [t.clientKey, structuredClone(t)]));
  const scheduleRuns = new Map();

  return {
    getAccount(id) { return accounts.get(id); },
    listAccounts() { return [...accounts.values()]; },
    putAccount(account) { accounts.set(account.id, account); },
    appendJournal(line) { journal.push(line); },
    listJournal() { return journal.slice(); },
    hasTransfer(clientKey) { return transfers.has(clientKey); },
    getTransfer(clientKey) { return transfers.get(clientKey); },
    recordTransfer(transfer) { transfers.set(transfer.clientKey, transfer); },
    getScheduleRun(id) { return scheduleRuns.get(id); },
    setScheduleRun(id, state) { scheduleRuns.set(id, structuredClone(state)); },
    withTransaction(work) {
      const accountCopy = new Map([...accounts].map(([id, a]) => [id, structuredClone(a)]));
      const journalLength = journal.length;
      const transferCopy = new Map([...transfers].map(([key, t]) => [key, structuredClone(t)]));
      try { return work(); }
      catch (error) {
        accounts.clear(); for (const [id, a] of accountCopy) accounts.set(id, a);
        journal.length = journalLength;
        transfers.clear(); for (const [key, t] of transferCopy) transfers.set(key, t);
        throw error;
      }
    },
  };
}

module.exports = { createStore };
