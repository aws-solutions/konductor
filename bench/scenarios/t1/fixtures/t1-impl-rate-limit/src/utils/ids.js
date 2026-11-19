let sequence = 102;

function nextBookingId() {
  return `b-${sequence++}`;
}

module.exports = { nextBookingId };
