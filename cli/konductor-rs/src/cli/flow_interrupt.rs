// SPDX-License-Identifier: Apache-2.0
//
// flow_interrupt.rs: what `flow run` does about Ctrl-C, Ctrl-\, SIGTERM and SIGHUP while a session runs.
//
// A session leads its own process group, so these signals reach the owner (this process) and not the session. The
// handlers set a flag and do nothing else, which is all a signal handler may safely do. The launcher looks at the flag
// while it waits, ends the session's group (terminate, grace period, kill) and reports the session as interrupted. The
// runner then blocks the stage and halts the run, and the command exits with the halted code, 1. The spec has no other
// status or exit code for an interrupt, and 2 stays reserved.
//
// The handlers stay for the rest of the process, which only prints the result: a second signal while the session is
// being ended is ignored and does not cut the grace period short. The launcher prints one line when it starts to stop
// the session, so a user who waits sees why. A SIGKILL cannot be handled. The session runs under `timeout`, which ends it at its limit
// without the owner, and the next `flow run` ends the group it recorded if it is still there.

use std::io;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

/// Sets `flag` when the process gets SIGINT, SIGQUIT, SIGTERM or SIGHUP. Call it once the user has confirmed the run, because
/// from then on these signals no longer end the process by themselves.
#[cfg(unix)]
pub(crate) fn watch(flag: &Arc<AtomicBool>) -> io::Result<()> {
    use signal_hook::consts::{SIGHUP, SIGINT, SIGQUIT, SIGTERM};
    for signal in [SIGINT, SIGQUIT, SIGTERM, SIGHUP] {
        signal_hook::flag::register(signal, Arc::clone(flag))?;
    }
    Ok(())
}

/// Nothing to watch: sessions are started in their own group on Unix only.
#[cfg(not(unix))]
pub(crate) fn watch(_flag: &Arc<AtomicBool>) -> io::Result<()> {
    Ok(())
}
