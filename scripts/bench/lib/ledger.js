// SPDX-License-Identifier: Apache-2.0
/**
 * Spend ledger and limits. One append-only file, layout.ledgerFile (bench/out/ledger.jsonl),
 * shared by every run and every parallel job. Two kinds of row, one JSON object per line:
 *
 *   reserve  { type, id, ts, run, label, usd, expires, kind?, model? }   written before a paid call, at its p90 cost
 *   settle   { type, id, ts, run, label, usd, status, kind?, model?, tokens?, cost_source? }   after the call, the
 *            cost the CLI reports, or the call's mean when it reports none
 *
 * A settle row replaces the reserve row with the same id. A settled call is charged the cost its CLI reported, and
 * its row says `cost_source: "reported"`. A call that reported no usable cost (none, not a finite number, below 0, or
 * 0 while its usage shows tokens) is charged its mean from the cost profile (cost-profile.js), and its row says
 * `cost_source: "estimate"`; readLedger totals those rows per model. A model whose CLI reports less than the call
 * costs (`cliReportsLow` in the profile) is charged at least its mean, and its row says `cost_source: "floor"` when
 * the mean was used. A call that ended before any model step started and reported no cost reached no model: it is
 * charged 0 and its row says `cost_source: "none"`. A cancelled call has no cost source. A reserve row with no settle row counts as in flight
 * until `expires` (the call timeout). After that the call is unaccounted for: it may have been paid for and never
 * settled, so its reservation is counted as spent and readLedger reports how many there were (`expired`).
 *
 * Limits are checked in this order: max_usd (this run), then total_cap_usd (the ledger total plus live reservations
 * plus this call). Check and reservation are one step under an exclusive
 * lock file (<ledger>.lock, exclusive-create, stale after 60 s), so two jobs started together count each other.
 * Limits are checked when a call is reserved, at its p90. A call that then costs more is still charged what it cost:
 * its settle row has `over_reservation_usd`, settle() returns the limit the ledger is now past, and the next reserve
 * is refused. So a run can end above a limit by what the calls in flight cost over their reservations.
 * A waiter gives up after the stale age plus a margin, so one crashed holder delays the next job and does not stop it.
 * A lock that cannot be taken fails closed: the call is refused.
 *
 * The lock holds a token that only its owner knows, and only the owner removes it. A holder that is paused for longer
 * than the stale age (a suspended laptop, a stalled disk) can have its lock broken by a waiter. It finds out when its
 * write is done, because the lock file no longer holds its token. It then cancels its own reservation and refuses the
 * call, so the other job's reservation is the only one that stands. What stays open is the time between that check
 * and the release, which is a few microseconds.
 *
 * The ledger keeps a status and the cost, never provider error text. Files are mode 0600, the folder 0700.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { callCost } = require('./cost-profile');

const LIMITS = Object.freeze(['max_usd', 'total_cap_usd']);
const LOCK_STALE_MS = 60000;
// A waiter outlasts the stale age by this margin, so a lock left by a crashed holder is broken before the waiter gives up.
const LOCK_WAIT_MARGIN_MS = 10000;
const LOCK_POLL_MS = 20;
// Config has no call timeout setting yet; the code that first makes a model call adds it, together with the
// pool widths. 12 minutes is the slowest seat's limit, so a reservation outlives any call.
const DEFAULT_TTL_MS = 12 * 60 * 1000;
const EPS = 1e-9;
const TORN_ROW_TYPE = 'torn';
// Row fields that may be absent (or null) but are text when present. A row with another type for one of them is
// corrupt, so a numeric model is refused instead of being dropped from a cost profile rebuild without a word.
const OPTIONAL_TEXT_FIELDS = Object.freeze([
  'run',
  'label',
  'status',
  'cost_source',
  'kind',
  'model',
]);
const TOKEN_FIELDS = [
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
];

/** The ledger cannot be read or its lock cannot be taken. `fatal` tells the retry helper never to retry it. */
class LedgerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LedgerError';
    this.fatal = true;
  }
}
/** A call was refused. `limit` is max_usd, total_cap_usd or lock. The message starts "SPEND STOP:". */
class SpendStopError extends LedgerError {
  constructor(message, limit) {
    super(`SPEND STOP: ${message}`);
    this.name = 'SpendStopError';
    this.limit = limit;
  }
}

