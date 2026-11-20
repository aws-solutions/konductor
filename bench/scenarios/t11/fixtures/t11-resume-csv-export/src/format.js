'use strict';

function pad(value) {
  return String(value).padStart(2, '0');
}

function displayMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? hours + 'h ' + pad(remainder) + 'm' : remainder + 'm';
}

module.exports = { displayMinutes };
