async function withRetries(operation, options = {}) {
  const attempts = options.attempts || 3;
  const wait = options.wait || (async () => {});
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(attempt);
    }
  }
  throw lastError;
}

module.exports = { withRetries };