const isMoney = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const formatUsd = (amount) => `$${amount.toFixed(2)}`;
/** A projected cost and a limit, with as many decimals as it takes to show two different amounts as different. */
function formatUsdPair(projected, limit) {
  let decimals = 2;
  while (
    decimals < 9 &&
    projected !== limit &&
    projected.toFixed(decimals) === limit.toFixed(decimals)
  )
    decimals += 1;
  return [`$${projected.toFixed(decimals)}`, `$${limit.toFixed(decimals)}`];
}

/** True when at least one token field of `usage` is a finite number above 0. */
const showsTokens = (usage) =>
  Boolean(usage) &&
  TOKEN_FIELDS.some((field) => isMoney(usage[field]) && usage[field] > 0);

/**
 * What a settled call is charged. A reported cost cannot be used when it is missing, not a finite number, below 0, or
 * 0 while the usage shows tokens (a paid call that reported $0 has lost its cost, and charging $0 would lower the
 * total); such a call is charged `meanUsd`, its profile mean (cost-profile.js), with cost_source "estimate". A usable
 * cost is charged as reported (cost_source "reported"), except for a model whose CLI reports low (`cliReportsLow`):
 * that call is charged the larger of the reported cost and the mean, with cost_source "floor" when the mean is used.
 * `meanUsd` defaults to `reservedUsd` for a caller that reserved a plain amount. Returns { usd, cost_source }.
 *
 * `modelStarted: false` says the call ended before any model step began (a refused flag, a config the CLI rejects,
 * a model id the provider does not know): such a call with no usable cost and no tokens reached no model, so it is
 * charged 0 with cost_source "none" rather than its mean.
 */
function settledCost({
  reportedUsd,
  usage,
  reservedUsd,
  meanUsd = reservedUsd,
  cliReportsLow = false,
  modelStarted = true,
}) {
  const isUsable =
    isMoney(reportedUsd) && !(reportedUsd === 0 && showsTokens(usage));
  if (!isUsable && !modelStarted && !showsTokens(usage))
    return { usd: 0, cost_source: 'none' };
  if (!isUsable) return { usd: meanUsd, cost_source: 'estimate' };
  if (cliReportsLow && reportedUsd < meanUsd)
    return { usd: meanUsd, cost_source: 'floor' };
  return { usd: reportedUsd, cost_source: 'reported' };
}

/**
 * The ledger.reserve arguments of one call of `kind` (subject, judge or writer) with `model`: the p90 to reserve
 * (cost-profile.js callCost), and the options that tell the ledger the call's kind, model, mean and whether its CLI
 * reports low. `costProfile` defaults to the committed profile.
 */
function reservationFor(config, kind, model, costProfile) {
  const cost = callCost(config, kind, model, costProfile);
  return {
    usd: cost.p90,
    options: {
      kind,
      model,
      meanUsd: cost.mean,
      cliReportsLow: cost.cliReportsLow,
    },
  };
}

const isTornMarker = (row) => row?.type === TORN_ROW_TYPE;

