# SPDX-License-Identifier: Apache-2.0
"""The peer check (SR-4): the nested pid namespace walk with an injected kernel, and how the gateway treats each peer."""
import json
import os
import socket
import subprocess
import tempfile
import time
import unittest

from gateway_fixtures import PlantRig
from plant_gateway.control import ControlReader, load_frame_schemas
from plant_gateway.limits import Limits
from plant_gateway.peer import MAX_NS_DEPTH, pidns_ancestors
from plant_gateway.server import Gateway, bind_listener


class FakeKernel:
    """A tree of pid namespaces: `parents` maps a namespace name to its parent's name. `pids` maps a pid to its namespace."""

    def __init__(self, parents, pids):
        self.parents = parents
        self.pids = pids
        self.open_fds = {}
        self._next = 100

    def _new(self, name):
        self._next += 1
        self.open_fds[self._next] = name
        return self._next

    def open_pidns(self, pid):
        if pid not in self.pids:
            raise FileNotFoundError(pid)
        return self._new(self.pids[pid])

    def parent(self, fd):
        parent = self.parents.get(self.open_fds[fd])
        if parent is None:
            raise PermissionError("not a descendant of the caller's namespace")
        return self._new(parent)

    def name(self, fd):
        return self.open_fds[fd]

    def close(self, fd):
        del self.open_fds[fd]


NESTED = FakeKernel(
    parents={"pid:[3]": "pid:[2]", "pid:[2]": "pid:[1]"},
    pids={10: "pid:[3]", 11: "pid:[2]", 12: "pid:[1]"},
)


class AncestorWalkTest(unittest.TestCase):
    def test_a_peer_two_levels_down_lists_both_namespaces_above_it_nearest_first(self):
        self.assertEqual(pidns_ancestors(10, NESTED), ["pid:[2]", "pid:[1]"])

    def test_a_peer_in_a_top_level_namespace_has_no_ancestors(self):
        self.assertEqual(pidns_ancestors(12, NESTED), [])

    def test_a_pid_that_is_gone_has_no_ancestors(self):
        self.assertEqual(pidns_ancestors(99, NESTED), [])

    def test_every_descriptor_the_walk_opened_is_closed_again(self):
        pidns_ancestors(10, NESTED)
        self.assertEqual(NESTED.open_fds, {})

    def test_a_walk_that_never_reaches_the_top_stops_at_the_kernel_depth_limit(self):
        loop = FakeKernel(parents={"a": "a"}, pids={1: "a"})
        self.assertEqual(len(pidns_ancestors(1, loop)), MAX_NS_DEPTH)


USERNS_BLOCKED = subprocess.run(["unshare", "--user", "--map-root-user", "true"], capture_output=True).returncode != 0


class RealKernelTest(unittest.TestCase):
    def test_this_process_is_not_below_the_caller_so_the_real_walk_finds_no_ancestors(self):
        self.assertEqual(pidns_ancestors(os.getpid()), [])

    @unittest.skipIf(USERNS_BLOCKED, "user namespaces are blocked on this host (unshare --user fails), so no nested pid namespace can be made")
    def test_a_process_in_a_new_pid_namespace_has_this_namespace_as_its_ancestor(self):
        child = subprocess.Popen(["unshare", "--user", "--map-root-user", "--pid", "--fork", "sleep", "5"])
        self.addCleanup(child.kill)
        inner = None
        for _ in range(100):
            kids = subprocess.run(["pgrep", "-P", str(child.pid)], capture_output=True, text=True).stdout.split()
            if kids:
                inner = int(kids[0])
                break
            time.sleep(0.05)
        self.assertEqual(pidns_ancestors(inner), [os.readlink("/proc/self/ns/pid")])


# Namespaces above each fake peer pid; pid 21 sits in pid:[3], two levels under the top.
NESTED_ANCESTORS = {21: ["pid:[2]", "pid:[1]"], 23: [], 22: ["pid:[8]"]}


