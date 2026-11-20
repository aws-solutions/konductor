'use strict';

const HOLIDAYS = new Set(require('../config/holidays.json'));

const DAYS = { standard: 3, express: 1 };

const iso = (d) => d.toISOString().slice(0, 10);

/** A Date at midnight UTC of `shipDate`, which is a Date or an ISO date string. */
function dayOf(shipDate) {
  const d = new Date(shipDate instanceof Date ? iso(shipDate) : String(shipDate));
  if (Number.isNaN(d.getTime())) throw new Error(`bad ship date: ${shipDate}`);
  return d;
}

const isBusinessDay = (d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !HOLIDAYS.has(iso(d));

/** The ISO delivery date of a parcel shipped on `shipDate` with `service`: counted in business days from the next day. */
function deliveryDate(shipDate, service) {
  if (!Object.hasOwn(DAYS, service)) throw new Error(`unknown service: ${service}`);
  const d = dayOf(shipDate);
  for (let left = DAYS[service]; left > 0;) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isBusinessDay(d)) left--;
  }
  return iso(d);
}

module.exports = { deliveryDate };
