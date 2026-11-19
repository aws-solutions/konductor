function validateBooking(value) {
  if (!value || typeof value !== 'object') throw new TypeError('booking must be an object');
  for (const key of ['id', 'room', 'start', 'end', 'name']) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new TypeError(`booking ${key} is required`);
    }
  }
  return value;
}

module.exports = { validateBooking };
