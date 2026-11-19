function createMetrics() {
  const values = { completed: 0, failed: 0 };
  return {
    increment(name) { values[name] = (values[name] || 0) + 1; },
    snapshot() { return { ...values }; }
  };
}

module.exports = { createMetrics };
