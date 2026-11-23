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

from sim.faults import FaultError

from .approval import ApprovalBook
from .control import ControlError, ControlReader, load_frame_schemas
from .limits import Limits, apply_own_rlimits
from .kinds import KINDS
from .log import LOG_VERSION, GatewayLog, WorldLog
from .peer import peer_pidns, pidns_ancestors
from .plant import PlantSession
from .policy import ARMS, CedarPolicy, PolicyInvalid, SensorLimits
from .server import Gateway, bind_listener, frame_bytes

CONTROL_VERSION = "plant-control/1"
EXIT_BAD_HELLO, EXIT_POLICY_INVALID = 2, 3
ENV_VERSION = 1


POLICY_FILE, SCHEMA_FILE, LIMITS_FILE = "plant.cedar", "plant.cedarschema", "sensor-limits.json"


def read_first_line(control, max_bytes):
    """Blocks until one full line arrives on `control`. Returns it without the newline (b"" on end of input)."""
    data = bytearray()
    while b"\n" not in data and len(data) <= max_bytes:
        chunk = control.recv(max_bytes + 1)
        if not chunk:
            return b""
        data += chunk
    return bytes(data.split(b"\n", 1)[0])


def read_listed(hello, path):
    """The bytes of `path` after its SHA-256 matches `hello.files`. Raises PolicyInvalid otherwise."""
    expected = hello["files"].get(path)
    if expected is None:
        raise PolicyInvalid(f"{path} is not listed in hello.files")
    with open(path, "rb") as f:
        data = f.read()
    if hashlib.sha256(data).hexdigest() != expected:
        raise PolicyInvalid(f"{path} does not match its hash")
    return data


def listed_by_name(hello, name):
    """The path in `hello.files` whose file name is `name`, or None."""
    return next((p for p in hello["files"] if os.path.basename(p) == name), None)


def load_rule(hello, kind):
    """`(rule, SensorLimits)` for the run: the Cedar policy when hello lists `plant.cedar`, else the fixed rule.

    A Cedar policy needs its schema and sensor limits listed too; each file is hash-checked before use, and the
    limits must hold what `kind` needs. Only a kind with a `fixed_rule` runs without a Cedar policy.
    """
    policy_path = listed_by_name(hello, POLICY_FILE)
    if policy_path is None:
        if kind.fixed_rule is None:
            raise PolicyInvalid(f"the {kind.name} plant needs {POLICY_FILE} in hello.files")
        return kind.fixed_rule(), SensorLimits({})
    schema_path, limits_path = listed_by_name(hello, SCHEMA_FILE), listed_by_name(hello, LIMITS_FILE)
    if schema_path is None or limits_path is None:
        raise PolicyInvalid(f"{POLICY_FILE} needs {SCHEMA_FILE} and {LIMITS_FILE} in hello.files")
    policy, schema, limits = (read_listed(hello, p) for p in (policy_path, schema_path, limits_path))
    import cedarpy

    sensor_limits = SensorLimits(json.loads(limits))
    kind.check_limits(sensor_limits)
    return CedarPolicy(policy.decode(), schema.decode(), cedarpy), sensor_limits


def read_environment(task_bytes):
    """The task's `environment` block. Raises PolicyInvalid on an `envVersion` this gateway does not know (8.7)."""
    environment = json.loads(task_bytes)["environment"]
    version = environment.get("envVersion", ENV_VERSION)
    if version != ENV_VERSION:
        raise PolicyInvalid(f"environment envVersion {version} is unknown; this gateway reads {ENV_VERSION}")
    return environment


def wall_clock():
    """UTC time as ISO text, for the information-only `t_wall` field."""
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds")


def plant_kind(environment):
    """The PlantKind the task's `environment.kind` names (default "conveyor-sim"). Raises PolicyInvalid on an unknown name."""
    name = environment.get("kind", "conveyor-sim")
    if name not in KINDS:
        raise PolicyInvalid(f"environment kind {name!r} is unknown; this gateway runs {sorted(KINDS)}")
    return KINDS[name]


def build_sim(hello, environment, kind):
    """The run's simulator: the task's start state and faults, noise seeded by `hello.seed`. Raises FaultError."""
    return kind.build(environment, random.Random(hello["seed"]))


def start_run(hello, environment, kind, sim, rule, sensor_limits):
    """Opens both logs in `hello.logDir`, builds the plant session of `kind` on `sim` for `rule` and `sensor_limits`,
    and writes the startup lines and the faults present at the start."""
    glog = GatewayLog(os.path.join(hello["logDir"], "gateway.jsonl"), hello["runId"], wall_clock)
    wlog = WorldLog(os.path.join(hello["logDir"], "world.jsonl"), hello["runId"], wall_clock)
    glog.event(
        "startup", 0, logVersion=LOG_VERSION, plant=kind.name, release=hello["release"], arm=hello["arm"], task=hello["task"],
        variant=environment.get("probe", {}).get("variant"), seed=hello["seed"], policySha256=rule.sha256,
        simVersion=kind.sim_version, testMode=hello["testMode"], tokenOk=True,
    )
    wlog.snapshot("tick", sim.state, sim.view, sim.drain_poses())
    approvals = ApprovalBook(environment.get("operator", {}))
    plant = PlantSession(sim, rule, ARMS[hello["arm"]](), approvals, sensor_limits, glog, wlog, kind)
    plant.log_start_faults()
    return glog, wlog, plant


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
        environment = read_environment(read_listed(hello, hello["task"]))
        kind = plant_kind(environment)
        sim = build_sim(hello, environment, kind)
        rule, sensor_limits = load_rule(hello, kind)
    except ControlError as e:
        control.sendall(frame_bytes({"op": "error", "code": e.code, "detail": str(e)}))
        return EXIT_BAD_HELLO
    except (PolicyInvalid, FaultError, ImportError, OSError, ValueError, KeyError) as e:
        control.sendall(frame_bytes({"op": "error", "code": "policy_invalid", "detail": str(e)}))
        return EXIT_POLICY_INVALID
    glog, wlog, plant = start_run(hello, environment, kind, sim, rule, sensor_limits)
    listener = bind_listener(hello["socket"])
    control.sendall(frame_bytes({"op": "ready", "v": CONTROL_VERSION, "seq": 0, "policySha256": rule.sha256, "simVersion": kind.sim_version}))
    gateway = Gateway(control, reader, listener, plant, glog, wlog, limits, time.monotonic, peer_pidns, pidns_ancestors)
    code = gateway.run()
    os.unlink(hello["socket"])
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
