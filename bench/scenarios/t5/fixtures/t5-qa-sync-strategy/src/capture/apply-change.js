async function applyChange(change, target, { attempts = 3, wait = async () => {} } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await target.apply(change);
      return { applied: true, attempts: attempt };
    } catch (error) {
      lastError = error;
      await wait(attempt);
    }
  }
  throw lastError;
}

module.exports = { applyChange };
