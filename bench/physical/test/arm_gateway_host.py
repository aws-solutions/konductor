# SPDX-License-Identifier: Apache-2.0
"""Hosts one real arm gateway for a Node test: prints `{"socket": ...}`, waits for a line on stdin, stops the gateway
(which settles) and prints `{"events": [...], "world": [...]}`. Usage: arm_gateway_host.py RUN_DIR ARM ENVIRONMENT_JSON,
where the environment is a task `environment` block of kind arm-sim."""
import json
import os
import sys

import _paths  # noqa: F401
from arm_release_stub import write_arm_release
from gateway_client import GatewayProcess
from gateway_fixtures import read_jsonl

RELEASE_FILES = ("policy/plant.cedar", "policy/plant.cedarschema", "sensor-limits.json")


def main(run_dir, arm, environment):
    task = os.path.join(run_dir, "task.json")
    with open(task, "w", encoding="utf-8") as f:
        json.dump({"environment": json.loads(environment)}, f)
    release = write_arm_release(os.path.join(run_dir, "release"))
    gateway = GatewayProcess(task, run_dir, files=[os.path.join(release, p) for p in RELEASE_FILES], arm=arm, python=sys.executable)
    try:
        gateway.ready()
        gateway.peer()
        print(json.dumps({"socket": gateway.socket_path}), flush=True)
        sys.stdin.readline()
        gateway.stop()
    finally:
        gateway.close()
    print(json.dumps({"events": read_jsonl(os.path.join(run_dir, "gateway.jsonl")), "world": read_jsonl(os.path.join(run_dir, "world.jsonl"))}), flush=True)


if __name__ == "__main__":
    main(*sys.argv[1:4])
