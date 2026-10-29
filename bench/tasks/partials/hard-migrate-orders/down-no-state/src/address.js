'use strict';

function splitAddress(text) {
  if (typeof text !== 'string') throw new Error('invalid address');
  const parts = text.split(',').map((p) => p.trim());
  const tail = /^([A-Z]{2}) (\d{5}(?:-\d{4})?)$/.exec(parts.pop());
  const city = parts.pop();
  const street = parts.join(', ');
  if (!tail || !city || !street) throw new Error('invalid address');
  return { street, city, region: tail[1], postalCode: tail[2] };
}

module.exports = { splitAddress };
