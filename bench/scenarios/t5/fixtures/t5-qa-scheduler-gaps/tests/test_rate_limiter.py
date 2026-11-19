import unittest

from schedulerlib.rate_limiter import SlidingWindowLimiter


class RateLimiterTests(unittest.TestCase):
    def test_limit_blocks_until_time_moves(self):
        limiter = SlidingWindowLimiter(2, 10)
        self.assertTrue(limiter.allow(now=100))
        self.assertTrue(limiter.allow(now=101))
        self.assertFalse(limiter.allow(now=102))
        self.assertTrue(limiter.allow(now=112))

    def test_keys_are_independent(self):
        limiter = SlidingWindowLimiter(1, 20)
        self.assertTrue(limiter.allow("a", now=1))
        self.assertFalse(limiter.allow("a", now=2))
        self.assertTrue(limiter.allow("b", now=2))

    def test_reset(self):
        limiter = SlidingWindowLimiter(1, 10)
        limiter.allow("a", now=1)
        limiter.reset("a")
        self.assertTrue(limiter.allow("a", now=2))
        limiter.reset()
        self.assertTrue(limiter.allow("a", now=3))

    def test_validation(self):
        with self.assertRaises(ValueError):
            SlidingWindowLimiter(0, 1)
        with self.assertRaises(ValueError):
            SlidingWindowLimiter(1, 0)
