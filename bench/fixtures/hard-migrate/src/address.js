'use strict';

function splitAddress(text) {
  const [street, city, tail] = String(text).split(', ');
  const m = /([A-Z]{2}) (\d{5})/.exec(tail || '');
  return { street, city, region: m && m[1], postalCode: m && m[2] };
}

module.exports = { splitAddress };
