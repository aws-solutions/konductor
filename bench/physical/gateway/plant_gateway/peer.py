# SPDX-License-Identifier: Apache-2.0
"""Who is on the other end of a gw.sock connection, by pid namespace. Never trusts anything the peer sends."""
import os
import socket
import struct

UCRED = struct.Struct("3i")


def peer_pid(sock):
    """The pid the kernel recorded for the process that connected `sock` (SO_PEERCRED)."""
    pid, _uid, _gid = UCRED.unpack(sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, UCRED.size))
    return pid


def peer_pidns(sock, proc="/proc"):
    """`(pid, pidns)` of the peer of `sock`; pidns is the `pid:[inode]` link under `proc`, or None if the pid is gone."""
    pid = peer_pid(sock)
    # Read right after accept: the pid could be reused later, and then the link would name someone else.
    try:
        return pid, os.readlink(os.path.join(proc, str(pid), "ns", "pid"))
    except OSError:
        return pid, None
