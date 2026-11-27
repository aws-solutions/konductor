// SPDX-License-Identifier: Apache-2.0
//! The process launcher: starts a program as the leader of its own process group, reads its standard output, waits with
//! a deadline and ends the whole group (spec: "Limits", D24).
//!
//! **Signals.** This crate forbids unsafe code and has no signal crate, so a group is signalled by running the system
//! `kill` program with a negative number (`kill -TERM -- -<pgid>`), by its absolute path so that a changed `PATH`
//! cannot replace it. A number below 2 is refused, because `-0` and `-1` mean the caller's own group and every process.
//!
//! **Interrupts.** A launcher given an interrupt flag ([`SystemLauncher::with_interrupt`]) looks at it while it waits.
//! When the flag is set it ends the session's group like a deadline does (terminate, grace period, kill) and reports
//! [`LaunchEnd::Interrupted`]. A launch that begins after the flag was set starts nothing. The flag is set by the
//! caller, which owns the signal handling, so this crate needs no signal crate.
//!
//! **Deadlines.** The wait uses `std::time::Instant`, which does not move when the wall clock is set, and the runner's
//! `Clock` stays for the timestamps in the run state.
//!
//! **A deadline that outlives the owner.** A limit that only the owner loop counts ends with the owner. So the program
//! is started under the system `timeout` program (`timeout -k <grace> <limit> <program> <args>`; `gtimeout` where GNU
//! coreutils has that name, as on macOS). It is looked up on `PATH`, in absolute folders only. `timeout` goes on
//! counting after a SIGKILL of the owner, so the deadline holds without the owner only when `timeout` or `gtimeout` is on
//! `PATH`, and only for the whole group when it is GNU. Without `--foreground` it signals its whole process group at the limit.
//! `--foreground` is not used because it signals only the program and leaves what the program started.
//!
//! What `-k` does after the grace period depends on the program ([`TimeoutFlavor`], read once from `--version`). With
//! GNU `timeout` the kill reaches the whole group, so nothing the session started outlives the limit. With uutils
//! `timeout` (the default on Ubuntu 26.04) the terminate signal reaches the whole group, but the kill reaches only the
//! program. A process the session started that ignores the terminate signal can then outlive the limit when the owner
//! is dead, and its group has no leader, so the sweep leaves it alone. While the owner lives, its loop ends the whole
//! group itself (terminate, grace period, kill), so the difference matters only after the owner was killed.
//!
//! `timeout` is the group leader. The launcher starts it as the leader of a new group (`process_group(0)`), and
//! `timeout` makes itself a group leader, which for a process that already is one changes nothing. So the recorded
//! group number is the process number of `timeout`, the sweep compares the start time of that process, and a signal to
//! the group reaches `timeout` and the program.
//!
//! **A group without a leader.** The sweep can match a group only while its leader is alive with the recorded start
//! time. A group loses its leader when the owner is dead and a member outlives the leader: the program exits by itself
//! while it has a background child (any background process the agent started, not only one that ignores the terminate
//! signal), `timeout` exits with it, and the child is left in the group. The next run cannot match the group, so it
//! drops the record with a warning, and the child keeps running with no limit. With GNU `timeout` and a live owner the
//! whole group is ended, so this needs the owner dead. It is tracked in #388
//! (https://github.com/aws-solutions/konductor/issues/388).
//!
//! The owner loop keeps its own deadline as a second line. Under `timeout` it comes after the limit, the grace period
//! and [`AFTER_KILL`], because a terminate signal that reaches `timeout` before its own limit makes `timeout` 8.22 kill
//! at the limit without the grace period, and two parties signalling at the same moment would race. If neither
//! program is found the program runs directly, the owner loop enforces the limit at the limit, and the limit lasts only
//! while the owner does ([`SystemLauncher::guards_limit`], [`NO_TIMEOUT_WARNING`]).
//!
//! **Status 124 and 137.** `timeout` exits 124 for a program it stopped at the limit, and the kill after the grace
//! period gives 137 (it kills its own group). Under `timeout`, the launcher reads one of the two as
//! [`LaunchEnd::TimedOut`] only when its own monotonic clock has reached the limit since it started `timeout`, which
//! only runs its count after that. A program that exits with 124 or 137 earlier is a program that exited, as it is
//! without `timeout`.
//!
//! **Which process a group number means.** A group is recorded with the start time of its leader. A later process can
//! get the same number, so the sweep signals a group only when its leader has the recorded start time. On Linux the
//! start time is read from `/proc/<pid>/stat` (field 22, in clock ticks since boot) and the boot id, so a reboot cannot
//! make two starts look equal. Where there is no `/proc`, which is macOS, it is read with `ps -o lstart=` under
//! `LC_ALL=C`, to the second. The text is for this module only. The leader is also checked to lead its own group.
//!
//! **No inherited files.** Rust opens every file with close-on-exec, so a session does not inherit the run lock or any
//! other file this process holds. The session gets no standard input. Its standard error is read on its own thread, and
//! the last [`MAX_SESSION_STDERR_BYTES`] of it go back to the caller for the terminal.

