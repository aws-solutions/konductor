import unittest

from schedulerlib.retry import RetryFailure, RetryPolicy


class RetryTests(unittest.TestCase):
    def test_delay_sequence(self):
        policy = RetryPolicy(max_attempts=5, base_delay=2, multiplier=2, max_delay=100)
        self.assertEqual([policy.delay_for(n) for n in (1, 2, 3)], [2, 4, 8])

    def test_success_after_failures(self):
        attempts = []
        sleeps = []

        def operation():
            attempts.append(1)
            if len(attempts) < 3:
                raise ValueError("temporary")
            return "ok"

        result = RetryPolicy(max_attempts=4, base_delay=0.25).run(operation, sleeps.append)
        self.assertEqual(result, "ok")
        self.assertEqual(len(attempts), 3)
        self.assertEqual(sleeps, [0.25, 0.5])

    def test_failure_is_wrapped(self):
        with self.assertRaises(RetryFailure) as caught:
            RetryPolicy(max_attempts=2, base_delay=0).run(lambda: (_ for _ in ()).throw(RuntimeError("nope")), lambda _: None)
        self.assertIsInstance(caught.exception.__cause__, RuntimeError)

    def test_policy_validation(self):
        with self.assertRaises(ValueError):
            RetryPolicy(max_attempts=0)
        with self.assertRaises(ValueError):
            RetryPolicy(multiplier=0)
        with self.assertRaises(ValueError):
            RetryPolicy(base_delay=-1)

    def test_retry_boundary_helper(self):
        policy = RetryPolicy(max_attempts=3)
        self.assertTrue(policy.should_retry(1))
        self.assertFalse(policy.should_retry(3))
