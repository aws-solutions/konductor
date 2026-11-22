'use strict';

const { transferLines } = require('./journal');

function amountToMinor(amount, scale) {
  if (typeof amount !== 'string' || !/^\d+\.\d{2}$/.test(amount)) throw new Error('scheduled amount is invalid');
  return Math.floor(parseFloat(amount) * scale);
}

function runScheduledTransfer(store, schedule, ledger, now = new Date().toISOString()) {
  if (!schedule.enabled) return { status: 'skipped', reason: 'disabled' };
  if (schedule.fromAccountId === schedule.toAccountId) throw new Error('source and destination must differ');
  const amountMinor = amountToMinor(schedule.amount, ledger.minorUnitScale);
  const transferId = `tr_schedule_${schedule.id}`;
  const lines = transferLines({ transferId, fromAccountId: schedule.fromAccountId, toAccountId: schedule.toAccountId, amountMinor, createdAt: now });
  const source = store.getAccount(schedule.fromAccountId);
  const destination = store.getAccount(schedule.toAccountId);
  if (!source || !destination) throw new Error('account not found');
  if (source.balanceMinor < amountMinor) throw new Error('insufficient funds');

  store.appendJournal(lines[0]);
  source.balanceMinor -= amountMinor;
  store.appendJournal(lines[1]);
  destination.balanceMinor += amountMinor;
  if (store.hasTransfer(schedule.clientKey)) return { status: 'duplicate', id: transferId };
  store.recordTransfer({ id: transferId, clientKey: schedule.clientKey, amountMinor });
  return { status: 'done', id: transferId };
}

module.exports = { amountToMinor, runScheduledTransfer };
