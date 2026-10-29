'use strict';

// Fixed windows aligned to the clock: each key gets `limit` requests per window.
function createRateLimiter({ clock, limit = 100, windowMs = 60000 }) {
  const buckets = new Map();
  return {
    check(key) {
      const now = clock.now();
      const start = now - (now % windowMs);
      let bucket = buckets.get(key);
      if (!bucket || bucket.start !== start) {
        bucket = { start, count: 0 };
        buckets.set(key, bucket);
      }
      if (bucket.count >= limit) {
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((start + windowMs - now) / 1000)) };
      }
      bucket.count += 1;
      return { allowed: true, retryAfterSec: 0 };
    },
  };
}

module.exports = { createRateLimiter };