use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use workflow_core::limits::{KILL_GRACE_MS, MAX_SESSION_STDERR_BYTES};
use workflow_core::ports::{
    GroupState, Launch, LaunchEnd, Launched, ProcessGroup, ProcessLauncher,
};
use workflow_core::runner::keep_tail;

/// How often the wait looks at the program and its group.
const POLL: Duration = Duration::from_millis(20);
/// How long after a kill the group gets to disappear before the end is reported as failed.
pub(crate) const AFTER_KILL: Duration = Duration::from_secs(2);
/// A limit that is longer than a year is a year, so the number handed to `timeout` and the clock sum stay in range.
pub(crate) const LONGEST_LIMIT: Duration = Duration::from_secs(365 * 24 * 3600);
/// The programs that stop another after a limit, in the order they are tried.
const TIMEOUT_PROGRAMS: [&str; 2] = ["timeout", "gtimeout"];
/// What to tell the user when no such program is found.
pub const NO_TIMEOUT_WARNING: &str = "Neither `timeout` nor `gtimeout` was found on PATH, so a session's time limit \
lasts only while this command runs. If this command is killed, the session runs on until the next run ends it. GNU \
coreutils provides `timeout` (on macOS, `brew install coreutils` provides `gtimeout`).";

/// Which `timeout` the launcher found. Both end the program at the limit and send the terminate signal to the whole
/// group. They differ in the kill: GNU `timeout` ends the whole group, and others (uutils, the default on Ubuntu
/// 26.04) end only the program, so a process it started that ignores the terminate signal can outlive the limit when
/// the owner is gone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeoutFlavor {
    /// `timeout --version` names GNU coreutils: the kill reaches the whole group.
    Gnu,
    /// Anything else: the kill is taken to reach only the program.
    Other,
}

/// How long `timeout --version` may take before the flavor is taken as [`TimeoutFlavor::Other`].
const VERSION_WAIT: Duration = Duration::from_secs(2);

/// Starts programs in their own process group and ends groups.
#[derive(Debug, Clone)]
pub struct SystemLauncher {
    grace: Duration,
    interrupt: Option<Arc<AtomicBool>>,
    /// The folders `timeout` is looked up in, as a `PATH` list. `None` is the `PATH` of this process at each launch.
    search: Option<OsString>,
    /// Where the `kill` program is looked for, instead of its usual places. `None` is the usual places.
    kill_search: Option<Vec<PathBuf>>,
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
            interrupt: None,
            search: None,
            kill_search: None,
        }
    }

    /// Looks for the `kill` program only at `paths`. A test uses it to start with no `kill`, as on an image that has
    /// none, without changing the machine.
    pub fn with_kill_search(mut self, paths: Vec<PathBuf>) -> SystemLauncher {
        self.kill_search = Some(paths);
        self
    }

    /// Looks for `timeout` and `gtimeout` in the folders of `path` (a `PATH` list of absolute folders) instead of in
    /// `PATH`. A test uses it to start with no such program, without changing the environment of the whole process.
    pub fn with_timeout_search(mut self, path: impl Into<OsString>) -> SystemLauncher {
        self.search = Some(path.into());
        self
    }

    /// Whether a session's time limit is held by a program other than this one, so that it lasts if this process is
    /// killed. False when no `timeout` or `gtimeout` is found: the limit then lasts only as long as the owner.
    pub fn guards_limit(&self) -> bool {
        self.timeout_program().is_some()
    }

    /// The flavor of the `timeout` this launcher would use, or `None` when it finds none. It is read once for each
    /// program path and kept for the life of the process.
    pub fn timeout_flavor(&self) -> Option<TimeoutFlavor> {
        self.timeout_program().map(|path| flavor_of(&path))
    }

    pub(crate) fn timeout_program(&self) -> Option<PathBuf> {
        find_timeout(self.search.as_deref())
    }

    /// A launcher that ends its session and starts no other once `flag` is set. The caller sets it from a signal
    /// handler, so the owner can end the session group before it exits.
    pub fn with_interrupt(mut self, flag: Arc<AtomicBool>) -> SystemLauncher {
        self.interrupt = Some(flag);
        self
    }

    /// The grace period between the terminate signal and the kill.
    pub(crate) fn grace(&self) -> Duration {
        self.grace
    }

    /// Whether the interrupt flag is set.
    pub(crate) fn interrupted(&self) -> bool {
        self.interrupt
            .as_ref()
            .is_some_and(|flag| flag.load(Ordering::SeqCst))
    }

    /// The interrupt flag this launcher looks at, for a caller that waits on its own and has to look at it too.
    pub(crate) fn interrupt_flag(&self) -> Option<Arc<AtomicBool>> {
        self.interrupt.clone()
    }

    /// The identity of a process: the group it leads and its start time, or `None` if there is no such process.
    pub fn identify(pid: u32) -> Option<ProcessGroup> {
        let found = proc_identity(pid).or_else(|| ps_identity(pid))?;
        (found.pgid == pid).then_some(ProcessGroup {
            pgid: pid,
            started: found.started,
            deadline_ms: None,
        })
    }
}

