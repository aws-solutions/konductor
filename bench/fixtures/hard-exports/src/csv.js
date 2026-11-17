'use strict';

/** One CSV field: quoted when it holds a comma, a double quote or a line break, with inner quotes doubled. */
function csvField(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

module.exports = { csvField };
