# SPDX-License-Identifier: Apache-2.0
"""The gateway's single event loop: control frames on fd 3, gw.sock connections, heartbeat. Never blocks on one peer."""
import json
import selectors
import socket

from .control import ControlError
from .limits import LimitExceeded
from .mcp import McpConnection
from .plant import LinkDropped

CHUNK = 64 * 1024


def frame_bytes(frame):
    """One newline-terminated JSON line for `frame`."""
    return (json.dumps(frame, separators=(",", ":")) + "\n").encode("utf-8")


class LineBuffer:
    """Splits a byte stream into lines. `max_line` is the longest line allowed, newline excluded."""

    def __init__(self, max_line):
        self._max_line = max_line
        self._data = bytearray()

    @property
    def pending(self):
        return len(self._data)

    def feed(self, data):
        """Adds `data` and returns the complete lines. Raises LimitExceeded("line") on an over-long line."""
        self._data += data
        lines = []
        while True:
            end = self._data.find(b"\n")
            if end < 0:
                break
            lines.append(bytes(self._data[:end]))
            del self._data[: end + 1]
        if any(len(line) > self._max_line for line in lines) or len(self._data) > self._max_line:
            raise LimitExceeded("line")
        return lines


class Connection:
    """One accepted gw.sock connection. `held` stays true until the peer check passes."""

    def __init__(self, sock, conn_id, pid, pidns, now, max_line, ancestors=()):
        self.sock = sock
        self.id = conn_id
        self.pid = pid
        self.pidns = pidns
        self.ancestors = ancestors
        self.accepted_at = now
        self.partial_since = None
        self.lines = LineBuffer(max_line)
        self.outbuf = bytearray()
        self.queued = []
        self.mcp = None

    @property
    def held(self):
        return self.mcp is None


