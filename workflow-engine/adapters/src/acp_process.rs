// SPDX-License-Identifier: Apache-2.0
//! The adapter process of an ACP conversation: a program that runs as the leader of its own process group, with its
//! standard input and output piped to the client.
//!
//! [`SystemLauncher::launch`] cannot carry a conversation: it gives the program no standard input and waits for it to
//! end. [`SystemLauncher::spawn_piped`] starts the program the same way, as a group leader, and records the group and
//! its start time through the same `started` callback, so the sweep of a killed owner ends it like any other session.
//! It then hands the pipes to two threads, so that no wait of the client depends on the adapter:
//!
//! - the reader cuts the output into frames ([`Frames`], at most 4 MiB each) and queues them for the client. The queue
//!   is bounded by bytes ([`MAX_QUEUED_BYTES`]), not by frames: when it is full the reader stops reading, and the pipe
//!   slows the adapter, so an adapter that talks faster than the client reads cannot make the runner hold more than
//!   the bound, the frame that crosses it, and the start of the next line (under 4 MiB) that the cutter still holds;
//! - the writer owns the standard input, so a full pipe blocks it and never the client. What waits to be written is
//!   bounded too ([`MAX_OUTGOING_BYTES`]): an adapter that does not read its input makes `send` fail.
//!
//! Both end when the group ends. [`AcpProcess::end`] ends the group, and so does dropping the value, so no exit path of
//! a conversation leaves the adapter running. The last 4 KiB of its standard error are kept, as for the other
//! harnesses, for the terminal only. It gets the environment of this process unchanged.
//!
//! The adapter runs under the system `timeout` where there is one, as sessions do for the launcher: the program that
//! holds the limit is the group leader and the one whose start time is recorded, and it goes on counting if the owner
//! is killed. Its limit is set beyond the owner's own cancel, wait and group end, so these come first while the owner
//! lives.
//!
//! A launcher given an interrupt flag passes it on: the wire looks at it while it waits, and the conversation ends at
//! once when the owner gets Ctrl-C, SIGTERM or SIGHUP, so the caller can end the group.

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use workflow_core::limits::MAX_SESSION_STDERR_BYTES;
use workflow_core::ports::ProcessGroup;

use crate::acp_client::{Incoming, Wire};
use crate::acp_frames::{FrameError, Frames};
use crate::launcher::{
    duration_ms, exit_status, make_group_leader, program_problem, read_tail, seconds_arg, unix_ms,
    SystemLauncher, Tail, AFTER_KILL, LONGEST_LIMIT,
};

/// How many bytes of frames wait for the client before the reader stops reading.
pub const MAX_QUEUED_BYTES: usize = 8 * 1024 * 1024;

/// How many bytes wait to be written to the adapter before `send` fails. The stage prompt is the largest frame, and it
/// is at most 100 KiB.
pub const MAX_OUTGOING_BYTES: usize = 1024 * 1024;

/// How long the wire waits for a frame before it looks at the interrupt flag again.
const INTERRUPT_POLL: Duration = Duration::from_millis(50);

/// What a queued frame counts for besides its text, so that many tiny frames are bounded too.
const FRAME_OVERHEAD: usize = 64;

