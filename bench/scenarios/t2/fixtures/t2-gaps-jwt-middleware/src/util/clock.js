function epochSeconds(now = Date.now()) { return Math.floor(now / 1000); }
function isAfter(left, right) { return left > right; }
module.exports = { epochSeconds, isAfter };
