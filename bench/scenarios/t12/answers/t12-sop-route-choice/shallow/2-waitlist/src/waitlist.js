'use strict';

const LIMIT = 5;
const OFFER_MS = 2 * 60 * 60 * 1000;
const lists = new Map();

/** Adds `guest` to the waitlist of `room` on `date`; false when the list is full. */
function join(room, date, guest) {
  const key = `${room}|${date}`;
  const list = lists.get(key) || [];
  if (list.length >= LIMIT) return false;
  list.push(guest);
  lists.set(key, list);
  return true;
}

/** The offer for the first guest waiting for `room` on `date`, or null. */
function offerNext(room, date, now = Date.now()) {
  const list = lists.get(`${room}|${date}`) || [];
  return list.length ? { guest: list.shift(), expiresAt: now + OFFER_MS } : null;
}

module.exports = { join, offerNext };