impl SystemLauncher {
    /// Starts `program` in `cwd` as the leader of its own process group, with piped standard input and output.
    /// `started` is called once with the group before this returns, as for
    /// [`launch`](workflow_core::ports::ProcessLauncher::launch), and when it fails the adapter is stopped and the
    /// start fails. The text of the error says why the program could not be started.
    ///
    /// `winds_down_in` is how long the caller needs to finish the conversation: the stage limit and the wait after
    /// `session/cancel`. Like [`launch`](workflow_core::ports::ProcessLauncher::launch), this starts the program under
    /// the system `timeout` where there is one, so that a limit outlives an owner that was killed. That limit is set
    /// beyond `winds_down_in`, by the grace period and a moment more, so the caller's own cancel, wait and group end
    /// come first while the owner lives. Without `timeout` the program runs directly and the limit lasts only while the
    /// owner does.
    pub fn spawn_piped(
        &self,
        program: &str,
        args: &[String],
        cwd: &str,
        winds_down_in: Duration,
        started: &mut dyn FnMut(&ProcessGroup) -> Result<(), String>,
    ) -> Result<AcpProcess, String> {
        // Under `timeout` a missing program would only show as the status of `timeout`, so it is looked for first.
        let guard = self.timeout_program();
        if guard.is_some() {
            if let Some(why) = program_problem(program, Path::new(cwd)) {
                return Err(why);
            }
        }
        let guard_limit = winds_down_in
            .saturating_add(self.grace())
            .saturating_add(AFTER_KILL)
            .clamp(Duration::from_millis(1), LONGEST_LIMIT);
        let mut command = match &guard {
            Some(timeout) => {
                let mut command = Command::new(timeout);
                command
                    .args([
                        "-k",
                        &seconds_arg(self.grace().max(Duration::from_millis(1))),
                    ])
                    .arg(seconds_arg(guard_limit))
                    .arg(program);
                command
            }
            None => Command::new(program),
        };
        let wall_deadline = unix_ms(SystemTime::now()).saturating_add(duration_ms(guard_limit));
        command
            .args(args)
            .current_dir(Path::new(cwd))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        make_group_leader(&mut command);
        let mut child = command
            .spawn()
            .map_err(|error| format!("{program}: {error}"))?;
        let pgid = child.id();
        let (Some(stdin), Some(stdout), Some(stderr)) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take())
        else {
            self.stop_group(pgid, Some(&mut child));
            return Err("its input and output could not be piped".to_string());
        };
        // Standard error is read from the start, so an adapter that logs a lot never blocks on a full pipe.
        let Some((error_tail, errors_done)) =
            read_tail(stderr, "acp-errors", MAX_SESSION_STDERR_BYTES)
        else {
            self.stop_group(pgid, Some(&mut child));
            return Err("its standard error could not be read".to_string());
        };

        // The group must be on record before the adapter can do anything. If it cannot be recorded while the adapter
        // runs, the adapter is stopped and the start fails.
        match SystemLauncher::identify(pgid) {
            Some(mut group) => {
                // The deadline is the one that holds when the owner is gone: with `timeout` that is its limit.
                group.deadline_ms = guard.as_ref().map(|_| wall_deadline);
                if let Err(why) = started(&group) {
                    self.stop_group(pgid, Some(&mut child));
                    return Err(format!(
                        "its process group could not be recorded, so it was stopped: {why}"
                    ));
                }
            }
            None => {
                if matches!(child.try_wait(), Ok(None)) {
                    self.stop_group(pgid, Some(&mut child));
                    return Err(
                        "its start time could not be read, so its process group could not be recorded"
                            .to_string(),
                    );
                }
            }
        }

        let Ok(mut wire) = ChildWire::over(stdout, stdin) else {
            self.stop_group(pgid, Some(&mut child));
            return Err("its output could not be read".to_string());
        };
        wire.interrupt = self.interrupt_flag();
        Ok(AcpProcess {
            child: Some(child),
            pgid,
            launcher: self.clone(),
            wire,
            error_tail,
            errors_done,
        })
    }
}

/// A running adapter. Its process group is ended when it is dropped.
pub struct AcpProcess {
    child: Option<Child>,
    pgid: u32,
    launcher: SystemLauncher,
    wire: ChildWire,
    error_tail: Arc<Mutex<Tail>>,
    errors_done: Receiver<()>,
}

impl AcpProcess {
    /// The two ends of the conversation.
    pub fn wire(&mut self) -> &mut ChildWire {
        &mut self.wire
    }

    /// The exit status of the adapter if it has ended by itself, as the launcher reports one. An adapter that has just
    /// closed its output may not have ended yet, so the wait is up to `wait`.
    pub fn exit_status(&mut self, wait: Duration) -> Option<i32> {
        let until = Instant::now() + wait;
        loop {
            match self.child.as_mut()?.try_wait() {
                Ok(Some(status)) => return Some(exit_status(&status)),
                Ok(None) if Instant::now() < until => thread::sleep(Duration::from_millis(10)),
                Ok(None) | Err(_) => return None,
            }
        }
    }

    /// The last [`MAX_SESSION_STDERR_BYTES`] of the adapter's standard error, as text. Call it after
    /// [`end`](Self::end): the stream ends with the group, and what was read when the wait of a second is over is what
    /// there is. The text is the adapter's own, so the caller cuts it to printable text before it shows it.
    pub fn errors(&mut self) -> String {
        let _ = self.errors_done.recv_timeout(Duration::from_secs(1));
        self.error_tail
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .text(MAX_SESSION_STDERR_BYTES)
    }

    /// Ends the adapter's whole process group: the terminate signal, the grace period, then the kill.
    pub fn end(&mut self) {
        if let Some(mut child) = self.child.take() {
            self.launcher.stop_group(self.pgid, Some(&mut child));
        }
    }
}

