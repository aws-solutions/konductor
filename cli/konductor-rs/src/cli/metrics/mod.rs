// SPDX-License-Identifier: Apache-2.0
//
// metrics/mod.rs — `konductor metrics`: scans harness session files,
// keeps those whose agent is a Konductor agent (per every install in
// `~/.konductor/installs`), caches one record per file, and reports
// usage in each harness's native unit. Local only; nothing is sent.

mod collect;
mod report;

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use collect::{Harness, Record, Status, PARSER_VERSION};

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

/// `<n>h`, `<n>d`, or `<n>w` → seconds. Splits on the last char, not
/// byte, so non-ASCII input is a usage error rather than a panic.
fn parse_since(s: &str) -> Option<i64> {
    let unit = s.chars().last()?;
    let num = &s[..s.len() - unit.len_utf8()];
    let n: i64 = num.parse().ok().filter(|n| *n > 0)?;
    let per = match unit {
        'h' => 3600,
        'd' => 86_400,
        'w' => 7 * 86_400,
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
    let scan = refresh(&mut cache.records, &sources(&home), cutoff, &agents);
    if let Err(e) = save_cache(&cache_path, &cache) {
        eprintln!(
            "{} could not write {}: {e}",
            super::output::error_prefix(color, "konductor metrics: warning:"),
            cache_path.display()
        );
    }

    let (counted, unparsed) = select(&cache.records, cutoff);

    let ctx = report::Context {
        since: &since,
        by,
        agents_known: agents
            .values()
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        unparsed,
        unreadable: scan.unreadable,
        stale: scan.reparse_failed,
        unreadable_cache_lines: cache.unreadable_lines.len(),
        home: &home,
    };
    if json {
        println!("{}", report::render_json(&counted, &ctx));
    } else {
        print!("{}", report::render_text(&counted, &ctx, color));
    }
    0
}

/// Recorded agent name → Konductor agent name. Covers every CLI install
/// (each tracked target, plus `$HOME` in case the index predates it) and
/// the Claude Code marketplace plugin, whose agents are recorded as
/// `<plugin>:<agent>`.
fn konductor_agent_names(home: &Path) -> BTreeMap<String, String> {
    konductor_agent_names_in(home, &env_dir("CLAUDE_CONFIG_DIR", home, ".claude"))
}

fn konductor_agent_names_in(home: &Path, claude_dir: &Path) -> BTreeMap<String, String> {
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
    let mut names: BTreeMap<String, String> = roots
        .iter()
        .flat_map(|r| super::telemetry_hook::installed_agent_names(r))
        .map(|n| (n.clone(), n))
        .collect();
    for (plugin, agent) in plugin_agent_names(&claude_dir.join("plugins")) {
        names.insert(format!("{plugin}:{agent}"), agent);
    }
    names
}

/// The published marketplace plugin's name (`.claude-plugin/marketplace.json`).
const KONDUCTOR_PLUGIN: &str = "konductor";

#[derive(serde::Deserialize)]
struct InstalledPlugins {
    #[serde(default)]
    plugins: BTreeMap<String, Vec<InstalledPlugin>>,
}

#[derive(serde::Deserialize)]
struct InstalledPlugin {
    #[serde(rename = "installPath")]
    install_path: Option<PathBuf>,
}

/// `(plugin, agent)` for each agent of an installed Konductor plugin, read
/// from `installed_plugins.json` (keys are `<plugin>@<marketplace>`) and
/// each install's `agents/*.md`, the same way the plugin's own telemetry
/// hook names them.
fn plugin_agent_names(plugins_dir: &Path) -> Vec<(String, String)> {
    let Some(installed) = std::fs::read(plugins_dir.join("installed_plugins.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<InstalledPlugins>(&b).ok())
    else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (key, installs) in installed.plugins {
        let plugin = key.split('@').next().unwrap_or_default();
        if plugin != KONDUCTOR_PLUGIN {
            continue;
        }
        for path in installs.into_iter().filter_map(|i| i.install_path) {
            for file in children(&path.join("agents")) {
                let Some(name) = file.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                if let Some(agent) = name
                    .strip_suffix(".md")
                    .filter(|a| !a.is_empty() && !a.starts_with('_'))
                {
                    out.push((plugin.to_string(), agent.to_string()));
                }
            }
        }
    }
    out
}

/// Records to report, plus how many in-window files couldn't be parsed.
/// Records without session timestamps (unparsed files, stubs) fall back
/// to the file's mtime, so a format change still shows up in the footer.
fn select(cache: &HashMap<String, Record>, cutoff: i64) -> (Vec<&Record>, usize) {
    let in_window: Vec<&Record> = cache
        .values()
        .filter(|r| r.last_ts.unwrap_or(r.mtime as i64) >= cutoff)
        .collect();
    let unparsed = in_window
        .iter()
        .filter(|r| r.status == Status::Unparsed)
        .count();
    let counted = in_window
        .into_iter()
        .filter(|r| r.status == Status::Ok && r.konductor_agent.is_some() && !r.models.is_empty())
        .collect();
    (counted, unparsed)
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
    sources_in(
        &env_dir("CLAUDE_CONFIG_DIR", home, ".claude"),
        &env_dir("KIRO_HOME", home, ".kiro"),
    )
}

fn sources_in(claude_dir: &Path, kiro_dir: &Path) -> Vec<Source> {
    let mut out = Vec::new();
    let claude_projects = claude_dir.join("projects");
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
    let kiro_sessions = kiro_dir.join("sessions");
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
    /// Konductor files whose re-parse failed; their earlier record is kept.
    reparse_failed: usize,
}

/// Parses each in-window source whose (mtime, size) changed since it was
/// cached. Records for files the harness has since deleted are kept.
fn refresh(
    cache: &mut HashMap<String, Record>,
    sources: &[Source],
    cutoff: i64,
    agents: &BTreeMap<String, String>,
) -> ScanOutcome {
    // A stub cached before its agent was installed must be re-parsed.
    cache.retain(|_, r| {
        r.konductor_agent.is_some() || !r.agent.as_ref().is_some_and(|a| agents.contains_key(a))
    });
    let (mut unreadable, mut reparse_failed) = (0, 0);
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
        let prev = cache.get(&key);
        if prev.is_some_and(|p| {
            p.mtime == mtime && p.size == meta.len() && p.parser_version == PARSER_VERSION
        }) {
            continue;
        }
        // A resumed or rewritten file keeps the attribution it had, even
        // if its agent has since been renamed or uninstalled.
        let prev_match = prev.and_then(|p| p.konductor_agent.clone().map(|k| (p.agent.clone(), k)));
        let mut rec = match src.harness {
            Harness::Claude => collect::collect_claude(&src.path, mtime, meta.len()),
            Harness::KiroCliV2 => collect::collect_kiro_v2(&src.path, mtime, meta.len()),
            Harness::KiroV3 => collect::collect_kiro_v3(&src.path, mtime, meta.len()),
        };
        // A read mid-rewrite, or a format this parser can't read, must not
        // wipe a good record. Keep it unchanged so the next run retries.
        if rec.status == Status::Unparsed && prev.is_some_and(|p| p.konductor_agent.is_some()) {
            reparse_failed += 1;
            continue;
        }
        // Attribution is fixed at parse time, so renaming or uninstalling
        // an agent later doesn't drop its history. Usage from
        // non-Konductor sessions is never stored.
        rec.konductor_agent = rec
            .agent
            .as_ref()
            .and_then(|a| agents.get(a))
            .cloned()
            .or_else(|| {
                prev_match
                    .filter(|(agent, _)| *agent == rec.agent)
                    .map(|(_, k)| k)
            });
        if rec.konductor_agent.is_none() {
            rec = rec.into_stub();
        }
        cache.insert(key, rec);
    }
    // A stub only exists to skip re-parsing its file; once the harness
    // deletes the file there is nothing left to skip.
    cache.retain(|path, r| r.konductor_agent.is_some() || Path::new(path).exists());
    ScanOutcome {
        unreadable,
        reparse_failed,
    }
}

/// The record cache, plus any lines it couldn't read. Those are written
/// back verbatim: they may hold history whose source files are gone, so
/// they're kept rather than silently dropped on the next save.
#[derive(Default)]
struct Cache {
    records: HashMap<String, Record>,
    unreadable_lines: Vec<String>,
}

fn load_cache(path: &Path) -> Cache {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Cache::default();
    };
    let mut cache = Cache::default();
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        match serde_json::from_str::<Record>(line) {
            Ok(r) => {
                cache.records.insert(r.path.clone(), r);
            }
            Err(_) => cache.unreadable_lines.push(line.to_string()),
        }
    }
    cache
}

