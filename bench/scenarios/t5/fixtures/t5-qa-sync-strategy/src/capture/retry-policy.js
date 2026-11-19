function retryDelay(attempt, base = 50) { return Math.min(base * (2 ** (attempt - 1)), 5000); }
function shouldRetry(error) { return error && error.retryable === true; }
module.exports = { retryDelay, shouldRetry };