struct Identity {
    pgid: u32,
    started: String,
}

/// The bytes read from a program's standard output, the last `keep` of them.
pub(crate) struct Tail {
    bytes: Vec<u8>,
    keep: usize,
    /// The first `keep_head` bytes of the stream, held apart from the tail so that a long output still has its start.
    head: Vec<u8>,
    keep_head: usize,
}

impl Tail {
    fn push(&mut self, chunk: &[u8]) {
        // The head fills once from the start and never grows past `keep_head`, so its memory is bounded by it.
        let room = self.keep_head.saturating_sub(self.head.len());
        self.head.extend_from_slice(&chunk[..room.min(chunk.len())]);
        self.bytes.extend_from_slice(chunk);
        // Cut only when the buffer holds twice what is kept, so each byte is moved a few times at most.
        if self.bytes.len() > self.keep.saturating_mul(2) {
            let cut = self.bytes.len() - self.keep;
            self.bytes.drain(..cut);
        }
    }

    pub(crate) fn text(&self, keep: usize) -> String {
        let text = String::from_utf8_lossy(&self.bytes).into_owned();
        keep_tail(&text, keep).to_string()
    }

    /// The head as text. A character that the cut at `keep_head` splits is dropped whole, not turned into U+FFFD, so the
    /// head only ever holds characters that the program wrote. A byte that is not UTF-8 in the middle is still replaced.
    fn head_text(&self) -> String {
        match std::str::from_utf8(&self.head) {
            Ok(text) => text.to_string(),
            Err(error) if error.error_len().is_none() => {
                String::from_utf8_lossy(&self.head[..error.valid_up_to()]).into_owned()
            }
            Err(_) => String::from_utf8_lossy(&self.head).into_owned(),
        }
    }
}

/// Reads `stream` on its own thread from the start, keeping its last `keep` bytes and its first `keep_head` bytes, so a chatty program never blocks on
/// a full pipe. The receiver gets a message when the stream ends. `None` if the thread could not start.
pub(crate) fn read_tail(
    mut stream: impl Read + Send + 'static,
    name: &str,
    keep: usize,
    keep_head: usize,
) -> Option<(Arc<Mutex<Tail>>, Receiver<()>)> {
    let tail = Arc::new(Mutex::new(Tail {
        bytes: Vec::new(),
        keep,
        head: Vec::new(),
        keep_head,
    }));
    let (done, finished) = mpsc::channel();
    let reader = Arc::clone(&tail);
    thread::Builder::new()
        .name(name.to_string())
        .spawn(move || {
            let mut chunk = [0u8; 16 * 1024];
            while let Ok(n) = stream.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                reader
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .push(&chunk[..n]);
            }
            let _ = done.send(());
        })
        .ok()?;
    Some((tail, finished))
}

