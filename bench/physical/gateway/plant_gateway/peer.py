# SPDX-License-Identifier: Apache-2.0
"""Who is on the other end of a gw.sock connection, by pid namespace. Never trusts anything the peer sends."""
import fcntl
import os
import socket
import struct

UCRED = struct.Struct("3i")
NS_GET_PARENT = 0xB702  # _IO(0xb7, 2): the parent pid namespace of the one an fd names
MAX_NS_DEPTH = 32  # the kernel nests pid namespaces at most 32 deep


class KernelNs:
    """The kernel calls the nested pid namespace walk needs. Tests pass a fake with the same four methods."""

    def __init__(self, proc="/proc"):
        self._proc = proc

    def open_pidns(self, pid):
        """An fd on the pid namespace of `pid`."""
        return os.open(os.path.join(self._proc, str(pid), "ns", "pid"), os.O_RDONLY)

    def parent(self, fd):
        """An fd on the parent of the namespace `fd` names; OSError (EPERM) at or above the caller's own namespace."""
        return fcntl.ioctl(fd, NS_GET_PARENT)

    def name(self, fd):
        """The `pid:[inode]` link text of the namespace `fd` names."""
        return os.readlink("/proc/self/fd/%d" % fd)

    def close(self, fd):
        os.close(fd)


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


def pidns_ancestors(pid, ns=None):
    """The `pid:[inode]` names of the pid namespaces above the one `pid` is in, nearest first. Empty when `pid` is gone,
    or when the walk is refused straight away. `ns` is a KernelNs (default: the real one).

    The walk ends at the first refusal, which is how the kernel marks a namespace the caller is not above."""
    ns = ns or KernelNs()
    names = []
    try:
        fd = ns.open_pidns(pid)
    except OSError:
        return names
    while len(names) < MAX_NS_DEPTH:
        try:
            parent = ns.parent(fd)
        except OSError:
            break
        ns.close(fd)
        fd = parent
        names.append(ns.name(fd))
    ns.close(fd)
    return names
