// SPDX-License-Identifier: Apache-2.0
'use strict';

// Dates in a task prompt, and the stale ones: ahead of the task's authoring date, behind today. The agent is told
// today's date, so a request about an "upcoming" day that has passed makes it hedge instead of doing the task (the
// convention control on 2026-11-23, reports/pilot-diagnosis-2026-11-23.md).
// shortcut: prompt text only, English month names, years 2000 to 2099; fixture files are not read.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const FORMS = [
  { re: /\b(20\d\d)-(\d\d)-(\d\d)\b/g, ymd: (m) => [m[1], m[2], m[3]] },
  { re: new RegExp(`\\b(\\d{1,2}) ${MON},? (20\\d\\d)\\b`, 'g'), ymd: (m) => [m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, m[1]] },
  { re: new RegExp(`\\b${MON} (\\d{1,2}),? (20\\d\\d)\\b`, 'g'), ymd: (m) => [m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, m[2]] },
];
// A prompt that says its dates are as given has told the agent not to check them against today.
const AS_GIVEN = /\bas given\b/i;

const pad = (n) => String(n).padStart(2, '0');

/**
 * Every date written in the text, in text order.
 * @param {string} text
 * @returns {{text:string, iso:string, index:number}[]} iso is YYYY-MM-DD; a day that does not exist is left out
 */
function datesIn(text) {
  const out = [];
  for (const f of FORMS) {
    for (const m of String(text).matchAll(f.re)) {
      const [y, mo, d] = f.ymd(m).map(Number);
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) continue;
      out.push({ text: m[0], iso: `${y}-${pad(mo)}-${pad(d)}`, index: m.index });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * The prompt dates that were ahead of the task's authorship.date and are behind now.
 * @param {object} task a task file
 * @param {{now?:Date}} [o] the day to judge against
 * @returns {{text:string, iso:string, index:number}[]} [] without an authoring date or when the prompt takes dates as given
 */
function staleDates(task, { now = new Date() } = {}) {
  const written = task?.authorship?.date;
  if (!/^\d{4}-\d\d-\d\d$/.test(written ?? '') || typeof task.prompt !== 'string' || AS_GIVEN.test(task.prompt)) return [];
  const today = now.toISOString().slice(0, 10);
  return datesIn(task.prompt).filter((d) => d.iso > written && d.iso < today);
}

/** Lint warnings for one task: [{ rule: 'stale-date', where: 'prompt', detail }]. */
function staleDateWarnings(task, o) {
  const today = (o?.now ?? new Date()).toISOString().slice(0, 10);
  return staleDates(task, o).map((d) => ({
    rule: 'stale-date', where: 'prompt',
    detail: `${d.iso} was ahead when the task was written (${task.authorship.date}) and is behind ${today}: the agent is told today's date and may hedge. Move the date forward or say the dates are as given`,
  }));
}

module.exports = { datesIn, staleDates, staleDateWarnings };
