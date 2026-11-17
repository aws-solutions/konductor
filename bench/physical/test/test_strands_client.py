# SPDX-License-Identifier: Apache-2.0
"""The kind-B forwarder's gateway client (physical/strands/plant_strands/client.py). Standard library only: no Strands."""
import json
import os
import socket
import sys
import threading
import unittest

import _paths  # noqa: F401
from test_gateway_process import GatewayRun

sys.path.insert(0, os.path.join(_paths.PHYSICAL, "strands"))
from plant_strands.client import CLIENT_INFO, LOST, LOST_CODE, GatewayClient, to_tool_result  # noqa: E402


class ForwardsToRealGatewayTest(unittest.TestCase):
    def setUp(self):
        self.run = GatewayRun()
        self.assertEqual(self.run.ready()["op"], "ready")
        self.run.peer()
        self.client = GatewayClient(self.run.socket_path)

    def tearDown(self):
        self.client.close()
        self.run.close()

    def test_a_call_reaches_the_gateway_with_its_arguments_unchanged_and_the_handshake_names_the_adapter(self):
        self.assertEqual([t["name"] for t in self.client.tools_list()][:2], ["get_state", "set_speed"])
        reply = self.client.call("set_speed", {"speed_mmps": 700})
        self.assertFalse(reply["result"]["isError"])
        self.run.stop()
        log = self.run.log("gateway.jsonl")
        self.assertEqual([(l["tool"], l["args"]) for l in log if l["type"] == "call"], [("set_speed", {"speed_mmps": 700})])
        self.assertEqual([l["client"] for l in log if l.get("method") == "initialize"], [CLIENT_INFO])

    def test_a_bad_argument_comes_back_as_the_gateways_error_result_not_a_local_decision(self):
        reply = self.client.call("set_speed", {"speed_mmps": "fast"})
        self.assertTrue(reply["result"]["isError"])
        self.assertIn("bad arguments", reply["result"]["content"][0]["text"])


class ScriptedGateway:
    """A socketpair whose far end answers each request line with `answer(request)`; None closes the connection."""

    def __init__(self, answer):
        self.answer = answer
        self.requests = []

    def connect(self, _path):
        ours, theirs = socket.socketpair()
        threading.Thread(target=self._serve, args=(theirs,), daemon=True).start()
        return ours

    def _serve(self, sock):
        buf = b""
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                return
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                msg = json.loads(line)
                self.requests.append(msg)
                if "id" not in msg:
                    continue
                reply = self.answer(msg)
                if reply is None:
                    sock.close()
                    return
                sock.sendall((json.dumps({"jsonrpc": "2.0", "id": msg["id"], **reply}) + "\n").encode())


class LostConnectionTest(unittest.TestCase):
    def test_a_call_lost_with_the_connection_gets_32000_once_and_the_next_call_redials_with_a_new_handshake(self):
        state = {"drop": True}

        def answer(msg):
            if msg["method"] == "tools/call" and state.pop("drop", False):
                return None
            return {"result": {"content": [{"type": "text", "text": "ok"}]}}

        gw = ScriptedGateway(answer)
        client = GatewayClient("unused", connect=gw.connect)
        self.assertEqual(client.call("stop", {}), {"jsonrpc": "2.0", "error": {"code": LOST_CODE, "message": LOST}})
        self.assertEqual(client.call("stop", {})["result"]["content"][0]["text"], "ok")
        methods = [m["method"] for m in gw.requests]
        self.assertEqual(methods, ["initialize", "notifications/initialized", "tools/call", "initialize", "notifications/initialized", "tools/call"])
        self.assertEqual(client.dials, 2)
        client.close()


class ToolResultTest(unittest.TestCase):
    def test_text_and_structured_content_map_to_text_and_json_blocks(self):
        reply = {"result": {"content": [{"type": "text", "text": "{}"}], "structuredContent": {"ok": True}, "isError": False}}
        self.assertEqual(to_tool_result("t1", reply), {"toolUseId": "t1", "status": "success", "content": [{"text": "{}"}, {"json": {"ok": True}}]})

    def test_a_denied_call_is_an_error_result_with_the_gateways_text(self):
        reply = {"result": {"content": [{"type": "text", "text": "denied by plant policy: R2"}], "isError": True}}
        self.assertEqual(to_tool_result("t1", reply)["status"], "error")
        self.assertEqual(to_tool_result("t1", reply)["content"], [{"text": "denied by plant policy: R2"}])

    def test_a_json_rpc_error_keeps_its_code_and_message(self):
        reply = {"error": {"code": LOST_CODE, "message": LOST}}
        self.assertEqual(to_tool_result("t1", reply), {"toolUseId": "t1", "status": "error", "content": [{"text": "MCP error -32000: plant connection lost"}]})


if __name__ == "__main__":
    unittest.main()
