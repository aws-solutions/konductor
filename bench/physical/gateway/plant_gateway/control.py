# SPDX-License-Identifier: Apache-2.0
"""Reads and checks runner frames from fd 3 (8.1). Never acts on a frame that failed a check."""
import hmac
import json
import os

from .schema import SchemaError, check

TEST_OPS = frozenset({"set_state", "set_arm_state"})
SCHEMA_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "schemas", "control-v1.json")


class ControlError(Exception):
    """A rejected frame. `code` is the 8.1 error code sent back in an `error` frame."""

    def __init__(self, code, detail):
        super().__init__(detail)
        self.code = code


def load_frame_schemas(path=SCHEMA_PATH):
    """The closed schema of each runner frame, keyed by `op`, from `path`."""
    with open(path, encoding="utf-8") as f:
        return json.load(f)["frames"]


class ControlReader:
    """Checks frames in arrival order.

    `schemas` maps each `op` to its closed schema. `max_bytes` caps one frame line. The first frame must
    be `hello`; its token then guards every later frame. A test-mode frame (`set_state`, `set_arm_state`) is refused unless hello said testMode.
    """

    def __init__(self, schemas, max_bytes):
        self._schemas = schemas
        self._max_bytes = max_bytes
        self._token = None
        self._test_mode = False

    def read(self, line):
        """Returns the checked frame for one `line` (bytes, no newline) or raises ControlError."""
        frame = self._parse(line)
        op = frame["op"]
        if op == "hello":
            return self._hello(frame)
        if self._token is None:
            raise ControlError("out_of_order", f"{op} before hello")
        if not hmac.compare_digest(frame["token"].encode(), self._token.encode()):
            raise ControlError("bad_token", "token mismatch")
        if op in TEST_OPS and not self._test_mode:
            raise ControlError("not_test_mode", "set_state needs test mode")
        return frame

    def _parse(self, line):
        if len(line) > self._max_bytes:
            raise ControlError("bad_frame", "frame too long")
        try:
            frame = json.loads(line)
        except ValueError:
            raise ControlError("bad_frame", "not JSON") from None
        if not isinstance(frame, dict) or frame.get("op") not in self._schemas:
            raise ControlError("bad_frame", "unknown op")
        try:
            check(frame, self._schemas[frame["op"]])
        except SchemaError as e:
            raise ControlError("bad_frame", str(e)) from None
        return frame

    def _hello(self, frame):
        if self._token is not None:
            raise ControlError("out_of_order", "second hello")
        self._token = frame["token"]
        self._test_mode = frame["testMode"]
        return frame