/// Owner-only: records hold repo paths and session timing.
const CACHE_FILE_MODE: u32 = 0o600;
const CACHE_DIR_MODE: u32 = 0o700;

fn save_cache(path: &Path, cache: &Cache) -> std::io::Result<()> {
    use std::os::unix::fs::{DirBuilderExt as _, PermissionsExt as _};
    if let Some(dir) = path.parent() {
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(CACHE_DIR_MODE)
            .create(dir)?;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(CACHE_DIR_MODE))?;
    }
    let mut keys: Vec<&String> = cache.records.keys().collect();
    keys.sort();
    let mut out = String::new();
    for k in keys {
        out.push_str(&serde_json::to_string(&cache.records[k]).map_err(std::io::Error::other)?);
        out.push('\n');
    }
    for line in &cache.unreadable_lines {
        out.push_str(line);
        out.push('\n');
    }
    super::atomic_write::write_atomic_with_mode(path, out.as_bytes(), CACHE_FILE_MODE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_since_windows() {
        assert_eq!(parse_since("24h"), Some(86_400));
        assert_eq!(parse_since("7d"), Some(7 * 86_400));
        assert_eq!(parse_since("2w"), Some(14 * 86_400));
        for bad in ["", "d", "0d", "-1d", "7", "7m", "1.5d", "7日", "7€", "日"] {
            assert_eq!(parse_since(bad), None, "{bad}");
        }
    }

    fn rec(agent: &str, matched: bool) -> Record {
        let mut r = collect::tests_support::record(agent);
        if !matched {
            r.konductor_agent = None;
        }
        r
    }

    #[test]
    fn stub_is_reparsed_once_its_agent_becomes_konductor() {
        let agents = BTreeMap::from([("k-dev".to_string(), "k-dev".to_string())]);
        let mut cache = HashMap::from([
            ("stub".to_string(), rec("k-dev", false)),
            ("other".to_string(), rec("claude", false)),
            ("kept".to_string(), rec("k-dev", true)),
            ("uninstalled-since".to_string(), rec("k-old", true)),
        ]);
        refresh(&mut cache, &[], 0, &agents);
        assert!(!cache.contains_key("stub"));
        assert!(
            !cache.contains_key("other"),
            "stub whose file is gone is pruned"
        );
        assert!(cache.contains_key("kept"));
        assert!(
            cache.contains_key("uninstalled-since"),
            "attribution is fixed at parse time"
        );
    }

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "konductor-metrics-{name}-{}",
            crate::cli::atomic_write::unique_suffix()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn put(path: &Path, body: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    const KONDUCTOR_LINE: &str = r#"{"type":"agent-setting","agentSetting":"k-dev","cwd":"/secret/repo","timestamp":"2026-11-01T10:00:00Z"}
{"type":"assistant","timestamp":"2026-11-01T10:00:01Z","message":{"id":"m","model":"claude-opus-5-5","usage":{"input_tokens":1,"output_tokens":2}}}"#;

    fn claude_source(path: &Path) -> Vec<Source> {
        vec![Source {
            harness: Harness::Claude,
            path: path.to_path_buf(),
        }]
    }

    fn agents() -> BTreeMap<String, String> {
        BTreeMap::from([("k-dev".to_string(), "k-dev".to_string())])
    }

    #[test]
    fn non_konductor_file_is_cached_as_a_bare_stub() {
        let d = tmp("refresh-stub");
        let f = d.join("projects/p/s.jsonl");
        put(&f, &KONDUCTOR_LINE.replace("k-dev", "someone-else"));
        let mut cache = HashMap::new();
        refresh(&mut cache, &claude_source(&f), 0, &agents());
        let r = &cache[&f.to_string_lossy().into_owned()];
        assert_eq!(r.konductor_agent, None);
        assert!(
            r.models.is_empty(),
            "usage of non-Konductor sessions is never stored"
        );
        assert_eq!(
            (r.repo.as_deref(), r.first_ts, r.last_ts),
            (None, None, None)
        );
        assert!(r.session_id.is_empty());
        assert_eq!(r.agent.as_deref(), Some("someone-else"));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn unchanged_file_is_not_reparsed() {
        let d = tmp("refresh-unchanged");
        let f = d.join("projects/p/s.jsonl");
        put(&f, KONDUCTOR_LINE);
        let mut cache = HashMap::new();
        refresh(&mut cache, &claude_source(&f), 0, &agents());
        let key = f.to_string_lossy().into_owned();
        assert_eq!(cache[&key].models[0].output_tokens, Some(2));
        cache.get_mut(&key).unwrap().session_id = "sentinel".into();
        refresh(&mut cache, &claude_source(&f), 0, &agents());
        assert_eq!(cache[&key].session_id, "sentinel");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn rewritten_file_keeps_attribution_after_its_agent_is_uninstalled() {
        let d = tmp("refresh-carry");
        let f = d.join("projects/p/s.jsonl");
        put(&f, KONDUCTOR_LINE);
        let mut cache = HashMap::new();
        refresh(&mut cache, &claude_source(&f), 0, &agents());
        put(&f, &format!("{KONDUCTOR_LINE}\n"));
        refresh(&mut cache, &claude_source(&f), 0, &BTreeMap::new());
        let r = &cache[&f.to_string_lossy().into_owned()];
        assert_eq!(r.konductor_agent.as_deref(), Some("k-dev"));
        assert_eq!(r.models[0].output_tokens, Some(2));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn failed_reparse_keeps_the_earlier_konductor_record() {
        let d = tmp("refresh-reparse-fail");
        let f = d.join("projects/p/s.jsonl");
        put(&f, KONDUCTOR_LINE);
        let mut cache = HashMap::new();
        refresh(&mut cache, &claude_source(&f), 0, &agents());
        put(
            &f,
            &format!("{KONDUCTOR_LINE}\n{{\"type\":\"assistant\",\"usage\":"),
        );
        let outcome = refresh(&mut cache, &claude_source(&f), 0, &agents());
        assert_eq!(outcome.reparse_failed, 1);
        let r = &cache[&f.to_string_lossy().into_owned()];
        assert_eq!(r.status, Status::Ok);
        assert_eq!(r.konductor_agent.as_deref(), Some("k-dev"));
        assert_eq!(r.models[0].output_tokens, Some(2));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn records_from_an_older_parser_are_reparsed() {
        let d = tmp("refresh-parser-version");
        let f = d.join("projects/p/s.jsonl");
        put(&f, KONDUCTOR_LINE);
        let mut cache = HashMap::new();
        refresh(&mut cache, &claude_source(&f), 0, &agents());
        let key = f.to_string_lossy().into_owned();
        let r = cache.get_mut(&key).unwrap();
        r.session_id = "sentinel".into();
        r.parser_version = PARSER_VERSION - 1;
        refresh(&mut cache, &claude_source(&f), 0, &agents());
        assert_eq!(cache[&key].session_id, "s");
        assert_eq!(cache[&key].parser_version, PARSER_VERSION);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn cache_round_trips_keeps_unreadable_lines_and_is_owner_only() {
        use std::os::unix::fs::PermissionsExt as _;
        let d = tmp("cache-round-trip");
        let path = d.join("usage/records.jsonl");
        let mut cache = Cache::default();
        for key in ["/b", "/a"] {
            let mut r = rec("k-dev", true);
            r.path = key.to_string();
            cache.records.insert(key.to_string(), r);
        }
        cache
            .unreadable_lines
            .push("{ from a future version".to_string());
        save_cache(&path, &cache).unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert!(
            lines[0].contains("\"path\":\"/a\"") && lines[1].contains("\"path\":\"/b\""),
            "sorted by path"
        );
        assert_eq!(lines[2], "{ from a future version");

        let loaded = load_cache(&path);
        assert_eq!(loaded.records.len(), 2);
        assert_eq!(loaded.records["/a"], cache.records["/a"]);
        assert_eq!(
            loaded.unreadable_lines,
            vec!["{ from a future version".to_string()]
        );

        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&path), 0o600);
        assert_eq!(mode(&d.join("usage")), 0o700);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn agent_names_merge_indexed_installs_home_and_plugin() {
        let d = tmp("agent-names");
        let (home, other, claude) = (d.join("home"), d.join("repo"), d.join("claude"));
        let manifest = |agent_path: &str| {
            serde_json::json!({"schema_version": 2, "strategies": [{
                "strategy": "claude", "installed_at": "2026-01-01T00:00:00Z", "destination": ".",
                "source": "test", "status": "complete",
                "files": [{"path": agent_path, "sha256": "0".repeat(64), "provenance": "replaced_ours"}]
            }]})
            .to_string()
        };
        put(
            &home.join(".konductor/manifest"),
            &manifest(".kiro/agents/konductor.json"),
        );
        put(
            &other.join(".konductor/manifest"),
            &manifest(".claude/agents/k-developer.md"),
        );
        let index = serde_json::json!({"schema_version": 2, "installs": [{
            "target_dir": other, "strategies": ["claude"], "installed_at": "2026-01-01T00:00:00Z", "status": "complete"
        }]});
        put(&home.join(".konductor/installs"), &index.to_string());
        let install = claude.join("plugins/cache/konductor/konductor/1.0.0");
        put(&install.join("agents/k-researcher.md"), "");
        let installed =
            serde_json::json!({"plugins": {"konductor@konductor": [{"installPath": install}]}});
        put(
            &claude.join("plugins/installed_plugins.json"),
            &installed.to_string(),
        );

        let names = konductor_agent_names_in(&home, &claude);
        assert_eq!(
            names.get("konductor").map(String::as_str),
            Some("konductor"),
            "$HOME fallback"
        );
        assert_eq!(
            names.get("k-developer").map(String::as_str),
            Some("k-developer"),
            "indexed install"
        );
        assert_eq!(
            names.get("konductor:k-researcher").map(String::as_str),
            Some("k-researcher"),
            "plugin"
        );
        assert!(
            !names.contains_key("k-researcher"),
            "plugin agents only match in <plugin>:<agent> form"
        );
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn sources_cover_all_three_harness_layouts() {
        let d = tmp("sources");
        let (claude, kiro) = (d.join("claude"), d.join("kiro"));
        for p in [
            claude.join("projects/p/s1.jsonl"),
            claude.join("projects/p/s1/subagents/agent-a.jsonl"),
            claude.join("projects/p/s1/subagents/agent-a.meta.json"),
            kiro.join("sessions/cli/abc.json"),
            kiro.join("sessions/cli/abc.jsonl"),
            kiro.join("sessions/ws1/sess_1/messages.jsonl"),
            kiro.join("sessions/ws1/sess_1/session.json"),
        ] {
            put(&p, "");
        }
        let mut found: Vec<(Harness, String)> = sources_in(&claude, &kiro)
            .into_iter()
            .map(|s| {
                (
                    s.harness,
                    s.path.strip_prefix(&d).unwrap().display().to_string(),
                )
            })
            .collect();
        found.sort_by(|a, b| a.1.cmp(&b.1));
        assert_eq!(
            found,
            vec![
                (Harness::Claude, "claude/projects/p/s1.jsonl".to_string()),
                (
                    Harness::Claude,
                    "claude/projects/p/s1/subagents/agent-a.jsonl".to_string()
                ),
                (Harness::KiroCliV2, "kiro/sessions/cli/abc.json".to_string()),
                (
                    Harness::KiroV3,
                    "kiro/sessions/ws1/sess_1/messages.jsonl".to_string()
                ),
            ]
        );
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn unparseable_file_in_window_is_counted_by_mtime() {
        let d = tmp("select-unparsed");
        let f = d.join("sessions/cli/bad.json");
        put(&f, "{ not the v2 shape");
        let sources = vec![Source {
            harness: Harness::KiroCliV2,
            path: f.clone(),
        }];
        let mut cache = HashMap::new();
        refresh(&mut cache, &sources, 0, &agents());
        let mtime = cache[&f.to_string_lossy().into_owned()].mtime as i64;
        assert_eq!(select(&cache, mtime - 60).1, 1);
        assert_eq!(select(&cache, mtime + 60).1, 0);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn plugin_agents_are_read_from_installed_plugins() {
        let d = std::env::temp_dir().join(format!(
            "konductor-metrics-plugins-{}",
            crate::cli::atomic_write::unique_suffix()
        ));
        let install = d.join("cache/konductor/konductor/1.0.0");
        std::fs::create_dir_all(install.join("agents")).unwrap();
        for f in ["k-developer.md", "_shared.md", "notes.txt"] {
            std::fs::write(install.join("agents").join(f), "").unwrap();
        }
        let other = d.join("cache/x/other/1");
        std::fs::create_dir_all(other.join("agents")).unwrap();
        std::fs::write(other.join("agents/k-developer.md"), "").unwrap();
        let installed = serde_json::json!({ "version": 2, "plugins": {
            "konductor@konductor": [{ "installPath": install }],
            "other@x": [{ "installPath": other }]
        }});
        std::fs::write(d.join("installed_plugins.json"), installed.to_string()).unwrap();
        assert_eq!(
            plugin_agent_names(&d),
            vec![("konductor".to_string(), "k-developer".to_string())]
        );
        std::fs::remove_dir_all(&d).ok();
    }
}
