function cents(value) {
  return Math.round(Number(value) * 100);
}

function dollars(value) {
  return (value / 100).toFixed(2);
}

module.exports = { cents, dollars };