impl Drop for AcpProcess {
    fn drop(&mut self) {
        self.end();
    }
}

/// The frames that wait for the client, and how many bytes they count for.
#[derive(Default)]
struct Queue {
    state: Mutex<QueueState>,
    changed: Condvar,
}

#[derive(Default)]
struct QueueState {
    items: VecDeque<(Incoming, usize)>,
    bytes: usize,
    /// Set when the client end is dropped, so a reader that waits for room stops.
    closed: bool,
}

impl Queue {
    fn lock(&self) -> std::sync::MutexGuard<'_, QueueState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Queues `item`. With `wait_for_room` it first waits until the queue is under its byte bound, so a frame that
    /// arrives when the queue is just under the bound is the only one that goes over. False when the client is gone.
    fn push(&self, item: Incoming, wait_for_room: bool) -> bool {
        let size = match &item {
            Incoming::Frame(text) => text.len(),
            _ => 0,
        } + FRAME_OVERHEAD;
        let mut state = self.lock();
        while wait_for_room && state.bytes >= MAX_QUEUED_BYTES && !state.closed {
            state = self
                .changed
                .wait(state)
                .unwrap_or_else(PoisonError::into_inner);
        }
        if state.closed {
            return false;
        }
        state.bytes += size;
        state.items.push_back((item, size));
        self.changed.notify_all();
        true
    }

    fn close(&self) {
        self.lock().closed = true;
        self.changed.notify_all();
    }

    fn pop(&self, until: Instant) -> Incoming {
        let mut state = self.lock();
        loop {
            if let Some((item, size)) = state.items.pop_front() {
                state.bytes -= size;
                self.changed.notify_all();
                return item;
            }
            let wait = until.saturating_duration_since(Instant::now());
            if wait.is_zero() {
                return Incoming::TimedOut;
            }
            state = self
                .changed
                .wait_timeout(state, wait)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
    }
}

/// The client's two ends of the pipes.
pub struct ChildWire {
    incoming: Arc<Queue>,
    outgoing: Sender<Vec<u8>>,
    /// Bytes that were queued for the writer and not yet written.
    unwritten: Arc<AtomicUsize>,
    /// Set by the owner's signal handler. `recv` looks at it between waits.
    interrupt: Option<Arc<AtomicBool>>,
}

impl ChildWire {
    /// Starts the reader of `stdout` and the writer of `stdin`.
    pub(crate) fn over(
        stdout: impl Read + Send + 'static,
        stdin: impl Write + Send + 'static,
    ) -> std::io::Result<ChildWire> {
        let incoming = Arc::new(Queue::default());
        let unwritten = Arc::new(AtomicUsize::new(0));
        let (outgoing, to_write) = mpsc::channel::<Vec<u8>>();
        let reader_queue = Arc::clone(&incoming);
        thread::Builder::new()
            .name("acp-reader".to_string())
            .spawn(move || read_frames(stdout, &reader_queue))?;
        let writer_queue = Arc::clone(&incoming);
        let writer_count = Arc::clone(&unwritten);
        thread::Builder::new()
            .name("acp-writer".to_string())
            .spawn(move || write_frames(stdin, &to_write, &writer_count, &writer_queue))?;
        Ok(ChildWire {
            incoming,
            outgoing,
            unwritten,
            interrupt: None,
        })
    }

    /// The bytes that wait for the client.
    #[cfg(test)]
    fn queued_bytes(&self) -> usize {
        self.incoming.lock().bytes
    }
}

impl Drop for ChildWire {
    fn drop(&mut self) {
        self.incoming.close();
    }
}

impl Wire for ChildWire {
    fn send(&mut self, frame: &str) -> Result<(), String> {
        let mut bytes = frame.as_bytes().to_vec();
        bytes.push(b'\n');
        if self.unwritten.load(Ordering::SeqCst) + bytes.len() > MAX_OUTGOING_BYTES {
            return Err("the adapter is not reading its input".to_string());
        }
        self.unwritten.fetch_add(bytes.len(), Ordering::SeqCst);
        self.outgoing
            .send(bytes)
            .map_err(|_| "the adapter's input is closed".to_string())
    }

    fn recv(&mut self, until: Instant) -> Incoming {
        // With an interrupt flag the wait is cut into short pieces, so a signal is seen without a frame arriving.
        loop {
            let piece = if self.interrupt.is_some() {
                until.min(Instant::now() + INTERRUPT_POLL)
            } else {
                until
            };
            match self.incoming.pop(piece) {
                Incoming::TimedOut if piece < until && !self.interrupted() => {}
                other => return other,
            }
        }
    }

