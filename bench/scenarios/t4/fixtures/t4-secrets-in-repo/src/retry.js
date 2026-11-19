async function withRetries(operation, attempts) {
  let lastError;
  for (let index = 0; index <= attempts; index += 1) {
    try {
      return await operation(index);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

module.exports = { withRetries };
