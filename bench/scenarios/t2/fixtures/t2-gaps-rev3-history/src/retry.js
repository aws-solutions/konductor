export async function withRetry(operation, options = {}) {
  const attempts = options.attempts ?? 2;
  const delayMs = options.delayMs ?? 0;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts && delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
