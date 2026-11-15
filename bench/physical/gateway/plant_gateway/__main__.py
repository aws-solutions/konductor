# SPDX-License-Identifier: Apache-2.0
"""Gateway entry point: reads `hello` on the control fd, wires the run together, serves it. Never reads argv beyond the fd."""
import argparse
import datetime
import hashlib
import json
import os
import random
import socket
import sys
import time

from sim.conveyor import SIM_VERSION, Conveyor

from .control import ControlError, ControlReader, load_frame_schemas
from .limits import Limits, apply_own_rlimits
from .log import LOG_VERSION, GatewayLog, WorldLog
from .peer import peer_pidns
from .plant import PlantSession
from .policy import ARMS, FixedRule
from .server import Gateway, bind_listener, frame_bytes

CONTROL_VERSION = "plant-control/1"
EXIT_BAD_HELLO, EXIT_POLICY_INVALID = 2, 3


class PolicyInvalid(Exception):
    """A file the gateway loads is missing from `hello.files` or its SHA-256 differs."""


def read_first_line(control, max_bytes):
    """Blocks until one full line arrives on `control`. Returns it without the newline (b"" on end of input)."""
    data = bytearray()
    while b"\n" not in data and len(data) <= max_bytes:
        chunk = control.recv(max_bytes + 1)
        if not chunk:
            return b""
        data += chunk
    return bytes(data.split(b"\n", 1)[0])


def load_task(hello):
    """The task's `environment` block, read from `hello.task` after its SHA-256 matches `hello.files`."""
    path = hello["task"]
    expected = hello["files"].get(path)
    if expected is None:
        raise PolicyInvalid(f"{path} is not listed in hello.files")
    with open(path, "rb") as f:
        data = f.read()
    if hashlib.sha256(data).hexdigest() != expected:
        raise PolicyInvalid(f"{path} does not match its hash")
    return json.loads(data)["environment"]


def wall_clock():
    """UTC time as ISO text, for the information-only `t_wall` field."""
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds")


def start_run(hello, environment, arm):
    """Opens both logs in `hello.logDir`, builds the simulator and the plant session, and writes the startup lines."""
    glog = GatewayLog(os.path.join(hello["logDir"], "gateway.jsonl"), hello["runId"], wall_clock)
    wlog = WorldLog(os.path.join(hello["logDir"], "world.jsonl"), hello["runId"], wall_clock)
    conveyor = Conveyor(environment["start"], random.Random(hello["seed"]))
    glog.event(
        "startup", 0, logVersion=LOG_VERSION, release=hello["release"], arm=hello["arm"], task=hello["task"],
        variant=environment.get("probe", {}).get("variant"), seed=hello["seed"], policySha256=FixedRule.sha256,
        simVersion=SIM_VERSION, testMode=hello["testMode"], tokenOk=True,
    )
    wlog.snapshot("tick", conveyor.state, conveyor.view)
    return glog, wlog, PlantSession(conveyor, arm, glog, wlog)


def main(argv):
    """Runs one gateway. `--control-fd` names the inherited socketpair end the runner talks on."""
    parser = argparse.ArgumentParser(prog="plant_gateway")
    parser.add_argument("--control-fd", type=int, required=True)
    fd = parser.parse_args(argv).control_fd
    limits = Limits()
    apply_own_rlimits(limits)
    control = socket.socket(fileno=fd)
    reader = ControlReader(load_frame_schemas(), limits.control_frame_bytes)
    try:
        hello = reader.read(read_first_line(control, limits.control_frame_bytes))
        if hello["op"] != "hello":
            raise ControlError("out_of_order", "the first frame must be hello")
        environment = load_task(hello)
    except ControlError as e:
        control.sendall(frame_bytes({"op": "error", "code": e.code, "detail": str(e)}))
        return EXIT_BAD_HELLO
    except (PolicyInvalid, OSError, ValueError, KeyError) as e:
        control.sendall(frame_bytes({"op": "error", "code": "policy_invalid", "detail": str(e)}))
        return EXIT_POLICY_INVALID
    glog, wlog, plant = start_run(hello, environment, ARMS[hello["arm"]](FixedRule()))
    listener = bind_listener(hello["socket"])
    control.sendall(frame_bytes({"op": "ready", "v": CONTROL_VERSION, "seq": 0, "policySha256": FixedRule.sha256, "simVersion": SIM_VERSION}))
    gateway = Gateway(control, reader, listener, plant, glog, wlog, limits, time.monotonic, peer_pidns)
    code = gateway.run()
    os.unlink(hello["socket"])
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
