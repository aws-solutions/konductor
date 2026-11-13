// SPDX-License-Identifier: Apache-2.0
//! The process launcher: starts a program as the leader of its own process group, reads its standard output, waits with
//! a deadline and ends the whole group (spec: "Limits", D24).
//!
//! **Signals.** This crate forbids unsafe code and has no signal crate, so a group is signalled by running the system
//! `kill` program with a negative number (`kill -TERM -- -<pgid>`), by its absolute path so that a changed `PATH`
//! cannot replace it. A number below 2 is refused, because `-0` and `-1` mean the caller's own group and every process.
//!
//! **Deadlines.** The wait uses `std::time::Instant`, which does not move when the wall clock is set, and the runner's
//! `Clock` stays for the timestamps in the run state.
//!
//! **Which process a group number means.** A group is recorded with the start time of its leader. A later process can
//! get the same number, so the sweep signals a group only when its leader has the recorded start time. On Linux the
//! start time is read from `/proc/<pid>/stat` (field 22, in clock ticks since boot) and the boot id, so a reboot cannot
//! make two starts look equal. Where there is no `/proc`, which is macOS, it is read with `ps -o lstart=` under
//! `LC_ALL=C`, to the second. The text is for this module only. The leader is also checked to lead its own group.
//!
//! **No inherited files.** Rust opens every file with close-on-exec, so a session does not inherit the run lock or any
//! other file this process holds. The session gets no standard input and no standard error.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use workflow_core::limits::KILL_GRACE_MS;
use workflow_core::ports::{
    GroupState, Launch, LaunchEnd, Launched, ProcessGroup, ProcessLauncher,
};
use workflow_core::runner::keep_tail;

/// How often the wait looks at the program and its group.
const POLL: Duration = Duration::from_millis(20);
/// How long after a kill the group gets to disappear before the end is reported as failed.
const AFTER_KILL: Duration = Duration::from_secs(2);

/// Starts programs in their own process group and ends groups.
#[derive(Debug, Clone)]
pub struct SystemLauncher {
    grace: Duration,
}

impl Default for SystemLauncher {
    fn default() -> SystemLauncher {
        SystemLauncher::new()
    }
}

impl SystemLauncher {
    /// A launcher that waits [`KILL_GRACE_MS`] between the terminate signal and the kill.
    pub fn new() -> SystemLauncher {
        SystemLauncher::with_grace_ms(KILL_GRACE_MS)
    }

    /// A launcher with another grace period. A test uses a short one, so it does not wait ten seconds.
    pub fn with_grace_ms(ms: u64) -> SystemLauncher {
        SystemLauncher {
            grace: Duration::from_millis(ms),
        }
    }

    /// The identity of a process: the group it leads and its start time, or `None` if there is no such process.
    pub fn identify(pid: u32) -> Option<ProcessGroup> {
        let found = proc_identity(pid).or_else(|| ps_identity(pid))?;
        (found.pgid == pid).then_some(ProcessGroup {
            pgid: pid,
            started: found.started,
        })
    }
}

struct Identity {
    pgid: u32,
    started: String,
}

/// The bytes read from a program's standard output, the last `keep` of them.
struct Tail {
    bytes: Vec<u8>,
    keep: usize,
}

impl Tail {
    fn push(&mut self, chunk: &[u8]) {
        self.bytes.extend_from_slice(chunk);
        // Cut only when the buffer holds twice what is kept, so each byte is moved a few times at most.
        if self.bytes.len() > self.keep.saturating_mul(2) {
            let cut = self.bytes.len() - self.keep;
            self.bytes.drain(..cut);
        }
    }

    fn text(&self, keep: usize) -> String {
        let text = String::from_utf8_lossy(&self.bytes).into_owned();
        keep_tail(&text, keep).to_string()
    }
}

impl ProcessLauncher for SystemLauncher {
    fn launch(&mut self, launch: &Launch, started: &mut dyn FnMut(&ProcessGroup)) -> Launched {
        let not_started = |why: String| Launched {
            end: LaunchEnd::NotStarted(why),
            output: String::new(),
        };
        let mut command = Command::new(launch.program);
        command
            .args(launch.args)
            .current_dir(Path::new(launch.cwd))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        make_group_leader(&mut command);
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => return not_started(format!("{}: {error}", launch.program)),
        };
        let pgid = child.id();

        // Read the output on its own thread from the start, so a chatty program never blocks on a full pipe while the
        // group is being recorded.
        let tail = Arc::new(Mutex::new(Tail {
            bytes: Vec::new(),
            keep: launch.keep_output_bytes,
        }));
        let (done, finished) = mpsc::channel();
        let reader = child.stdout.take().map(|mut stdout| {
            let tail = Arc::clone(&tail);
            thread::Builder::new()
                .name("session-output".to_string())
                .spawn(move || {
                    let mut chunk = [0u8; 16 * 1024];
                    while let Ok(n) = stdout.read(&mut chunk) {
                        if n == 0 {
                            break;
                        }
                        tail.lock()
                            .unwrap_or_else(PoisonError::into_inner)
                            .push(&chunk[..n]);
                    }
                    let _ = done.send(());
                })
        });
        if !matches!(reader, Some(Ok(_))) {
            self.stop_group(pgid, Some(&mut child));
            return not_started("its output could not be read".to_string());
        }

