# SPDX-License-Identifier: Apache-2.0
import unittest

try:
    import cedarpy
except ImportError:
    cedarpy = None

STUB_SCHEMA = """namespace Stub { entity Agent; entity Line;
  type Ctx = { moving: Bool, approved: Bool };
  action "open_guard" appliesTo { principal: Agent, resource: Line, context: Ctx }; }"""
STUB_POLICY = 'permit (principal, action == Stub::Action::"open_guard", resource) when { !context.moving && context.approved };'


def ask(moving, approved):
    request = {
        "principal": 'Stub::Agent::"run"', "action": 'Stub::Action::"open_guard"', "resource": 'Stub::Line::"line1"',
        "context": {"moving": moving, "approved": approved},
    }
    return cedarpy.is_authorized(request, STUB_POLICY, [], schema=STUB_SCHEMA).allowed


@unittest.skipIf(cedarpy is None, "cedarpy is not installed in this Python")
class CedarSpikeTest(unittest.TestCase):
    def test_a_valid_policy_passes_schema_validation(self):
        self.assertTrue(cedarpy.validate_policies(STUB_POLICY, STUB_SCHEMA).validation_passed)

    def test_a_policy_reading_an_unknown_context_field_fails_validation(self):
        bad = 'permit (principal, action == Stub::Action::"open_guard", resource) when { context.nope };'
        self.assertFalse(cedarpy.validate_policies(bad, STUB_SCHEMA).validation_passed)

    def test_the_double_ask_shape_denies_then_allows_on_a_stopped_belt(self):
        self.assertEqual((ask(False, False), ask(False, True)), (False, True))

    def test_both_asks_deny_while_moving(self):
        self.assertEqual((ask(True, False), ask(True, True)), (False, False))


if __name__ == "__main__":
    unittest.main()
