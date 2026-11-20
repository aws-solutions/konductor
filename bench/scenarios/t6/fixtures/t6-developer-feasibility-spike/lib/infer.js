'use strict';

/**
 * Column type inference for the import preview.
 *
 * classify(raw) says what one cell looks like:
 *   'empty'    nothing but whitespace
 *   'integer'  optional minus, digits, no leading zeros ("0" is fine, "007" is not)
 *   'decimal'  integer part as above, a point, at least one digit
 *   'date'     YYYY-MM-DD and a real calendar day
 *   'text'     everything else
 *
 * A column's type is decided from all the non-empty cells seen so far:
 *   - no non-empty cell yet        -> 'text'
 *   - any text cell                -> 'text'
 *   - dates mixed with numbers     -> 'text'
 *   - only dates                   -> 'date'
 *   - integers and decimals mixed  -> 'decimal'
 *   - only decimals                -> 'decimal'
 *   - only integers                -> 'integer'
 */

const INTEGER = /^-?(0|[1-9]\d*)$/;
const DECIMAL = /^-?(0|[1-9]\d*)\.\d+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(y, m, d) {
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function classify(raw) {
  const v = String(raw ?? '').trim();
  if (v === '') return 'empty';
  if (INTEGER.test(v)) return 'integer';
  if (DECIMAL.test(v)) return 'decimal';
  const m = DATE.exec(v);
  if (m && isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) return 'date';
  return 'text';
}

/** Incremental inferrer for one column: add() cells in file order, type() at any point. */
function createInferrer() {
  const seen = { integer: false, decimal: false, date: false, text: false };
  let count = 0;
  return {
    add(raw) {
      const k = classify(raw);
      if (k === 'empty') return;
      seen[k] = true;
      count += 1;
    },
    type() {
      if (count === 0 || seen.text) return 'text';
      const numeric = seen.integer || seen.decimal;
      if (seen.date) return numeric ? 'text' : 'date';
      return seen.decimal ? 'decimal' : 'integer';
    },
    get count() { return count; },
  };
}

/** Type of a list of cells, as if they were added in order. */
function inferType(values) {
  const inf = createInferrer();
  for (const v of values) inf.add(v);
  return inf.type();
}

module.exports = { classify, createInferrer, inferType };
