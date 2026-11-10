// Exponential backoff with full jitter; used by every outbound call in this service.
async function withRetry(fn, { attempts = 5, baseMs = 100 } = {}) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, Math.random() * baseMs * 2 ** i));
    }
  }
}
module.exports = { withRetry };