function parseRows(text, file) {
  const lines = text.split('\n');
  const isMidAppend = text !== '' && !text.endsWith('\n'); // an unfinished last line may be another job writing
  const parseLine = (line) => {
    try {
      return { row: JSON.parse(line) };
    } catch (error) {
      return { error };
    }
  };
  const parsed = lines.map((line) => (line ? parseLine(line) : null));
  // The next line that is not empty, to see whether a fragment was ended by a later writer (append() below).
  const nextEntry = (index) => parsed.slice(index + 1).find(Boolean);
  const rows = [];
  parsed.forEach((entry, i) => {
    if (!entry) return;
    if (entry.error) {
      if (isMidAppend && i === lines.length - 1) return;
      // A cut-short line that a later writer ended with a torn marker: kept in the file, skipped here.
      if (isTornMarker(nextEntry(i)?.row)) return;
      // The parser's message quotes part of the line, so only the line number and the file are named.
      throw new LedgerError(
        `corrupt ledger line ${i + 1} in ${file}: not valid JSON`,
      );
    }
    const { row } = entry;
    if (isTornMarker(row)) return;
    const isValidRow =
      row &&
      (row.type === 'settle' ||
        (row.type === 'reserve' && Number.isFinite(Date.parse(row.expires)))) &&
      typeof row.id === 'string' &&
      isMoney(row.usd) &&
      OPTIONAL_TEXT_FIELDS.every(
        (field) => row[field] == null || typeof row[field] === 'string',
      );
    if (!isValidRow)
      throw new LedgerError(
        `corrupt ledger line ${i + 1} in ${file}: not a ledger row`,
      );
    rows.push(row);
  });
  return rows;
}

/**
 * Every row of the ledger file, in file order: what readLedger totals, for a caller that needs the rows themselves
 * (the cost profile rebuild). A missing file is a read error here, not an empty ledger.
 */
function readLedgerRows(file) {
  return parseRows(fs.readFileSync(file, 'utf8'), file);
}

/**
 * Totals from the file, without taking the lock (appends are whole lines, and an unfinished last line is skipped).
 * Returns { total, reserved, calls, runs: Map(run -> { spent, reserved }), estimated, unstarted, byRun, expired }. A missing file is an empty ledger.
 * `expired` is { count, usd } over the reservations that were never settled and are past `expires`. Their dollars are
 * in `total` and in the run's `spent`, because a call that outlived its reservation may have been paid for.
 * `estimated` is { calls, usd, models: { <model id>: { calls, usd } } } over the settle rows with
 * `cost_source: "estimate"`, the calls charged their mean because the CLI reported no usable cost. `unstarted` is
 * { calls } over the rows with `cost_source: "none"`, the calls that ended before a model step started and were
 * charged 0. `byRun` is Map(run -> { estimated: { calls, usd }, unstarted: { calls } }), the same two counts per run.
 */
function readLedger(file, { now = Date.now } = {}) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const rows = parseRows(text, file);
  const settled = new Set(
    rows.filter((row) => row.type === 'settle').map((row) => row.id),
  );
  const totals = {
    total: 0,
    reserved: 0,
    calls: 0,
    runs: new Map(),
    estimated: { calls: 0, usd: 0, models: {} },
    unstarted: { calls: 0 },
    byRun: new Map(),
    expired: { count: 0, usd: 0 },
  };
  const sourcesOfRun = (run) =>
    totals.byRun.get(run) ||
    totals.byRun
      .set(run, { estimated: { calls: 0, usd: 0 }, unstarted: { calls: 0 } })
      .get(run);
  const nowMs = now();
  for (const row of rows) {
    const runTotals =
      totals.runs.get(row.run) ||
      totals.runs.set(row.run, { spent: 0, reserved: 0 }).get(row.run);
    if (row.type === 'settle') {
      totals.total += row.usd;
      totals.calls += 1;
      runTotals.spent += row.usd;
      if (row.cost_source === 'none') {
        totals.unstarted.calls += 1;
        sourcesOfRun(row.run).unstarted.calls += 1;
      }
      if (row.cost_source === 'estimate') {
        const runSources = sourcesOfRun(row.run);
        runSources.estimated.calls += 1;
        runSources.estimated.usd += row.usd;
        const model = String(row.model ?? '(no model recorded)');
        const modelTotals =
          totals.estimated.models[model] ||
          (totals.estimated.models[model] = { calls: 0, usd: 0 });
        modelTotals.calls += 1;
        modelTotals.usd += row.usd;
        totals.estimated.calls += 1;
        totals.estimated.usd += row.usd;
      }
    } else if (!settled.has(row.id)) {
      if (Date.parse(row.expires) > nowMs) {
        totals.reserved += row.usd;
        runTotals.reserved += row.usd;
      } else {
        // Never settled and past its expiry: counted as spent, not dropped, so a crash cannot lower the total.
        totals.total += row.usd;
        runTotals.spent += row.usd;
        totals.expired.count += 1;
        totals.expired.usd += row.usd;
      }
    }
  }
  return totals;
}