impl ProcessLauncher for SystemLauncher {
    fn launch(
        &mut self,
        launch: &Launch,
        started: &mut dyn FnMut(&ProcessGroup) -> Result<(), String>,
    ) -> Launched {
        let ended = |end: LaunchEnd| Launched {
            end,
            output: String::new(),
            head: String::new(),
            errors: String::new(),
        };
        let not_started = |why: String| ended(LaunchEnd::NotStarted(why));
        // An interrupt that came before this session starts keeps it from starting.
        if self.interrupted() {
            return ended(LaunchEnd::Interrupted);
        }
        // Without `kill` a group cannot be ended. The fallback of ending only the process this one started would leave
        // the program running with no limit when it runs under `timeout`, so nothing is started.
        let kill_found = match &self.kill_search {
            Some(paths) => paths.iter().any(|path| path.is_file()),
            None => kill_available(),
        };
        if !kill_found {
            return not_started(
                "the `kill` program was not found (/bin/kill or /usr/bin/kill), so a session's process group could not \
                 be ended. Install it (the procps or util-linux package), then run the workflow again"
                    .to_string(),
            );
        }
        let limit = Duration::from_millis(launch.time_limit_ms)
            .clamp(Duration::from_millis(1), LONGEST_LIMIT);
        // Under `timeout` the program is not the process this one starts, so a program that is missing would only show
        // as the status of `timeout`. It is looked for first, so it is reported as not started, as it is without.
        let guard = self.timeout_program();
        if guard.is_some() {
            if let Some(why) = program_problem(launch.program, Path::new(launch.cwd)) {
                return not_started(why);
            }
        }
        let mut command = match &guard {
            Some(timeout) => {
                let mut command = Command::new(timeout);
                command
                    .args(["-k", &seconds_arg(self.grace.max(Duration::from_millis(1)))])
                    .arg(seconds_arg(limit))
                    .arg(launch.program);
                command
            }
            None => Command::new(launch.program),
        };
        command
            .args(launch.args)
            .current_dir(Path::new(launch.cwd))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        make_group_leader(&mut command);
        // The limit counts from here. `timeout` starts its own count after this, so when it ends the program at the
        // limit this clock has reached it too.
        let begun = Instant::now();
        let wall_deadline = unix_ms(SystemTime::now()).saturating_add(duration_ms(limit));
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => return not_started(format!("{}: {error}", launch.program)),
        };
        let pgid = child.id();

        // Both streams are read from the start, so a chatty program never blocks on a full pipe while the group is
        // being recorded.
        let out = child.stdout.take().and_then(|stream| {
            read_tail(
                stream,
                "session-output",
                launch.keep_output_bytes,
                launch.keep_head_bytes,
            )
        });
        let err = child
            .stderr
            .take()
            .and_then(|stream| read_tail(stream, "session-errors", MAX_SESSION_STDERR_BYTES, 0));
        let (Some((tail, finished)), Some((error_tail, errors_finished))) = (out, err) else {
            self.stop_group(pgid, Some(&mut child));
            return not_started("its output could not be read".to_string());
        };

        // The group is recorded right after the spawn. If the record cannot be made while the program still runs, it
        // is stopped and never counted as started.
        match SystemLauncher::identify(pgid) {
            Some(mut group) => {
                group.deadline_ms = Some(wall_deadline);
                if let Err(why) = started(&group) {
                    self.stop_group(pgid, Some(&mut child));
                    return not_started(format!(
                        "its process group could not be recorded, so it was stopped: {why}"
                    ));
                }
            }
            None => {
                if matches!(child.try_wait(), Ok(None)) {
                    self.stop_group(pgid, Some(&mut child));
                    return not_started(
                        "its start time could not be read, so its process group could not be recorded".to_string(),
                    );
                }
            }
        }

