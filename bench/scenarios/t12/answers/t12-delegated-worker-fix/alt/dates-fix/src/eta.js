'use strict';

const holidays = require('../config/holidays.json');

const DAYS = { standard: 3, express: 1 };
const DAY_MS = 24 * 60 * 60 * 1000;

// Day numbers (days since 1970-01-01 UTC) are easy to step through and compare.
const dayNumber = (d) => Math.floor(d.getTime() / DAY_MS);
const HOLIDAY_DAYS = new Set(holidays.map((h) => dayNumber(new Date(h))));
const isWeekend = (n) => [0, 6].includes(new Date(n * DAY_MS).getUTCDay());

function startDay(shipDate) {
  const text = shipDate instanceof Date ? shipDate.toISOString().slice(0, 10) : String(shipDate);
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) throw new Error(`bad ship date: ${shipDate}`);
  return dayNumber(d);
}

/** The ISO delivery date of a parcel shipped on `shipDate` with `service`. */
function deliveryDate(shipDate, service) {
  if (!Object.hasOwn(DAYS, service)) throw new Error(`unknown service: ${service}`);
  let n = startDay(shipDate);
  let counted = 0;
  while (counted < DAYS[service]) {
    n += 1;
    if (!isWeekend(n) && !HOLIDAY_DAYS.has(n)) counted += 1;
  }
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

module.exports = { deliveryDate };