class GatewayPeerTest(unittest.TestCase):
    """A Gateway on a real listener whose peers are named by fakes, so each kind of peer can be made here."""

    SANDBOX = "pid:[2]"

    def setUp(self):
        self.rig = PlantRig()
        self.sockdir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.sockdir.name, "gw.sock")
        self.control, self.runner_end = socket.socketpair()
        self.peers = {}
        self.gateway = Gateway(
            self.control, ControlReader(load_frame_schemas(), 16384), bind_listener(self.path), self.rig.plant,
            self.rig.glog, self.rig.wlog, Limits(), lambda: 0.0, lambda sock: self.peers["next"],
            lambda pid: NESTED_ANCESTORS.get(pid, ()),
        )
        self.gateway._accept_peer(self.SANDBOX)

    def tearDown(self):
        self.control.close()
        self.runner_end.close()
        self.rig.close()
        self.sockdir.cleanup()

    def connect_as(self, pid, pidns):
        self.peers["next"] = (pid, pidns)
        client = socket.socket(socket.AF_UNIX)
        client.connect(self.path)
        self.addCleanup(client.close)
        self.gateway.step(0.2)
        return client

    def closed(self, client):
        client.settimeout(1.0)
        return client.recv(1) == b""

    def logged(self, type_):
        return [e for e in self.rig.events() if e["type"] == type_]

    def heartbeats_sent(self):
        """The `hb` frames the gateway has put on the control socket so far."""
        self.runner_end.settimeout(0.2)
        try:
            data = self.runner_end.recv(65536)
        except socket.timeout:
            return []
        return [json.loads(line) for line in data.splitlines()]

    def test_a_peer_in_the_sandbox_namespace_is_served(self):
        client = self.connect_as(20, self.SANDBOX)
        self.assertEqual(self.logged("limit") + self.logged("foreign_conn"), [])
        client.close()

    def test_a_peer_in_a_namespace_nested_inside_the_sandbox_is_closed_and_logged_as_a_limit_that_ends_the_trial(self):
        client = self.connect_as(21, "pid:[3]")
        self.assertTrue(self.closed(client))
        self.assertEqual([e["which"] for e in self.logged("limit")], ["nested_pidns"])
        self.assertEqual(self.gateway.limit_hit, "nested_pidns")
        self.assertEqual(self.logged("foreign_conn"), [])

    def test_a_nested_peer_is_reported_in_a_heartbeat_at_once_not_at_the_next_tick(self):
        self.connect_as(21, "pid:[3]")
        hb = self.heartbeats_sent()[-1]
        self.assertEqual((hb["op"], hb["limitHit"], hb["foreignConn"]), ("hb", "nested_pidns", False))

    def test_a_foreign_peer_is_reported_in_a_heartbeat_at_once_and_it_stays_reported(self):
        self.connect_as(22, "pid:[9]")
        hb = self.heartbeats_sent()[-1]
        self.assertEqual((hb["limitHit"], hb["foreignConn"]), (None, True))

    def test_a_peer_from_outside_the_sandbox_is_closed_as_foreign_and_is_not_a_limit(self):
        client = self.connect_as(22, "pid:[9]")
        self.assertTrue(self.closed(client))
        self.assertEqual(len(self.logged("foreign_conn")), 1)
        self.assertEqual((self.logged("limit"), self.gateway.limit_hit), ([], None))

    def test_a_peer_whose_namespace_is_above_the_sandbox_is_foreign_not_nested(self):
        client = self.connect_as(23, "pid:[1]")
        self.assertTrue(self.closed(client))
        self.assertEqual(len(self.logged("foreign_conn")), 1)

    def test_a_peer_whose_pid_is_gone_is_foreign(self):
        client = self.connect_as(24, None)
        self.assertTrue(self.closed(client))
        self.assertEqual(len(self.logged("foreign_conn")), 1)


if __name__ == "__main__":
    unittest.main()
