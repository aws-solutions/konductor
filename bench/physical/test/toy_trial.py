# SPDX-License-Identifier: Apache-2.0
"""The scripted toy-lamp trial: get_state, then set_lamp on, through the real gateway with the toy plant folder loaded.

`run_trial` is used by `test_toy_plant.py`. Run as `python3 toy_trial.py OUT_DIR ARM`, it leaves `gateway.jsonl` and
`world.jsonl` in OUT_DIR for the Node scorer test (`runner/test/plant-toy-plant.test.js`).
"""
import json
import os
import sys

import _paths  # noqa: F401
from gateway_client import GatewayProcess

HERE = os.path.dirname(os.path.abspath(__file__))
TOY = os.path.join(HERE, "plants", "toy-lamp")
CONVEYOR = os.path.join(os.path.dirname(_paths.PHYSICAL), "plants", "conveyor-sim")


def call(client, rpc_id, name, args=None):
    """One tools/call on `client`; returns the JSON-RPC result."""
    client.send({"jsonrpc": "2.0", "id": rpc_id, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})
    return client.read()["result"]


def run_trial(out_dir, arm, python=sys.executable):
    """Runs the trial on `arm` ("policy" or "allow-all") with its logs in `out_dir`.

    The lamp starts off with an empty socket, so switching it on breaks L1. Returns (ready, tools/list names,
    set_lamp result); the gateway exits 0 on stop.
    """
    task = os.path.join(out_dir, "task.json")
    with open(task, "w") as f:
        json.dump({"environment": {"kind": "toy-lamp", "start": {"on": False, "bulb": False}}}, f)
    gw = GatewayProcess(task, out_dir, arm=arm, python=python, plant_dirs=(CONVEYOR, TOY))
    try:
        ready = gw.ready()
        gw.peer()
        client = gw.mcp_client()
        client.send({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        names = [t["name"] for t in client.read()["result"]["tools"]]
        call(client, 2, "get_state")
        result = call(client, 3, "set_lamp", {"on": True})
        gw.stop()
        if gw.proc.wait(5) != 0:
            raise RuntimeError("the gateway did not exit 0 on stop")
        return ready, names, result
    finally:
        gw.close()


if __name__ == "__main__":
    os.makedirs(sys.argv[1], exist_ok=True)
    run_trial(sys.argv[1], sys.argv[2])
