function compareTimestamps(left, right) {
  const a = new Date(left).getTime();
  const b = new Date(right).getTime();
  return a === b ? 0 : (a > b ? 1 : -1);
}
module.exports = { compareTimestamps };
