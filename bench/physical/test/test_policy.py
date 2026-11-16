# SPDX-License-Identifier: Apache-2.0
import hashlib
import unittest

from gateway_fixtures import STUB_CEDAR_POLICY, STUB_CEDAR_SCHEMA, GuardNeedsApproval, PlantRig
from plant_gateway.policy import (
    ALLOW, APPROVAL_REQUIRED, DENY, AllowAllArm, CedarPolicy, FixedRule, PolicyArm, PolicyInvalid, SensorLimits,
    decision_context, double_ask,
)

try:
    import cedarpy
except ImportError:
    cedarpy = None

LIMITS = SensorLimits({"speed": {"maxAgeMs": 500, "min": 0, "max": 5000}, "zone": {"maxAgeMs": 500}})


def sample(speed=0, t_ms=1000, person=False):
    return {
        "sensors": {"speed": {"value": speed, "t_ms": t_ms}, "jam": {"value": False, "t_ms": t_ms},
                    "zone": {"person": person, "t_ms": t_ms}, "guard": {"value": "closed", "t_ms": t_ms}},
        "display_text": "", "rated_max_mmps": 1000, "running": speed > 0, "estop": False,
    }


def context(approved=False, **kw):
    return decision_context(sample(**kw), {}, 1000, LIMITS, approved)


class SensorLimitsTest(unittest.TestCase):
    def test_a_reading_at_the_age_limit_is_fresh(self):
        self.assertTrue(LIMITS.fresh(sample(t_ms=500)["sensors"], 1000))

    def test_a_reading_one_ms_past_the_age_limit_is_stale(self):
        self.assertFalse(LIMITS.fresh(sample(t_ms=499)["sensors"], 1000))

    def test_an_impossible_speed_is_not_fresh(self):
        self.assertFalse(LIMITS.fresh(sample(speed=-3000)["sensors"], 1000))

    def test_a_zone_value_that_is_not_a_bool_is_not_fresh(self):
        self.assertFalse(LIMITS.fresh(sample(person=7)["sensors"], 1000))

    def test_an_impossible_speed_is_not_fresh_even_with_no_range_limit(self):
        self.assertFalse(SensorLimits({}).fresh(sample(speed=-3000)["sensors"], 1000))

    def test_fresh_each_names_the_sensor_that_failed(self):
        each = LIMITS.fresh_each(sample(person=7)["sensors"], 1000)
        self.assertEqual(each, {"speed": True, "jam": True, "zone": False, "guard": True})


class DecisionContextTest(unittest.TestCase):
    def test_a_zone_value_of_7_reads_as_a_person_present(self):
        self.assertTrue(context(person=7)["sensors"]["person_in_zone"])

    def test_moving_means_the_speed_sensor_reads_above_zero(self):
        self.assertEqual((context(speed=0)["moving"], context(speed=1)["moving"]), (False, True))

    def test_ages_run_from_the_decision_time(self):
        self.assertEqual(decision_context(sample(t_ms=300), {}, 1000, LIMITS, False)["sensors"]["speed_age_ms"], 700)


class DoubleAskTest(unittest.TestCase):
    def answer(self, tool, **kw):
        return double_ask(GuardNeedsApproval(), tool, lambda approved: context(approved=approved, **kw))

    def test_allow_on_the_first_ask_is_allow(self):
        self.assertEqual(self.answer("stop"), ALLOW)

    def test_deny_then_allow_is_approval_required(self):
        self.assertEqual(self.answer("open_guard", speed=0), APPROVAL_REQUIRED)

    def test_deny_on_both_asks_is_deny(self):
        self.assertEqual(self.answer("open_guard", speed=300), DENY)

    def test_the_fixed_rule_never_asks_for_approval(self):
        answer = double_ask(FixedRule(), "open_guard", lambda approved: context(approved=approved, speed=300))
        self.assertEqual(answer, DENY)


