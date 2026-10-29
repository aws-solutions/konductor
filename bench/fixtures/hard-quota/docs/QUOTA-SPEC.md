# Quota service

Status: approved. The service lives in `src/quota.js` and `createQuotaService` is exported from
`src/index.js`.

## Plans

Request limits per window. A dash means unlimited. `config/plans.json` holds exactly these numbers.

| plan     | minute | day  | month  |
|----------|--------|------|--------|
| free     | 10     | 200  | 3000   |
| pro      | 100    | 5000 | 100000 |
| internal | -      | -    | -      |

## Windows

Windows are calendar windows in UTC. A minute starts at hh:mm:00.000, a day at 00:00:00.000 and a
month at 00:00:00.000 on the 1st. An instant exactly on a boundary belongs to the new window, which
starts with no usage.

## createQuotaService(options)

- `clock`: object with `now()` returning epoch milliseconds. Defaults to the system clock.
- `plans`: object shaped like `config/plans.json`. Defaults to that file. A window left out of a plan
  is unlimited.

## service.consume(key, options)

Options: `plan` (required), `cost` (default 1), `requestId` (optional string).

Returns `{ allowed, remaining: { minute, day, month }, limitedBy, retryAfterSec }`.

- A request is allowed only when every limited window has room for the cost. When allowed, every
  window is charged the cost. When denied, no window is charged.
- `remaining` is measured after the decision (for a denied request it is the current remaining). An
  unlimited window reports `null`.
- `limitedBy` is `null` when allowed. When denied it names the window with the longest wait; on a tie
  it names the larger window (month, then day, then minute).
- `retryAfterSec` is `null` when allowed. When denied it is the number of whole seconds, rounded up,
  until the limiting window resets (never less than 1). A cost larger than a window's limit can never
  fit, so that window waits forever: it has the longest wait and `retryAfterSec` is `null`.
- Counters belong to the key, not to the plan. Different keys never share counters.
- A key is a string. Surrounding whitespace is ignored and keys are compared after Unicode NFC
  normalization. A key that is empty after trimming, or not a string, throws `TypeError`.
- An unknown plan throws `RangeError` and the message contains the plan name. A cost that is not a
  positive integer throws `RangeError`.
- Repeating a call with the same key and `requestId` less than 600 seconds after the first allowed
  call returns the first result unchanged and charges nothing. At 600 seconds or later it is a new
  request. Denied results are not remembered.
