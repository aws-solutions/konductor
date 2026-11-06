// SPDX-License-Identifier: Apache-2.0
//
// metrics/mod.rs — `konductor metrics`: scans harness session files,
// keeps those whose agent is a Konductor agent (per every install in
// `~/.konductor/installs`), caches one record per file, and reports
// usage in each harness's native unit. Local only; nothing is sent.

mod collect;
mod report;

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use collect::{Harness, Record, Status};

use super::output::ColorMode;

const EXIT_USAGE_ERROR: u8 = 64;
const DEFAULT_SINCE: &str = "7d";
const CACHE_REL: &str = ".konductor/usage/records.jsonl";

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub(crate) enum GroupBy {
    Agent,
    Model,
    Day,
    Repo,
}

/// `<n>h`, `<n>d`, or `<n>w` → seconds.
fn parse_since(s: &str) -> Option<i64> {
    let (num, unit) = s.split_at(s.len().checked_sub(1)?);
    let n: i64 = num.parse().ok().filter(|n| *n > 0)?;
    let per = match unit {
        "h" => 3600,
        "d" => 86_400,
        "w" => 7 * 86_400,
        _ => return None,
    };
    n.checked_mul(per)
}

pub(crate) fn dispatch_metrics(
    since: Option<String>,
    by: GroupBy,
    json: bool,
    color: ColorMode,
) -> u8 {
    let since = since.unwrap_or_else(|| DEFAULT_SINCE.to_string());
    let Some(window) = parse_since(&since) else {
        eprintln!(
            "{} invalid --since '{since}': expected a positive number followed by h, d, or w (e.g. 24h, 7d, 4w)",
            super::output::error_prefix(color, "konductor metrics:")
        );
        return EXIT_USAGE_ERROR;
    };
    let Some(home) = super::install::index::env_home_dir() else {
        eprintln!(
            "{} HOME is not set",
            super::output::error_prefix(color, "konductor metrics:")
        );
        return 1;
    };
    let now = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    let cutoff = now - window;

    let agents = konductor_agent_names(&home);
    let cache_path = home.join(CACHE_REL);
    let mut cache = load_cache(&cache_path);
    let scan = refresh(&mut cache, &sources(&home), cutoff, &agents);
    if let Err(e) = save_cache(&cache_path, &cache) {
        eprintln!(
            "{} could not write {}: {e}",
            super::output::error_prefix(color, "konductor metrics: warning:"),
            cache_path.display()
        );
    }

    let in_window: Vec<&Record> = cache
        .values()
        .filter(|r| r.last_ts.unwrap_or(0) >= cutoff)
        .collect();
    let unparsed = in_window
        .iter()
        .filter(|r| r.status == Status::Unparsed)
        .count();
    let counted: Vec<&Record> = in_window
        .into_iter()
        .filter(|r| r.status == Status::Ok && !r.excluded && !r.models.is_empty())
        .filter(|r| r.agent.as_ref().is_some_and(|a| agents.contains(a)))
        .collect();

    let ctx = report::Context {
        since: &since,
        by,
        agents_known: agents.len(),
        unparsed,
        unreadable: scan.unreadable,
        home: &home,
    };
    if json {
        println!("{}", report::render_json(&counted, &ctx));
    } else {
        print!("{}", report::render_text(&counted, &ctx, color));
    }
    0
}

/// Union of agent names across every tracked install, plus `$HOME`
/// (the default target) in case the index predates it.
fn konductor_agent_names(home: &Path) -> BTreeSet<String> {
    let mut roots: Vec<PathBuf> = super::install::index::read_index_at_home(Some(home))
        .ok()
        .flatten()
        .map(|idx| {
            idx.installs
                .into_iter()
                .map(|e| PathBuf::from(e.target_dir))
                .collect()
        })
        .unwrap_or_default();
    if !roots.iter().any(|r| r == home) {
        roots.push(home.to_path_buf());
    }
    roots
        .iter()
        .flat_map(|r| super::telemetry_hook::installed_agent_names(r))
        .collect()
}

struct Source {
    harness: Harness,
    path: PathBuf,
}

fn env_dir(var: &str, home: &Path, default_rel: &str) -> PathBuf {
    std::env::var_os(var)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(default_rel))
}

fn children(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .map(|it| it.filter_map(|e| e.ok().map(|e| e.path())).collect())
        .unwrap_or_default()
}

fn has_ext(p: &Path, ext: &str) -> bool {
    p.extension().is_some_and(|e| e == ext)
}