    fn interrupted(&self) -> bool {
        self.interrupt
            .as_ref()
            .is_some_and(|flag| flag.load(Ordering::SeqCst))
    }
}

/// Reads the adapter's output to its end, or to the first line over the limit.
fn read_frames(mut stdout: impl Read, queue: &Queue) {
    let mut cutter = Frames::new();
    let mut chunk = vec![0u8; 64 * 1024];
    loop {
        let read = match stdout.read(&mut chunk) {
            Ok(0) => {
                if let Some(last) = cutter.finish() {
                    if !queue.push(item(last), true) {
                        return;
                    }
                }
                queue.push(Incoming::Closed, false);
                return;
            }
            Ok(read) => read,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => {
                queue.push(Incoming::Failed(error.to_string()), false);
                return;
            }
        };
        for found in cutter.push(&chunk[..read]) {
            let stop = found == Err(FrameError::TooLong);
            if !queue.push(item(found), true) || stop {
                return;
            }
        }
    }
}

fn item(found: Result<String, FrameError>) -> Incoming {
    match found {
        Ok(frame) => Incoming::Frame(frame),
        Err(FrameError::TooLong) => Incoming::TooLong,
        Err(FrameError::NotUtf8) => Incoming::NotUtf8,
    }
}

/// Writes each queued frame to the adapter. A failed write is queued for the client as a failure, whatever the size of
/// the queue, and ends the writer.
fn write_frames(
    mut stdin: impl Write,
    queued: &Receiver<Vec<u8>>,
    unwritten: &AtomicUsize,
    failures: &Queue,
) {
    while let Ok(bytes) = queued.recv() {
        let written = stdin.write_all(&bytes).and_then(|()| stdin.flush());
        unwritten.fetch_sub(bytes.len(), Ordering::SeqCst);
        if let Err(error) = written {
            failures.push(
                Incoming::Failed(format!("writing to the adapter failed: {error}")),
                false,
            );
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A reader that gives `frames` frames of `size` bytes each and then ends, and counts what it gave.
    struct FrameSource {
        left: usize,
        pending: Vec<u8>,
        size: usize,
        given: Arc<AtomicUsize>,
    }

    impl FrameSource {
        fn new(frames: usize, size: usize, given: Arc<AtomicUsize>) -> FrameSource {
            FrameSource {
                left: frames,
                pending: Vec::new(),
                size,
                given,
            }
        }
    }

    impl Read for FrameSource {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if self.pending.is_empty() {
                if self.left == 0 {
                    return Ok(0);
                }
                self.left -= 1;
                self.pending = vec![b'a'; self.size - 1];
                self.pending.push(b'\n');
            }
            let n = buf.len().min(self.pending.len());
            buf[..n].copy_from_slice(&self.pending[..n]);
            self.pending.drain(..n);
            self.given.fetch_add(n, Ordering::SeqCst);
            Ok(n)
        }
    }

    /// A reader that waits until its sender is dropped, then ends.
    struct Hold(Receiver<()>);

    impl Read for Hold {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            let _ = self.0.recv();
            Ok(0)
        }
    }

    /// A writer that takes nothing until its sender is dropped.
    struct Stuck(Receiver<()>);

    impl Write for Stuck {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            let _ = self.0.recv();
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    struct Broken;

    impl Write for Broken {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::new(std::io::ErrorKind::BrokenPipe, "gone"))
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn soon() -> Instant {
        Instant::now() + Duration::from_secs(20)
    }

    #[test]
    fn frames_that_wait_for_the_client_stay_within_the_byte_bound_and_none_is_lost() {
        const FRAME: usize = 1024 * 1024;
        const FRAMES: usize = 40;
        let given = Arc::new(AtomicUsize::new(0));
        let reader = FrameSource::new(FRAMES, FRAME, Arc::clone(&given));
        let mut wire = ChildWire::over(reader, std::io::sink()).unwrap();
        // The reader fills the queue and then waits for the client. Poll until the queue is full.
        let until = Instant::now() + Duration::from_secs(20);
        while wire.queued_bytes() < MAX_QUEUED_BYTES {
            assert!(Instant::now() < until, "the queue never filled");
            thread::sleep(Duration::from_millis(5));
        }
        // Give a reader that does not stop time to read on.
        thread::sleep(Duration::from_millis(100));
        let held = given.load(Ordering::SeqCst);
        assert!(
            held <= MAX_QUEUED_BYTES + 3 * FRAME,
            "the reader read {held} bytes while the client read nothing"
        );
        assert!(held < FRAMES * FRAME);
        // The client reads every frame, and then the end.
        for _ in 0..FRAMES {
            match wire.recv(soon()) {
                Incoming::Frame(text) => assert_eq!(text.len(), FRAME - 1),
                other => panic!("{other:?}"),
            }
        }
        assert_eq!(wire.recv(soon()), Incoming::Closed);
        assert_eq!(wire.queued_bytes(), 0);
    }

    #[test]
    fn dropping_the_wire_frees_a_reader_that_waits_for_room() {
        let given = Arc::new(AtomicUsize::new(0));
        let reader = FrameSource::new(1000, 1024 * 1024, Arc::clone(&given));
        let wire = ChildWire::over(reader, std::io::sink()).unwrap();
        let until = Instant::now() + Duration::from_secs(20);
        while wire.queued_bytes() < MAX_QUEUED_BYTES {
            assert!(Instant::now() < until);
            thread::sleep(Duration::from_millis(5));
        }
        drop(wire);
        // The reader ends instead of reading the other frames. Its count stops growing.
        thread::sleep(Duration::from_millis(100));
        let first = given.load(Ordering::SeqCst);
        thread::sleep(Duration::from_millis(100));
        assert_eq!(given.load(Ordering::SeqCst), first);
        assert!(first < 1000 * 1024 * 1024);
    }

    #[test]
    fn what_waits_to_be_written_is_bounded_and_send_fails_over_the_bound() {
        let (release, stuck) = mpsc::channel::<()>();
        let (hold, reader) = mpsc::channel::<()>();
        let mut wire = ChildWire::over(Hold(reader), Stuck(stuck)).unwrap();
        let frame = "x".repeat(300 * 1024);
        let mut sent = 0;
        let failed = loop {
            match wire.send(&frame) {
                Ok(()) => sent += 1,
                Err(why) => break why,
            }
            assert!(sent < 100, "send never failed");
        };
        assert!(failed.contains("not reading its input"), "{failed}");
        // 1 MiB holds three of these frames and not a fourth.
        assert_eq!(sent, 3);
        drop(release);
        drop(hold);
    }

    #[test]
    fn a_failed_write_reaches_the_client_even_when_the_queue_is_full() {
        let (hold, reader) = mpsc::channel::<()>();
        let mut wire = ChildWire::over(Hold(reader), Broken).unwrap();
        // Fill the queue past its bound by hand, as a reader that has run ahead would have.
        let big = "x".repeat(MAX_QUEUED_BYTES);
        assert!(wire.incoming.push(Incoming::Frame(big), false));
        wire.send("{}").unwrap();
        let mut failure = None;
        for _ in 0..2 {
            if let Incoming::Failed(why) = wire.recv(soon()) {
                failure = Some(why);
            }
        }
        assert!(failure.is_some_and(|why| why.contains("writing to the adapter failed")));
        drop(hold);
    }

    #[test]
    fn a_wire_with_an_interrupt_flag_returns_from_a_long_wait_soon_after_the_flag_is_set() {
        let (hold, reader) = mpsc::channel::<()>();
        let mut wire = ChildWire::over(Hold(reader), std::io::sink()).unwrap();
        let flag = Arc::new(AtomicBool::new(false));
        wire.interrupt = Some(Arc::clone(&flag));
        assert!(!wire.interrupted());
        let setter = {
            let flag = Arc::clone(&flag);
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(100));
                flag.store(true, Ordering::SeqCst);
            })
        };
        let began = Instant::now();
        let got = wire.recv(Instant::now() + Duration::from_secs(60));
        assert_eq!(got, Incoming::TimedOut);
        assert!(wire.interrupted());
        assert!(
            began.elapsed() < Duration::from_secs(10),
            "{:?}",
            began.elapsed()
        );
        setter.join().unwrap();
        drop(hold);
    }

    #[test]
    fn a_deadline_that_has_passed_with_an_empty_queue_is_a_timeout_and_a_queued_frame_still_comes()
    {
        let (hold, reader) = mpsc::channel::<()>();
        let mut wire = ChildWire::over(Hold(reader), std::io::sink()).unwrap();
        assert_eq!(wire.recv(Instant::now()), Incoming::TimedOut);
        assert!(wire.incoming.push(Incoming::Frame("{}".to_string()), false));
        assert_eq!(wire.recv(Instant::now()), Incoming::Frame("{}".to_string()));
        drop(hold);
    }
}