class Gateway:
    """Serves one run until the runner sends `stop`.

    `control` is the fd 3 socket and `reader` checks its frames. `listener` is the bound gw.sock. `plant`
    runs calls and logs; `glog`/`wlog` are the logs whose running hashes go in `hb` and `final`. `limits` holds
    every bound; `clock` is a monotonic seconds function; `peer_of` maps an accepted socket to `(pid, pidns)`;
    `ancestors_of` maps a peer pid to the pid namespaces above its own (default: none, so no peer counts as nested).
    """

    def __init__(self, control, reader, listener, plant, glog, wlog, limits, clock, peer_of, ancestors_of=None):
        self._control = control
        self._reader = reader
        self._control_lines = LineBuffer(limits.control_frame_bytes)
        self._listener = listener
        self._plant = plant
        self._glog = glog
        self._wlog = wlog
        self._limits = limits
        self._clock = clock
        self._peer_of = peer_of
        self._ancestors_of = ancestors_of or (lambda pid: ())
        self._selector = selectors.DefaultSelector()
        self._conns = {}
        self._accepted = 0
        self._bytes_in = 0
        self._pidns = None
        self._hb_n = 0
        self._next_hb = clock()
        self.limit_hit = None
        self.foreign_seen = False
        self.stopped = False
        self.control_lost = False
        for sock in (control, listener):
            sock.setblocking(False)
            self._selector.register(sock, selectors.EVENT_READ)

    def run(self):
        """Loops until `stop` or the runner's end of fd 3. Returns the process exit code."""
        while not (self.stopped or self.control_lost):
            self.step(self._timeout())
        return 0 if self.stopped else 1

    def step(self, timeout):
        """One loop turn: wait up to `timeout` seconds for input, handle it, then run the timers."""
        for key, mask in self._selector.select(timeout):
            self._dispatch(key.fileobj, mask)
            if self.stopped or self.control_lost:
                return
        self._run_timers()

    def _timeout(self):
        return max(0.0, min(0.25, self._next_hb - self._clock()))

    def _dispatch(self, sock, mask):
        if sock is self._control:
            self._read_control()
        elif sock is self._listener:
            self._accept()
        else:
            conn = self._conns.get(sock)
            if conn is not None:
                self._serve(conn, mask)

    def _send_control(self, frame):
        # fd 3 is a socketpair the runner drains; a blocking send keeps frames whole and in order.
        self._control.setblocking(True)
        try:
            self._control.sendall(frame_bytes(frame))
        finally:
            self._control.setblocking(False)

    def _read_control(self):
        data = self._recv(self._control)
        if data is None:
            return
        if not data:
            self.control_lost = True
            return
        try:
            lines = self._control_lines.feed(data)
        except LimitExceeded:
            self._control_lines = LineBuffer(self._limits.control_frame_bytes)
            self._reject_control(ControlError("bad_frame", "frame too long"))
            return
        for line in lines:
            self._handle_control(line)

    def _handle_control(self, line):
        try:
            frame = self._reader.read(line)
        except ControlError as e:
            self._reject_control(e)
            return
        if frame["op"] == "hello":
            self._reject_control(ControlError("out_of_order", "hello is read at startup"))
        elif frame["op"] == "peer":
            self._accept_peer(frame["pidns"])
        elif frame["op"] == "stop":
            self._stop()
        elif frame["op"] == "set_state":
            self._plant.load_test_state(frame["state"], frame["sensors"], frame["now_ms"], frame["approval"])
            self._send_control({"op": "state_set", "now_ms": frame["now_ms"]})

    def _reject_control(self, error):
        self._plant.event("control_reject", code=error.code)
        self._send_control({"op": "error", "code": error.code, "detail": str(error)})

    def _accept(self):
        sock, _ = self._listener.accept()
        sock.setblocking(False)
        if len(self._conns) >= self._limits.open_connections or self._accepted >= self._limits.connections_per_run:
            self._plant.event("limit", which="connections", conn=None)
            sock.close()
            return
        self._accepted += 1
        pid, pidns = self._peer_of(sock)
        ancestors = self._ancestors_of(pid) if pidns is not None else ()
        conn = Connection(sock, self._accepted, pid, pidns, self._clock(), self._limits.line_bytes, ancestors)
        self._conns[sock] = conn
        self._selector.register(sock, selectors.EVENT_READ)
        if self._pidns is not None:
            self._check_peer(conn)

    def _accept_peer(self, pidns):
        self._pidns = pidns
        for conn in list(self._conns.values()):
            if conn.held:
                self._check_peer(conn)

    def _check_peer(self, conn):
        """A peer in the sandbox's own namespace is served. One nested inside it ends this trial (SR-4); any other is foreign."""
        if conn.pidns != self._pidns and self._pidns in conn.ancestors:
            self._limit(conn, LimitExceeded("nested_pidns"))
            return
        if conn.pidns != self._pidns:
            self._plant.event("foreign_conn", conn=conn.id, peer_pid=conn.pid, peer_pidns=conn.pidns)
            self.foreign_seen = True
            self._heartbeat()
            self._close(conn)
            return
        conn.mcp = McpConnection(self._plant, conn.id, self._limits)
        self._read_lines(conn, b"")

    def _serve(self, conn, mask):
        if mask & selectors.EVENT_WRITE:
            self._flush(conn)
        if mask & selectors.EVENT_READ and conn.sock in self._conns:
            data = self._recv(conn.sock)
            if data is None:
                return
            if not data:
                self._close(conn)
                return
            self._bytes_in += len(data)
            self._read_lines(conn, data)

    def _read_lines(self, conn, data):
        try:
            if self._bytes_in > self._limits.bytes_in_per_run:
                raise LimitExceeded("bytes")
            conn.queued += conn.lines.feed(data)
            # A held connection only queues: its lines are answered once the peer check releases it.
            if conn.held:
                return
            lines, conn.queued = conn.queued, []
            for line in lines:
                self._answer(conn, conn.mcp.handle(line))
        except LimitExceeded as e:
            self._limit(conn, e)
            return
        except LinkDropped:
            # drop_link: no reply, and lines this connection sent after the cut-off call are never read.
            self._close(conn)
            return
        conn.partial_since = (conn.partial_since or self._clock()) if conn.lines.pending else None

    def _answer(self, conn, reply):
        if reply is None:
            return
        conn.outbuf += frame_bytes(reply)
        if len(conn.outbuf) > self._limits.unsent_reply_bytes:
            raise LimitExceeded("unsent_replies")
        self._flush(conn)

    def _flush(self, conn):
        try:
            sent = conn.sock.send(conn.outbuf)
        except BlockingIOError:
            sent = 0
        except OSError:
            self._close(conn)
            return
        del conn.outbuf[:sent]
        events = selectors.EVENT_READ | (selectors.EVENT_WRITE if conn.outbuf else 0)
        self._selector.modify(conn.sock, events)

    def _limit(self, conn, error):
        self._plant.event("limit", which=error.which, conn=conn.id)
        if error.ends_trial and self.limit_hit is None:
            self.limit_hit = error.which
            self._heartbeat()
        self._close(conn)

    def _close(self, conn):
        self._conns.pop(conn.sock, None)
        self._selector.unregister(conn.sock)
        conn.sock.close()

    def _run_timers(self):
        now = self._clock()
        for conn in list(self._conns.values()):
            if conn.held and now - conn.accepted_at > self._limits.peer_hold_s:
                self._limit(conn, LimitExceeded("peer_hold"))
            elif conn.partial_since is not None and now - conn.partial_since > self._limits.idle_partial_line_s:
                self._limit(conn, LimitExceeded("idle_partial_line"))
        if now >= self._next_hb:
            self._heartbeat()
            self._next_hb = now + 1.0

    def _heartbeat(self):
        """Sends an `hb`. Also sent at once on a trial-ending limit or a foreign peer, so the runner stops the agent without waiting for the next tick."""
        self._hb_n += 1
        self._send_control({
            "op": "hb", "n": self._hb_n, "lastSeq": self._glog.last_seq, "lastProgress": self._plant.last_progress,
            "logSha256": self._log_hashes(), "limitHit": self.limit_hit,
            "foreignConn": self.foreign_seen,
        })

    def _log_hashes(self):
        return {"gateway": self._glog.sha256, "world": self._wlog.sha256}

    def _stop(self):
        self._selector.unregister(self._listener)
        self._listener.close()
        for conn in list(self._conns.values()):
            self._close(conn)
        self._plant.settle()
        self._plant.event("stop", lastSeq=self._glog.lines)
        self._send_control({
            "op": "final", "lastSeq": self._glog.last_seq,
            "lines": {"gateway": self._glog.lines, "world": self._wlog.lines}, "logSha256": self._log_hashes(),
        })
        self.stopped = True

    @staticmethod
    def _recv(sock):
        try:
            return sock.recv(CHUNK)
        except BlockingIOError:
            return None
        except OSError:
            return b""


def bind_listener(path):
    """A non-blocking Unix stream socket bound to `path` and listening; `path` must not exist."""
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.bind(path)
    sock.listen(8)
    return sock
