// SPDX-License-Identifier: Apache-2.0
//! Who this process is: its PID and its start time, which go into the lock record and the run state so that a person
//! can tell it from a later process with the same PID. Whether an owner still runs is decided by the workspace lock,
//! not here.
//!
//! On Linux the start time is the boot id and the start tick from `/proc/<pid>/stat`. On other Unix systems it is the
//! start time that `/bin/ps` prints.

use workflow_core::ports::Owner;

/// The current process as a run owner, or `None` if its start time cannot be read.
pub fn current_owner() -> Option<Owner> {
    let pid = std::process::id();
    Some(Owner {
        pid,
        started: start_time(pid)?,
    })
}

/// The start time of a running process, or `None` if there is none with that PID.
#[cfg(target_os = "linux")]
fn start_time(pid: u32) -> Option<String> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let boot = std::fs::read_to_string("/proc/sys/kernel/random/boot_id").ok()?;
    let (state, tick) = parse_stat(&stat)?;
    if matches!(state, 'Z' | 'X') {
        return None;
    }
    Some(format!("{}:{tick}", boot.trim()))
}

#[cfg(not(target_os = "linux"))]
fn start_time(pid: u32) -> Option<String> {
    // A full path, so a `ps` earlier on PATH cannot stand in for the system one. macOS and the BSDs keep it here.
    let output = std::process::Command::new("/bin/ps")
        .args(["-o", "stat=,lstart=", "-p", &pid.to_string()])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    let line = text.trim();
    if !output.status.success() || line.is_empty() || line.starts_with('Z') {
        return None;
    }
    let (_, started) = line.split_once(char::is_whitespace)?;
    Some(started.trim().to_string())
}

/// The state letter and the start tick (fields 3 and 22) of a `/proc/<pid>/stat` line. The command name (field 2) is
/// in parentheses and may hold spaces and parentheses itself, so the fields are read after its last `)`.
fn parse_stat(stat: &str) -> Option<(char, u64)> {
    let rest = &stat[stat.rfind(')')? + 1..];
    let fields: Vec<&str> = rest.split_whitespace().collect();
    let state = fields.first()?.chars().next()?;
    let tick = fields.get(19)?.parse().ok()?;
    Some((state, tick))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_stat_line_is_read_after_the_last_parenthesis() {
        let stat = "123 (a) b (c)) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 99887 20 21";
        assert_eq!(parse_stat(stat), Some(('S', 99887)));
        assert_eq!(parse_stat("123 (x) S 1"), None);
        assert_eq!(parse_stat("no parenthesis"), None);
    }
}