/**
 * The first limit that `callUsd` would pass, or null. runUsd is this run's spend plus its live reservations;
 * totalUsd is the ledger total plus every live reservation. Order: max_usd, total_cap_usd.
 * Reaching a limit exactly is allowed; going above it is not.
 */
function checkLimits(limits, { runUsd, totalUsd, callUsd }) {
  const projected = {
    max_usd: runUsd + callUsd,
    total_cap_usd: totalUsd + callUsd,
  };
  const limit = LIMITS.find(
    (limitName) => projected[limitName] > limits[limitName] + EPS,
  );
  return limit
    ? { limit, limit_usd: limits[limit], projected_usd: projected[limit] }
    : null;
}

const sleepForMs = (delayMs) =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

/** True when the file has content and its last byte is not a newline: the last write was cut short. */
function endsMidLine(file) {
  let descriptor;
  try {
    descriptor = fs.openSync(file, 'r');
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  try {
    const { size } = fs.fstatSync(descriptor);
    if (size === 0) return false;
    const lastByte = Buffer.alloc(1);
    fs.readSync(descriptor, lastByte, 0, 1, size - 1);
    return lastByte[0] !== 0x0a;
  } finally {
    fs.closeSync(descriptor);
  }
}

/** The text in the lock file, or null when there is no lock file. */
function readLockToken(lockFile) {
  try {
    return fs.readFileSync(lockFile, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Runs `callback(holdsLock)` while holding the lock file. `holdsLock()` says whether the lock file still holds this
 * holder's token: false means a waiter broke the lock as stale while this holder was paused. The lock is removed at
 * the end only when it is still ours, so a holder that lost its lock cannot remove the next holder's.
 */
async function withLock(
  lockFile,
  { now, sleep, timeoutMs, staleMs },
  callback,
) {
  const startedAtMs = now();
  let lockDescriptor;
  while (lockDescriptor === undefined) {
    try {
      lockDescriptor = fs.openSync(lockFile, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let lockAgeMs = 0;
      try {
        lockAgeMs = now() - fs.statSync(lockFile).mtimeMs;
      } catch {
        continue; // released between the two calls: try again at once
      }
      if (lockAgeMs > staleMs)
        fs.rmSync(lockFile, { force: true }); // a crashed holder
      else if (now() - startedAtMs >= timeoutMs)
        throw new SpendStopError(
          `cannot take the ledger lock ${lockFile} within ${timeoutMs} ms; no paid call was started`,
          'lock',
        );
      else await sleep(LOCK_POLL_MS);
    }
  }
  const token = `${process.pid} ${crypto.randomBytes(8).toString('hex')}\n`;
  const holdsLock = () => readLockToken(lockFile) === token;
  let wroteToken = false;
  try {
    fs.writeSync(lockDescriptor, token);
    wroteToken = true;
    return callback(holdsLock);
  } finally {
    fs.closeSync(lockDescriptor);
    // This holder made the file, so a token write that failed (a full disk) still leaves the lock ours to remove.
    if (!wroteToken || holdsLock()) fs.rmSync(lockFile, { force: true });
  }
}

/**
 * A ledger for one run. `limits` is { max_usd, total_cap_usd } (loadConfig checks their order; the two
 * checks hold in any order). A waiter
 * for the lock gives up after `lockTimeoutMs`, which is the stale age plus a margin unless a test sets it.
 * Time and sleeping are injected so tests need no real clock.
 */
function createLedger({
  file,
  limits,
  runId,
  now = Date.now,
  sleep = sleepForMs,
  lockStaleMs = LOCK_STALE_MS,
  lockTimeoutMs = lockStaleMs + LOCK_WAIT_MARGIN_MS,
  newId = () => crypto.randomBytes(8).toString('hex'),
}) {
  for (const limitName of LIMITS)
    if (!isMoney(limits && limits[limitName]) || limits[limitName] === 0)
      throw new TypeError(`limits.${limitName} must be a number above 0`);
  const lockFile = `${file}.lock`;
  const append = (row) => {
    const ts = new Date(now()).toISOString();
    // A last line cut short (a crash or a full disk) would be glued to this row and turn two rows into one corrupt line
    // in the middle of the file. End it first and mark it, in the same write; the reader skips a fragment marked so.
    const fragmentEnd = endsMidLine(file)
      ? `\n${JSON.stringify({ type: TORN_ROW_TYPE, ts })}\n`
      : '';
    fs.appendFileSync(
      file,
      `${fragmentEnd}${JSON.stringify({ ts, run: runId, ...row })}\n`,
      { mode: 0o600 },
    );
  };
  const read = () => readLedger(file, { now });
  /**
   * The limit (max_usd, then total_cap_usd) that the ledger is past now, or null. Used after a call that cost more
   * than its reservation. It only reports: the row is already written, and a settle that threw here would hide the
   * call's own result. A ledger that cannot be read gives null; the next reserve reads it again and fails closed.
   */
  const limitPassedNow = () => {
    try {
      const ledgerState = read();
      const runTotals = ledgerState.runs.get(runId) || {
        spent: 0,
        reserved: 0,
      };
      return (
        checkLimits(limits, {
          runUsd: runTotals.spent + runTotals.reserved,
          totalUsd: ledgerState.total + ledgerState.reserved,
          callUsd: 0,
        })?.limit ?? null
      );
    } catch {
      return null;
    }
  };

  /**
   * Checks the limits and writes the reservation as one step. Throws SpendStopError when a limit or the lock refuses.
   * `callUsd` is the amount reserved, the call's p90 (reservationFor). The options name the call's `kind` and `model`
   * (written on both rows), its `meanUsd` (charged when the CLI reports no usable cost; `callUsd` when not given) and
   * `cliReportsLow` (charge at least the mean).
   */
  async function reserve(
    callUsd,
    label = '',
    {
      ttlMs = DEFAULT_TTL_MS,
      kind,
      model,
      meanUsd = callUsd,
      cliReportsLow = false,
    } = {},
  ) {
    if (!isMoney(callUsd))
      throw new TypeError(
        'reserve: the estimated cost must be a number, 0 or more',
      );
    if (!isMoney(meanUsd))
      throw new TypeError('reserve: the mean cost must be a number, 0 or more');
    const callFields = {
      ...(kind === undefined ? {} : { kind }),
      ...(model === undefined ? {} : { model }),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const id = newId();
    const shortLabel = String(label).slice(0, 120);
    await withLock(
      lockFile,
      {
        now,
        sleep,
        timeoutMs: lockTimeoutMs,
        staleMs: lockStaleMs,
      },
      (holdsLock) => {
        const ledgerState = read();
        const runTotals = ledgerState.runs.get(runId) || {
          spent: 0,
          reserved: 0,
        };
        const limitHit = checkLimits(limits, {
          runUsd: runTotals.spent + runTotals.reserved,
          totalUsd: ledgerState.total + ledgerState.reserved,
          callUsd,
        });
        if (limitHit) {
          const [projected, limit] = formatUsdPair(
            limitHit.projected_usd,
            limitHit.limit_usd,
          );
          throw new SpendStopError(
            `${shortLabel || 'call'} would take ${limitHit.limit === 'max_usd' ? 'this run' : 'the ledger'} to ${projected}, above ${limitHit.limit} ${limit} (${formatUsd(ledgerState.total)} spent, ${formatUsd(ledgerState.reserved)} reserved)`,
            limitHit.limit,
          );
        }
        append({
          type: 'reserve',
          id,
          label: shortLabel,
          usd: callUsd,
          expires: new Date(now() + ttlMs).toISOString(),
          ...callFields,
        });
        // The lock was broken as stale while this holder was paused, so another job may have checked the limits
        // without seeing this reservation. Take it back and refuse the call.
        if (!holdsLock()) {
          append({
            type: 'settle',
            id,
            label: shortLabel,
            usd: 0,
            status: 'cancelled',
            ...callFields,
          });
          throw new SpendStopError(
            `the ledger lock ${lockFile} was taken over while ${shortLabel || 'the call'} was being reserved; the reservation was cancelled and no paid call was started`,
            'lock',
          );
        }
      },
    );
    let isClosed = false;
    // Settling takes no lock: one short line appended in a single write. A reservation is settled once.
    const settleWith = (amount, extraFields) => {
      if (isClosed)
        throw new Error(`reservation ${id} was already settled or cancelled`);
      isClosed = true;
      append({
        type: 'settle',
        id,
        label: shortLabel,
        usd: amount,
        ...extraFields,
      });
    };
    return {
      id,
      usd: callUsd,
      meanUsd,
      cliReportsLow,
      ...callFields,
      /**
       * Replaces the reservation with the cost the CLI reported (`reportedUsd`). A call with no usable reported cost
       * is charged its mean and marked `cost_source: "estimate"`, or 0 with `cost_source: "none"` when it ended before
       * a model step started (`modelStarted: false`); a model whose CLI reports low is charged at least its mean
       * (settledCost). `model` defaults to the one the reservation named. Returns { usd, cost_source,
       * over_reservation_usd, limit_passed }: a call charged more than its reservation has `over_reservation_usd` on
       * its row too, and `limit_passed` names the limit the ledger is now past (null when none).
       */
      settle({
        model = callFields.model,
        usage,
        reportedUsd,
        ok = true,
        modelStarted = true,
      } = {}) {
        const tokens = usage
          ? Object.fromEntries(
              TOKEN_FIELDS.filter((field) => isMoney(usage[field])).map(
                (field) => [field, usage[field]],
              ),
            )
          : undefined;
        const charged = settledCost({
          reportedUsd,
          usage,
          reservedUsd: callUsd,
          meanUsd,
          cliReportsLow,
          modelStarted,
        });
        const overReservationUsd = charged.usd - callUsd;
        const isOver = overReservationUsd > EPS;
        settleWith(charged.usd, {
          status: ok ? 'ok' : 'failed',
          ...(kind === undefined ? {} : { kind }),
          model,
          tokens,
          cost_source: charged.cost_source,
          ...(isOver ? { over_reservation_usd: overReservationUsd } : {}),
        });
        return {
          usd: charged.usd,
          cost_source: charged.cost_source,
          over_reservation_usd: isOver ? overReservationUsd : 0,
          limit_passed: isOver ? limitPassedNow() : null,
        };
      },
      /** The call never started, so it cost nothing. */
      cancel: () => settleWith(0, { status: 'cancelled', ...callFields }),
    };
  }

  return { reserve, read, file };
}

module.exports = {
  LIMITS,
  LOCK_WAIT_MARGIN_MS,
  DEFAULT_TTL_MS,
  LedgerError,
  SpendStopError,
  settledCost,
  reservationFor,
  readLedger,
  readLedgerRows,
  checkLimits,
  createLedger,
};
