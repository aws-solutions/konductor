# SPDX-License-Identifier: Apache-2.0
"""Gateway-only truth-table run (7.8): every row decided by a test-mode gateway, no model. A policy test only, never a result."""
import argparse
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gateway_client import GatewayProcess  # noqa: E402

RELEASE_FILES = ("policy/plant.cedar", "policy/plant.cedarschema", "sensor-limits.json")
TRUTH_TABLE = "truth-table.json"
CONVEYOR_ENVIRONMENT = {"start": {"rated_max_mmps": 1000}, "operator": {}}
TEST_OPS = {"conveyor": "set_state", "arm": "set_arm_state"}
BAD_TOKEN = "f" * 64


def classify(reply):
    """The truth-table answer for one `tools/call` reply: allow, approval_required, deny or bad_arguments."""
    result = reply["result"]
    if not result["isError"]:
        return "allow"
    text = result["content"][0]["text"]
    for prefix, answer in (("approval required", "approval_required"), ("denied", "deny"), ("bad arguments", "bad_arguments")):
        if text.startswith(prefix):
            return answer
    return "unknown"


def run_row(gateway, client, number, row, test_op):
    """Sets the row's state with control frame `test_op`, makes its call, and returns `(passed, line)` for row `number`."""
    gateway.set_state(row["state"], row["sensors"], row["now_ms"], row["approval"], op=test_op)
    gateway.control.read_op("state_set", "error")
    client.send({"jsonrpc": "2.0", "id": number, "method": "tools/call", "params": {"name": row["action"], "arguments": row["args"]}})
    got = classify(client.read())
    passed = got == row["expect"]
    return passed, f"{'PASS' if passed else 'FAIL'} row {number}: {row['action']} {json.dumps(row['args'])} approval={row['approval']} expect={row['expect']} got={got} ({row['why']})"


def wrong_token_is_refused(gateway, row, test_op):
    """True when a test-state frame `test_op` with a wrong token gets `bad_token`."""
    gateway.set_state(row["state"], row["sensors"], row["now_ms"], row["approval"], token=BAD_TOKEN, op=test_op)
    return gateway.control.read_op("state_set", "error").get("code") == "bad_token"


def run(release, python):
    """Runs every row of `release`/truth-table.json against a gateway started with `python`. Returns `(ok, lines)`.

    The table may name its `environment` (an arm table carries `plant: "arm"`); the default is the conveyor's.
    """
    with open(os.path.join(release, TRUTH_TABLE), encoding="utf-8") as f:
        table = json.load(f)
    rows = table["rows"]
    environment = table.get("environment", CONVEYOR_ENVIRONMENT)
    test_op = TEST_OPS[environment.get("plant", "conveyor")]
    with tempfile.TemporaryDirectory(prefix="tt") as run_dir:
        task = os.path.join(run_dir, "task.json")
        with open(task, "w", encoding="utf-8") as f:
            json.dump({"environment": environment}, f)
        gateway = GatewayProcess(task, run_dir, files=[os.path.join(release, p) for p in RELEASE_FILES], test_mode=True, python=python)
        try:
            ready = gateway.ready()
            if ready["op"] == "error":
                return False, [f"FAIL gateway refused the release: {ready['code']} {ready['detail']}"]
            gateway.peer()
            client = gateway.mcp_client()
            results = [run_row(gateway, client, n, row, test_op) for n, row in enumerate(rows, 1)]
            token_ok = wrong_token_is_refused(gateway, rows[0], test_op)
            results.append((token_ok, f"{'PASS' if token_ok else 'FAIL'} wrong token: the test-state frame is refused with bad_token"))
            gateway.stop()
        finally:
            gateway.close()
    failed = sum(not ok for ok, _ in results)
    lines = [line for _, line in results] + [f"{len(results) - failed} of {len(results)} cells pass. This is a policy test only."]
    return failed == 0, lines


def main(argv):
    """`--release DIR` names the unpacked release; `--python` is the interpreter with cedarpy for the gateway."""
    parser = argparse.ArgumentParser(prog="truth_table_run")
    parser.add_argument("--release", required=True)
    parser.add_argument("--python", default=sys.executable)
    args = parser.parse_args(argv)
    ok, lines = run(os.path.abspath(args.release), args.python)
    print("\n".join(lines))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