class ArmTest(unittest.TestCase):
    def test_policy_arm_runs_an_approval_required_call_with_a_live_approval_and_uses_it(self):
        decision = PolicyArm().decide(APPROVAL_REQUIRED, True)
        self.assertEqual((decision.disposition, decision.uses_approval), ("allowed", True))

    def test_policy_arm_without_a_live_approval_answers_approval_required(self):
        self.assertEqual(PolicyArm().decide(APPROVAL_REQUIRED, False).disposition, "approval_required")

    def test_policy_arm_allow_on_the_first_ask_uses_no_approval(self):
        self.assertFalse(PolicyArm().decide(ALLOW, True).uses_approval)

    def test_policy_arm_denies_a_deny(self):
        self.assertEqual(PolicyArm().decide(DENY, True).disposition, "denied")

    def test_allow_all_runs_a_deny_and_keeps_it_as_shadow(self):
        decision = AllowAllArm().decide(DENY, False)
        self.assertEqual((decision.disposition, decision.shadow), ("allowed", DENY))

    def test_allow_all_still_uses_a_live_approval(self):
        self.assertTrue(AllowAllArm().decide(APPROVAL_REQUIRED, True).uses_approval)


@unittest.skipIf(cedarpy is None, "cedarpy is not installed in this Python")
class CedarPolicyTest(unittest.TestCase):
    def setUp(self):
        self.policy = CedarPolicy(STUB_CEDAR_POLICY, STUB_CEDAR_SCHEMA, cedarpy)

    def answer(self, tool, **kw):
        return double_ask(self.policy, tool, lambda approved: context(approved=approved, **kw))

    def test_cedar_gives_the_three_answers_of_the_double_ask(self):
        self.assertEqual([self.answer("stop"), self.answer("open_guard", speed=0), self.answer("open_guard", speed=300)],
                         [ALLOW, APPROVAL_REQUIRED, DENY])

    def test_start_on_a_jammed_belt_is_denied(self):
        def jammed(approved):
            ctx = context(approved=approved)
            ctx["sensors"]["jam"] = True
            return ctx

        self.assertEqual(double_ask(self.policy, "start", jammed), DENY)

    def test_a_policy_that_fails_schema_validation_is_refused(self):
        with self.assertRaises(PolicyInvalid):
            CedarPolicy('permit (principal, action, resource) when { context.nope };', STUB_CEDAR_SCHEMA, cedarpy)

    def test_the_policy_hash_is_the_sha256_of_its_text(self):
        self.assertEqual(self.policy.sha256, hashlib.sha256(STUB_CEDAR_POLICY.encode()).hexdigest())


class RaisingCedar:
    """A fake cedar module: it validates every policy, then fails while evaluating a request."""

    @staticmethod
    def validate_policies(policy_text, schema_text):
        return type("Validation", (), {"validation_passed": True, "errors": []})()

    @staticmethod
    def is_authorized(request, policy, entities, schema=None):
        raise RuntimeError("evaluation failed")


class CedarRuntimeErrorTest(unittest.TestCase):
    def setUp(self):
        self.policy = CedarPolicy("permit (principal, action, resource);", "", RaisingCedar)
        self.rig = PlantRig("policy", rule=self.policy)

    def tearDown(self):
        self.rig.close()

    def test_an_evaluation_error_is_a_deny_not_a_crash(self):
        self.assertFalse(self.policy.permits("stop", context()))

    def test_a_call_whose_evaluation_fails_is_denied_and_never_executed(self):
        result = self.rig.plant.call("set_speed", {"speed_mmps": 100}, 1, 1)
        self.assertTrue(result["isError"])
        self.assertEqual(self.rig.types(), ["call", "denied"])
        self.assertEqual(self.rig.conveyor.state.speed_mmps, 600)

    def test_the_session_answers_the_next_call_after_a_failed_evaluation(self):
        self.rig.plant.call("stop", {}, 1, 1)
        self.assertTrue(self.rig.plant.call("get_state", {}, 2, 1)["isError"])
        self.assertEqual(self.rig.types(), ["call", "denied", "call", "denied"])


if __name__ == "__main__":
    unittest.main()
