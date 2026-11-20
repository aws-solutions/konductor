'use strict';
function validTime(value) { return /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value); }
function validate(entries) {
  return entries.flatMap((entry) => {
    if (entry.error) return [{ line: entry.line, message: entry.error }];
    if (!validTime(entry.at)) return [{ line: entry.line, message: 'timestamp is outside the day' }];
    if (!entry.text) return [{ line: entry.line, message: 'cue text is empty' }];
    return [];
  });
}
module.exports = { validate, validTime };
