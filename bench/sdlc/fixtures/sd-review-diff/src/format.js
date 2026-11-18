'use strict';

/** True for null, undefined and strings of spaces only. `== null` is meant: it covers null and undefined together. */
function isBlank(value) {
  if (value == null) return true;
  return String(value).trim() === '';
}

module.exports = { isBlank };
