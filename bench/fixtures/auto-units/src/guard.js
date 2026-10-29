'use strict';

// Shared argument checks; messages start with the helper name (see docs/STYLE.md).
function assertNumber(name, value) {
  if (typeof value !== 'number') throw new TypeError(`${name}: expected a number, got ${typeof value}`);
}

function assertFinite(name, value) {
  assertNumber(name, value);
  if (!Number.isFinite(value)) throw new RangeError(`${name}: input must be finite`);
}

module.exports = { assertNumber, assertFinite };