/// Every candidate session file across the three harnesses. Listing is
/// cheap; parsing is gated on mtime and the cache in `refresh`.
fn sources(home: &Path) -> Vec<Source> {
    let mut out = Vec::new();
    let claude_projects = env_dir("CLAUDE_CONFIG_DIR", home, ".claude").join("projects");
    for project in children(&claude_projects)
        .into_iter()
        .filter(|p| p.is_dir())
    {
        for entry in children(&project) {
            if entry.is_file() && has_ext(&entry, "jsonl") {
                out.push(Source {
                    harness: Harness::Claude,
                    path: entry,
                });
            } else if entry.is_dir() {
                for sub in children(&entry.join("subagents")) {
                    if has_ext(&sub, "jsonl") {
                        out.push(Source {
                            harness: Harness::Claude,
                            path: sub,
                        });
                    }
                }
            }
        }
    }
    let kiro_sessions = env_dir("KIRO_HOME", home, ".kiro").join("sessions");
    for entry in children(&kiro_sessions.join("cli")) {
        if has_ext(&entry, "json") {
            out.push(Source {
                harness: Harness::KiroCliV2,
                path: entry,
            });
        }
    }
    for ws in children(&kiro_sessions)
        .into_iter()
        .filter(|p| p.is_dir() && !p.ends_with("cli"))
    {
        for session in children(&ws) {
            let messages = session.join("messages.jsonl");
            if messages.is_file() {
                out.push(Source {
                    harness: Harness::KiroV3,
                    path: messages,
                });
            }
        }
    }
    out
}

struct ScanOutcome {
    unreadable: usize,
}

/// Parses each in-window source whose (mtime, size) changed since it was
/// cached. Records for files the harness has since deleted are kept.
fn refresh(
    cache: &mut HashMap<String, Record>,
    sources: &[Source],
    cutoff: i64,
    agents: &BTreeSet<String>,
) -> ScanOutcome {
    let mut unreadable = 0;
    for src in sources {
        let Ok(meta) = std::fs::metadata(&src.path) else {
            unreadable += 1;
            continue;
        };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_secs());
        if (mtime as i64) < cutoff {
            continue;
        }
        let key = src.path.to_string_lossy().into_owned();
        if let Some(prev) = cache.get(&key) {
            if prev.mtime == mtime && prev.size == meta.len() {
                continue;
            }
        }
        let mut rec = match src.harness {
            Harness::Claude => collect::collect_claude(&src.path, mtime, meta.len()),
            Harness::KiroCliV2 => collect::collect_kiro_v2(&src.path, mtime, meta.len()),
            Harness::KiroV3 => collect::collect_kiro_v3(&src.path, mtime, meta.len()),
        };
        // Usage from non-Konductor sessions is never stored; the stub
        // stays so the file isn't re-parsed on every run.
        if !rec.agent.as_ref().is_some_and(|a| agents.contains(a)) {
            rec.models.clear();
            rec.excluded = true;
        }
        cache.insert(key, rec);
    }
    // A stub cached before its agent was installed must be re-parsed.
    cache.retain(|_, r| !(r.excluded && r.agent.as_ref().is_some_and(|a| agents.contains(a))));
    ScanOutcome { unreadable }
}

fn load_cache(path: &Path) -> HashMap<String, Record> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return HashMap::new();
    };
    text.lines()
        .filter_map(|l| serde_json::from_str::<Record>(l).ok())
        .map(|r| (r.path.clone(), r))
        .collect()
}

fn save_cache(path: &Path, cache: &HashMap<String, Record>) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut keys: Vec<&String> = cache.keys().collect();
    keys.sort();
    let mut out = String::new();
    for k in keys {
        if let Ok(line) = serde_json::to_string(&cache[k]) {
            out.push_str(&line);
            out.push('\n');
        }
    }
    super::atomic_write::write_atomic(path, out.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_since_windows() {
        assert_eq!(parse_since("24h"), Some(86_400));
        assert_eq!(parse_since("7d"), Some(7 * 86_400));
        assert_eq!(parse_since("2w"), Some(14 * 86_400));
        for bad in ["", "d", "0d", "-1d", "7", "7m", "1.5d"] {
            assert_eq!(parse_since(bad), None, "{bad}");
        }
    }

    fn rec(agent: &str, excluded: bool) -> Record {
        let mut r = collect::tests_support::record(agent);
        r.excluded = excluded;
        r
    }

    #[test]
    fn stub_is_reparsed_once_its_agent_becomes_konductor() {
        let agents: BTreeSet<String> = ["k-dev".to_string()].into();
        let mut cache = HashMap::from([
            ("stub".to_string(), rec("k-dev", true)),
            ("other".to_string(), rec("claude", true)),
            ("kept".to_string(), rec("k-dev", false)),
        ]);
        refresh(&mut cache, &[], 0, &agents);
        assert!(!cache.contains_key("stub"));
        assert!(cache.contains_key("other"));
        assert!(cache.contains_key("kept"));
    }
}
