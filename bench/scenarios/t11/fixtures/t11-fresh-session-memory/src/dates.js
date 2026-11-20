'use strict';

// Calendar helpers. Dates are plain 'YYYY-MM-DD' strings in the API and UTC midnights inside.

const fs = require('node:fs');
const path = require('node:path');

const DAY_MS = 24 * 60 * 60 * 1000;
const HOLIDAYS_FILE = path.join(__dirname, '..', 'config', 'holidays.json');

let holidayCache = null;

function holidays() {
  if (!holidayCache) holidayCache = new Set(JSON.parse(fs.readFileSync(HOLIDAYS_FILE, 'utf8')).dates);
  return holidayCache;
}

function parseDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(text))) throw new Error(`not a date: ${text}`);
  const d = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || formatDate(d) !== text) throw new Error(`not a date: ${text}`);
  return d;
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(text, n) {
  return formatDate(new Date(parseDate(text).getTime() + n * DAY_MS));
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
function daysBetween(from, to) {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / DAY_MS);
}

function isWeekend(text) {
  const day = parseDate(text).getUTCDay();
  return day === 0 || day === 6;
}

function isHoliday(text) {
  return holidays().has(text);
}

/** A weekday that is not an office holiday. */
function isBusinessDay(text) {
  return !isWeekend(text) && !isHoliday(text);
}

module.exports = { parseDate, formatDate, addDays, daysBetween, isWeekend, isHoliday, isBusinessDay };