        // Under `timeout` this loop is the second line: a terminate signal that reaches `timeout` before its own limit
        // makes some versions kill at the limit without the grace period, so the loop waits until `timeout` has had
        // its limit, its grace period and a moment more before it ends the group itself.
        let deadline = match guard {
            Some(_) => begun + limit + self.grace + AFTER_KILL,
            None => begun + limit,
        };
        // Whether the program ended by itself or at the limit under `timeout`, as against being ended by this loop.
        let mut ended_by_itself = false;
        let end = loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    ended_by_itself = true;
                    let code = exit_status(&status);
                    // 124 and 137 are what `timeout` gives for a program it stopped. They count only after the limit,
                    // so a program that exits with one of them earlier is a program that exited.
                    let stopped =
                        guard.is_some() && matches!(code, 124 | 137) && begun.elapsed() >= limit;
                    break if stopped {
                        LaunchEnd::TimedOut
                    } else {
                        LaunchEnd::Exited(code)
                    };
                }
                Ok(None) if self.interrupted() => {
                    // A user who waits up to the grace period for the session to end sees why. A second signal is
                    // ignored from here on: the handlers only set the flag, which is already set, so Ctrl-C again does
                    // not cut the grace period short, and only SIGKILL ends this process at once.
                    let _ = writeln!(
                        std::io::stderr(),
                        "konductor flow: stopping the session, which can take up to {} seconds. Another signal is \
                         ignored until it has ended.",
                        self.grace.as_secs().max(1)
                    );
                    self.stop_group(pgid, Some(&mut child));
                    break LaunchEnd::Interrupted;
                }
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
        if ended_by_itself && group_exists(pgid) {
            // The program ended and left processes behind. They hold its output open, so they end with their group.
            // This also covers `timeout`, which ends once the program does, even if a child of it ignored the signal.
            self.stop_group(pgid, None);
        }
        // A stream ends when every holder of its pipe has ended. A holder that left the group keeps it open, so the
        // wait is bounded, by one grace period for both, and what was read so far is kept.
        let until = Instant::now() + self.grace;
        for finished in [&finished, &errors_finished] {
            let _ = finished.recv_timeout(until.saturating_duration_since(Instant::now()));
        }
        let text = |tail: &Mutex<Tail>, keep: usize| {
            tail.lock()
                .unwrap_or_else(PoisonError::into_inner)
                .text(keep)
        };
        let head = tail
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .head_text();
        Launched {
            end,
            output: text(&tail, launch.keep_output_bytes),
            head,
            errors: text(&error_tail, MAX_SESSION_STDERR_BYTES),
        }
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
    pub(crate) fn stop_group(&self, pgid: u32, mut child: Option<&mut std::process::Child>) {
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

/// `1.500s`: the form of a duration `timeout` reads. The part after the point keeps a limit below one second.
pub(crate) fn seconds_arg(duration: Duration) -> String {
    format!("{}.{:03}s", duration.as_secs(), duration.subsec_millis())
}

pub(crate) fn duration_ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

pub(crate) fn unix_ms(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).map_or(0, duration_ms)
}

/// Reads the flavor of the `timeout` at `path` from its `--version` text. The call is bounded: a program that does
/// not answer in [`VERSION_WAIT`] is killed and counts as [`TimeoutFlavor::Other`].
fn flavor_of(path: &Path) -> TimeoutFlavor {
    static KNOWN: OnceLock<Mutex<HashMap<PathBuf, TimeoutFlavor>>> = OnceLock::new();
    let known = KNOWN.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(found) = known
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(path)
    {
        return *found;
    }
    let flavor = read_flavor(path);
    known
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(path.to_path_buf(), flavor);
    flavor
}

fn read_flavor(path: &Path) -> TimeoutFlavor {
    let Ok(mut child) = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return TimeoutFlavor::Other;
    };
    let Some(mut out) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return TimeoutFlavor::Other;
    };
    // The text is read on its own thread so that a program that never answers cannot block this one.
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut text = String::new();
        let mut bytes = Vec::new();
        let _ = out.by_ref().take(4096).read_to_end(&mut bytes);
        text.push_str(&String::from_utf8_lossy(&bytes));
        let _ = sender.send(text);
    });
    let text = receiver.recv_timeout(VERSION_WAIT).unwrap_or_default();
    let _ = child.kill();
    let _ = child.wait();
    if text.contains("GNU coreutils") {
        TimeoutFlavor::Gnu
    } else {
        TimeoutFlavor::Other
    }
}

/// The first of `names` that is an executable file in an absolute folder of `search`, or of `PATH` when `search` is
/// `None`. A relative folder, including the empty entry that means the current folder, is skipped, so a file in the
/// project cannot stand in for the program. It serves `timeout` and the Kiro CLI program alike.
pub fn find_program(names: &[&str], search: Option<&OsStr>) -> Option<PathBuf> {
    let from_env = std::env::var_os("PATH");
    let list = search.or(from_env.as_deref())?;
    let folders: Vec<PathBuf> = std::env::split_paths(list)
        .filter(|folder| folder.is_absolute())
        .collect();
    names.iter().find_map(|name| {
        folders
            .iter()
            .map(|folder| folder.join(name))
            .find(|path| is_executable(path))
    })
}

