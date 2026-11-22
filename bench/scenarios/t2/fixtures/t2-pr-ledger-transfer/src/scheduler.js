'use strict';

const { runScheduledTransfer } = require('./scheduled-transfers');

function isDue(schedule, now) {
  return schedule.enabled && schedule.hour === now.getHours() && schedule.minute === now.getMinutes();
}

function runDueSchedules(store, schedules, ledger, now = new Date()) {
  const results = [];
  for (const schedule of schedules) {
    if (!isDue(schedule, now)) continue;
    try {
      const result = runScheduledTransfer(store, schedule, ledger, now.toISOString());
      store.setScheduleRun(schedule.id, { status: 'done', ranAt: now.toISOString(), result });
      results.push(result);
    } catch (error) {
      store.setScheduleRun(schedule.id, { status: 'done', ranAt: now.toISOString(), error: error.message });
      results.push({ status: 'done', id: schedule.id });
    }
  }
  return results;
}

module.exports = { isDue, runDueSchedules };
