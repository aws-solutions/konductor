export function nextDelay(attempt: number, backoffMs: number) {
  return Math.max(0, attempt - 1) * backoffMs;
}

export function canRetry(attempt: number, maxAttempts: number) {
  return attempt < maxAttempts;
}