fn find_timeout(search: Option<&OsStr>) -> Option<PathBuf> {
    find_program(&TIMEOUT_PROGRAMS, search)
}

/// Why `program` cannot be run from `cwd`, or `None` if it can. A name with a slash is a path from `cwd`; any other is
/// looked up on `PATH`, as the system does when it starts a program.
pub(crate) fn program_problem(program: &str, cwd: &Path) -> Option<String> {
    let found = if program.contains('/') {
        let path = cwd.join(program);
        if !path.exists() {
            return Some(format!("{program}: not found"));
        }
        is_executable(&path)
    } else {
        let list = std::env::var_os("PATH")?;
        let mut candidates =
            std::env::split_paths(&list).map(|folder| cwd.join(folder).join(program));
        candidates.any(|path| is_executable(&path))
    };
    (!found).then(|| format!("{program}: not found or not executable"))
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

#[cfg(unix)]
pub(crate) fn make_group_leader(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
pub(crate) fn make_group_leader(_command: &mut Command) {}

#[cfg(unix)]
pub(crate) fn exit_status(status: &std::process::ExitStatus) -> i32 {
    use std::os::unix::process::ExitStatusExt;
    status
        .code()
        .or_else(|| status.signal().map(|signal| 128 + signal))
        .unwrap_or(1)
}

#[cfg(not(unix))]
pub(crate) fn exit_status(status: &std::process::ExitStatus) -> i32 {
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
            deadline_ms: None,
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
            head: Vec::new(),
            keep_head: 0,
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

    /// A reader of `keep` tail bytes and `keep_head` head bytes that was fed `text` in chunks of `chunk` bytes.
    fn fed(text: &[u8], keep: usize, keep_head: usize, chunk: usize) -> Tail {
        let mut tail = Tail {
            bytes: Vec::new(),
            keep,
            head: Vec::new(),
            keep_head,
        };
        for piece in text.chunks(chunk) {
            tail.push(piece);
        }
        tail
    }

    #[test]
    fn the_head_holds_the_first_bytes_when_the_output_is_longer_and_the_tail_fills_too() {
        let text: Vec<u8> = (b'a'..=b'z').cycle().take(1000).collect();
        for chunk in [1, 7, 64, 1000] {
            let tail = fed(&text, 10, 12, chunk);
            assert_eq!(tail.head_text().as_bytes(), &text[..12], "chunk {chunk}");
            assert_eq!(tail.text(10).as_bytes(), &text[990..], "chunk {chunk}");
            // The head never grows past what was asked for.
            assert_eq!(tail.head.len(), 12);
        }
    }

    #[test]
    fn the_head_is_empty_when_none_is_asked_for() {
        let tail = fed(b"some output", 100, 0, 3);
        assert_eq!(tail.head_text(), "");
        assert!(tail.head.is_empty());
        assert_eq!(tail.text(100), "some output");
    }

    #[test]
    fn the_head_and_the_tail_agree_when_the_output_is_shorter_than_both() {
        let tail = fed(b"short", 100, 50, 2);
        assert_eq!(tail.head_text(), "short");
        assert_eq!(tail.text(100), "short");
    }

    #[test]
    fn a_character_cut_at_the_head_boundary_is_left_out_whole_and_nothing_panics() {
        // `é` is two bytes, so a head of 3 bytes ends in the middle of the second `é`.
        let text = "aéé".as_bytes();
        assert_eq!(text.len(), 5);
        let tail = fed(text, 100, 3, 1);
        assert_eq!(tail.head_text(), "aé");
        // A cut that falls on a boundary keeps every character.
        assert_eq!(fed(text, 100, 5, 2).head_text(), "aéé");
        // A byte that is not UTF-8 in the middle is replaced, as it is in the tail.
        assert_eq!(fed(b"a\xffb", 100, 3, 3).head_text(), "a\u{fffd}b");
        // A cut inside a character with nothing before it gives an empty head.
        assert_eq!(fed("é".as_bytes(), 100, 1, 1).head_text(), "");
    }
}
