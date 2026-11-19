function counters() {
  const values = new Map();
  return { increment(name) { values.set(name, (values.get(name) || 0) + 1); }, get(name) { return values.get(name) || 0; } };
}
module.exports = { counters };
