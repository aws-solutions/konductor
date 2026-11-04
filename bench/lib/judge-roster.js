// SPDX-License-Identifier: Apache-2.0
/**
 * The judge roster: which judges grade a run. It is user configuration, never code. The benchmark
 * ships no judge, no model id and no default panel.
 *
 * A seat is `{ seat, family, plugin, model }`:
 *   seat    a short label for this judge in records and file names (a slug, see slug.js)
 *   family  a tag naming the model family or vendor lineage, so the panel can be checked for
 *           independence. Any slug; the tag is the user's, core does not interpret it
 *   plugin  the id of the grader plugin that makes the call (see run/judge.js)
 *   model   the model name the plugin is asked for; an opaque string to core
 *
 * Panel rule: at least MIN_SEATS seats, each with its own family. One judge's opinion is not a
 * panel, and two judges from one family tend to agree for the same reasons. Seat labels must be
 * unique too, because a seat is also a file name.
 *
 * `validateRoster` reports every problem at once. `validateJudgeConfig` checks the roster and the
 * presentation-order settings together and fills in the defaults:
 *   judges         the roster
 *   judgeOrders    the presentation orders (default both: `with-first`, `without-first`)
 *   ordersPerPair  how many of those orders each seat judges a pair in (default all of them). With
 *                  fewer, plan.js alternates the orders across a seat's pairs so position bias
 *                  cancels across pairs instead of within each one
 */
const { ORDERS } = require('./verdict');
const { isSlug } = require('./slug');

/** The smallest panel. */
const MIN_SEATS = 3;

const SEAT_KEYS = Object.freeze(['seat', 'family', 'plugin', 'model']);
const MAX_MODEL_LENGTH = 200;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const show = (value) => JSON.stringify(String(value).slice(0, 60));

/** Problems with one seat entry, as a list of short sentences. */
function seatProblems(entry, index) {
  const where = `judges[${index}]`;
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return [`${where} must be an object with ${SEAT_KEYS.join(', ')}`];
  }
  const problems = [];
  for (const key of Object.keys(entry)) {
    if (!SEAT_KEYS.includes(key)) {
      problems.push(`${where} has an unknown field ${show(key)}; use ${SEAT_KEYS.join(', ')}`);
    }
  }
  for (const key of ['seat', 'family', 'plugin']) {
    if (!isSlug(entry[key])) {
      problems.push(
        `${where}.${key} must be lower-case letters, digits, ".", "_" or "-", starting with a ` +
          `letter or digit; got ${show(entry[key])}`,
      );
    }
  }
  const model = entry.model;
  if (
    typeof model !== 'string' ||
    model.trim() === '' ||
    model.length > MAX_MODEL_LENGTH ||
    CONTROL_CHARS.test(model)
  ) {
    problems.push(
      `${where}.model must be a non-empty single-line string of at most ${MAX_MODEL_LENGTH} characters`,
    );
  }
  return problems;
}

function rosterProblems(judges, minSeats) {
  if (!Array.isArray(judges)) return ['the judge roster must be an array of seats'];
  const problems = judges.flatMap(seatProblems);
  const owners = (key) => {
    const byValue = new Map();
    judges.forEach((entry) => {
      const value = entry && typeof entry === 'object' ? entry[key] : undefined;
      if (typeof value !== 'string') return;
      byValue.set(value, [...(byValue.get(value) || []), entry.seat]);
    });
    return [...byValue].filter(([, seats]) => seats.length > 1);
  };
  for (const [seat] of owners('seat')) problems.push(`seat label ${show(seat)} is used more than once`);
  if (judges.length < minSeats) {
    problems.push(`the panel needs at least ${minSeats} seats, got ${judges.length}`);
  }
  for (const [family, seats] of owners('family')) {
    problems.push(
      `seats ${seats.map(show).join(' and ')} share the family ${show(family)}; ` +
        'each seat needs its own family',
    );
  }
  return problems;
}

/**
 * Checks a roster and returns a frozen copy of its seats (only the four known fields). Throws one
 * Error that lists every problem; `error.problems` holds them as an array.
 */
function validateRoster(judges, { minSeats = MIN_SEATS } = {}) {
  const problems = rosterProblems(judges, minSeats);
  if (problems.length) {
    const err = new Error(`judge roster is invalid: ${problems.join('; ')}`);
    err.problems = problems;
    throw err;
  }
  return Object.freeze(
    judges.map((j) => Object.freeze({ seat: j.seat, family: j.family, plugin: j.plugin, model: j.model })),
  );
}

/**
 * Checks the judge settings of a user config and returns `{ judges, judgeOrders, ordersPerPair }`
 * with defaults filled in. Other keys of `config` are left alone.
 */
function validateJudgeConfig(config, options) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('the judge config must be an object with a "judges" roster');
  }
  const judges = validateRoster(config.judges, options);
  const orders = config.judgeOrders === undefined ? [...ORDERS] : config.judgeOrders;
  if (
    !Array.isArray(orders) ||
    orders.length === 0 ||
    new Set(orders).size !== orders.length ||
    !orders.every((o) => ORDERS.includes(o))
  ) {
    throw new Error(
      `judgeOrders must list each of ${ORDERS.join(', ')} at most once, got ${JSON.stringify(orders)}`,
    );
  }
  const perPair = config.ordersPerPair === undefined ? orders.length : config.ordersPerPair;
  if (!Number.isInteger(perPair) || perPair < 1 || perPair > orders.length) {
    throw new Error(
      `ordersPerPair must be an integer from 1 to ${orders.length}, got ${JSON.stringify(perPair)}`,
    );
  }
  return Object.freeze({
    judges,
    judgeOrders: Object.freeze([...orders]),
    ordersPerPair: perPair,
  });
}

module.exports = { MIN_SEATS, SEAT_KEYS, validateRoster, validateJudgeConfig };