        // The group must be on record before the session can do anything. If the record cannot be made while the
        // program still runs, it is stopped and never counted as started.
        match SystemLauncher::identify(pgid) {
            Some(group) => started(&group),
            None => {
                if matches!(child.try_wait(), Ok(None)) {
                    self.stop_group(pgid, Some(&mut child));
                    return not_started(
                        "its start time could not be read, so its process group could not be recorded".to_string(),
                    );
                }
            }
        }

        // A limit too large to add to the clock is a limit that never comes.
        let deadline = Instant::now()
            .checked_add(Duration::from_millis(launch.time_limit_ms))
            .unwrap_or_else(|| Instant::now() + Duration::from_secs(365 * 24 * 3600));
        let end = loop {
            match child.try_wait() {
                Ok(Some(status)) => break LaunchEnd::Exited(exit_status(&status)),
                Ok(None) if Instant::now() >= deadline => {
                    self.stop_group(pgid, Some(&mut child));
                    break LaunchEnd::TimedOut;
                }
                Ok(None) => {
                    thread::sleep(POLL.min(deadline.saturating_duration_since(Instant::now())))
                }
                Err(error) => {
                    self.stop_group(pgid, Some(&mut child));
                    return not_started(format!("waiting for it failed: {error}"));
                }
            }
        };
        if matches!(end, LaunchEnd::Exited(_)) && group_exists(pgid) {
            // The program ended and left processes behind. They hold its output open, so they end with their group.
            self.stop_group(pgid, None);
        }
        // The output ends when every holder of the pipe has ended. A holder that left the group keeps it open, so the
        // wait is bounded and what was read so far is kept.
        match finished.recv_timeout(self.grace) {
            Ok(()) | Err(RecvTimeoutError::Disconnected | RecvTimeoutError::Timeout) => {}
        }
        let output = tail
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .text(launch.keep_output_bytes);
        Launched { end, output }
    }

    fn group_state(&mut self, group: &ProcessGroup) -> GroupState {
        if !usable_group(group.pgid) {
            return GroupState::Unknown(format!("{} is not a process group number", group.pgid));
        }
        if !kill_available() {
            return GroupState::Unknown("the `kill` program was not found".to_string());
        }
        // A record that names this process's own group would end the run that is reading it.
        if own_group() == Some(group.pgid) {
            return GroupState::Unknown("it is the process group of this command".to_string());
        }
        if !group_exists(group.pgid) {
            return GroupState::Gone;
        }
        match proc_identity(group.pgid).or_else(|| ps_identity(group.pgid)) {
            // The group exists but its leader does not, so its start time cannot be compared. Signalling it would be a
            // guess about which process the number now means.
            None => GroupState::Unknown(
                "its leader has ended and its start time cannot be checked".to_string(),
            ),
            Some(found) if found.pgid != group.pgid || found.started != group.started => {
                GroupState::Differs
            }
            Some(_) => GroupState::Matches,
        }
    }

    fn end_group(&mut self, group: &ProcessGroup) -> Result<(), String> {
        if !usable_group(group.pgid) {
            return Err(format!("{} is not a process group number", group.pgid));
        }
        if !kill_available() {
            return Err("the `kill` program was not found".to_string());
        }
        if own_group() == Some(group.pgid) {
            return Err("it is the process group of this command".to_string());
        }
        self.stop_group(group.pgid, None);
        if group_exists(group.pgid) {
            Err(format!(
                "process group {} is still running after the kill signal",
                group.pgid
            ))
        } else {
            Ok(())
        }
    }
}

impl SystemLauncher {
    /// Sends the terminate signal to the group, waits the grace period for it to empty, then kills what is left. When
    /// `child` is the group's leader and this process started it, it is reaped as it ends: a leader that is a zombie
    /// still counts as a member of its group.
    fn stop_group(&self, pgid: u32, mut child: Option<&mut std::process::Child>) {
        let mut reap = |wait: bool| {
            if let Some(child) = child.as_deref_mut() {
                if wait {
                    let _ = child.wait();
                } else {
                    let _ = child.try_wait();
                }
            }
        };
        if !kill_available() {
            // Without the program only the leader can be ended, and only the one this process started.
            if let Some(child) = child {
                let _ = child.kill();
                let _ = child.wait();
            }
            return;
        }
        signal_group(pgid, "TERM");
        let until = Instant::now() + self.grace;
        loop {
            reap(false);
            if !group_exists(pgid) {
                reap(true);
                return;
            }
            if Instant::now() >= until {
                break;
            }
            thread::sleep(POLL.min(until.saturating_duration_since(Instant::now())));
        }
        signal_group(pgid, "KILL");
        let until = Instant::now() + AFTER_KILL;
        while Instant::now() < until {
            reap(false);
            if !group_exists(pgid) {
                break;
            }
            thread::sleep(POLL);
        }
        reap(false);
    }
}

#[cfg(unix)]
fn make_group_leader(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn make_group_leader(_command: &mut Command) {}

#[cfg(unix)]
fn exit_status(status: &std::process::ExitStatus) -> i32 {
    use std::os::unix::process::ExitStatusExt;
    status
        .code()
        .or_else(|| status.signal().map(|signal| 128 + signal))
        .unwrap_or(1)
}

#[cfg(not(unix))]
fn exit_status(status: &std::process::ExitStatus) -> i32 {
    status.code().unwrap_or(1)
}

/// The process group of this process.
fn own_group() -> Option<u32> {
    let pid = std::process::id();
    proc_identity(pid)
        .or_else(|| ps_identity(pid))
        .map(|found| found.pgid)
}

/// A group number that may be signalled. 0 and 1 are never a session's group, and `kill -- -1` reaches every process
/// the user may signal.
fn usable_group(pgid: u32) -> bool {
    pgid > 1 && i32::try_from(pgid).is_ok()
}

/// The system `kill` program, by absolute path.
fn kill_program() -> &'static str {
    ["/bin/kill", "/usr/bin/kill"]
        .into_iter()
        .find(|path| Path::new(path).is_file())
        .unwrap_or("/bin/kill")
}

fn kill_available() -> bool {
    Path::new(kill_program()).is_file()
}

/// Sends `signal` (a name such as `TERM`, or `0` to only test) to every process of group `pgid`. True if the signal
/// reached at least one.
fn signal_group(pgid: u32, signal: &str) -> bool {
    if !usable_group(pgid) {
        return false;
    }
    let mut command = Command::new(kill_program());
    command
        .arg(format!("-{signal}"))
        .args(["--", &format!("-{pgid}")])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn group_exists(pgid: u32) -> bool {
    signal_group(pgid, "0")
}

/// Linux: the group and start time of `pid` from `/proc`.
fn proc_identity(pid: u32) -> Option<Identity> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let boot = std::fs::read_to_string("/proc/sys/kernel/random/boot_id").ok()?;
    let (pgid, ticks) = parse_proc_stat(&stat)?;
    Some(Identity {
        pgid,
        started: format!("linux:{}:{ticks}", boot.trim()),
    })
}

/// The process group (field 5) and the start time (field 22) of a `/proc/<pid>/stat` line. The command name in field 2
/// is in parentheses and can hold spaces and parentheses, so the fields are counted from the last `)`.
fn parse_proc_stat(stat: &str) -> Option<(u32, u64)> {
    let after = &stat[stat.rfind(')')? + 1..];
    let fields: Vec<&str> = after.split_whitespace().collect();
    Some((fields.get(2)?.parse().ok()?, fields.get(19)?.parse().ok()?))
}

/// Where there is no `/proc`: the group and start time of `pid` from `ps`. The start time has a one second resolution.
fn ps_identity(pid: u32) -> Option<Identity> {
    let program = ["/bin/ps", "/usr/bin/ps"]
        .into_iter()
        .find(|path| Path::new(path).is_file())?;
    let output = Command::new(program)
        .args(["-o", "pgid=", "-o", "lstart=", "-p", &pid.to_string()])
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut words = text.split_whitespace();
    let pgid = words.next()?.parse().ok()?;
    let started: Vec<&str> = words.collect();
    if started.is_empty() {
        return None;
    }
    Some(Identity {
        pgid,
        started: format!("ps:{}", started.join(" ")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_stat_line_is_read_from_the_last_parenthesis() {
        let line = "42 (a b) c) S 1 42 42 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 987654 1000 10 18446744073709551615";
        assert_eq!(parse_proc_stat(line), Some((42, 987654)));
        assert_eq!(parse_proc_stat("42 (x) S 1"), None);
        assert_eq!(parse_proc_stat("no parenthesis"), None);
    }

    #[test]
    fn group_numbers_that_reach_everything_are_refused() {
        for pgid in [0, 1, u32::MAX] {
            assert!(!usable_group(pgid), "{pgid}");
            assert!(!signal_group(pgid, "TERM"), "{pgid}");
        }
        assert!(usable_group(2));
    }

    #[test]
    fn the_group_of_this_process_is_never_ended() {
        let Some(own) = own_group() else { return };
        let group = ProcessGroup {
            pgid: own,
            started: "any".to_string(),
        };
        let mut launcher = SystemLauncher::with_grace_ms(10);
        assert!(matches!(
            launcher.group_state(&group),
            GroupState::Unknown(_)
        ));
    }

    #[test]
    fn the_tail_keeps_the_last_bytes_whatever_the_chunking() {
        let mut tail = Tail {
            bytes: Vec::new(),
            keep: 10,
        };
        for chunk in (0u8..100).collect::<Vec<_>>().chunks(7) {
            tail.push(chunk);
        }
        assert!(tail.bytes.len() <= 20);
        assert_eq!(
            &tail.bytes[tail.bytes.len() - 10..],
            &(90u8..100).collect::<Vec<_>>()[..]
        );
    }
}
