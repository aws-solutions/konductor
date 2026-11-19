// SPDX-License-Identifier: Apache-2.0
//
// metrics/report.rs — groups records and renders them. Each harness gets
// its own table in its native unit; tokens and credits are never summed.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::Path;

use serde::Serialize;

use super::collect::{Harness, ModelUsage, Record};
use super::GroupBy;
use crate::cli::output::ColorMode;

pub(super) struct Context<'a> {
    pub since: &'a str,
    pub by: GroupBy,
    pub agents_known: usize,
    pub unparsed: usize,
    pub unreadable: usize,
    /// Changed files whose re-parse failed; their last good record is shown.
    pub stale: usize,
    pub unreadable_cache_lines: usize,
    pub home: &'a Path,
}

#[derive(Debug, Default, Clone, Serialize, PartialEq)]
struct Row {
    key: String,
    files: u64,
    subagent_runs: Option<u64>,
    requests: u64,
    input_tokens: Option<u64>,
    cache_write_tokens: Option<u64>,
    cache_read_tokens: Option<u64>,
    output_tokens: Option<u64>,
    thinking_tokens: Option<u64>,
    web_search_requests: Option<u64>,
    credits: Option<f64>,
}

impl Row {
    fn add_model(&mut self, m: &ModelUsage) {
        self.requests += m.requests;
        sum(&mut self.input_tokens, m.input_tokens);
        sum(&mut self.cache_write_tokens, m.cache_write_tokens);
        sum(&mut self.cache_read_tokens, m.cache_read_tokens);
        sum(&mut self.output_tokens, m.output_tokens);
        sum(&mut self.thinking_tokens, m.thinking_tokens);
        sum(&mut self.web_search_requests, m.web_search_requests);
        if let Some(c) = m.credits {
            self.credits = Some(self.credits.unwrap_or(0.0) + c);
        }
    }

    fn add_row(&mut self, r: &Row) {
        self.files += r.files;
        sum(&mut self.subagent_runs, r.subagent_runs);
        self.add_model(&ModelUsage {
            model: String::new(),
            requests: r.requests,
            input_tokens: r.input_tokens,
            cache_write_tokens: r.cache_write_tokens,
            cache_read_tokens: r.cache_read_tokens,
            output_tokens: r.output_tokens,
            thinking_tokens: r.thinking_tokens,
            web_search_requests: r.web_search_requests,
            credits: r.credits,
        });
    }

    fn total_tokens(&self) -> u64 {
        [
            self.input_tokens,
            self.cache_write_tokens,
            self.cache_read_tokens,
            self.output_tokens,
        ]
        .iter()
        .map(|v| v.unwrap_or(0))
        .sum()
    }
}

/// `None + None` stays `None` so "not recorded" survives aggregation.
fn sum(slot: &mut Option<u64>, v: Option<u64>) {
    if let Some(v) = v {
        *slot = Some(slot.unwrap_or(0) + v);
    }
}

#[derive(Debug, Serialize)]
struct Table {
    harness: &'static str,
    unit: &'static str,
    rows: Vec<Row>,
    total: Row,
}

fn day(ts: Option<i64>) -> String {
    let Some(ts) = ts else {
        return "(unknown)".into();
    };
    let (y, m, d) = crate::cli::time::civil_from_days(ts.div_euclid(86_400));
    format!("{y:04}-{m:02}-{d:02}")
}

fn repo_label(repo: Option<&str>, home: &Path) -> String {
    let Some(repo) = repo else {
        return "(unknown)".into();
    };
    match Path::new(repo).strip_prefix(home) {
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => repo.to_string(),
    }
}

fn tables(records: &[&Record], ctx: &Context) -> Vec<Table> {
    let mut out = Vec::new();
    for harness in [Harness::Claude, Harness::KiroCliV2, Harness::KiroV3] {
        let mut rows: BTreeMap<String, Row> = BTreeMap::new();
        for rec in records.iter().filter(|r| r.harness == harness) {
            let fixed_key = match ctx.by {
                GroupBy::Agent => Some(rec.konductor_agent.clone().unwrap_or_default()),
                GroupBy::Day => Some(day(rec.first_ts)),
                GroupBy::Repo => Some(repo_label(rec.repo.as_deref(), ctx.home)),
                GroupBy::Model => None,
            };
            let mut touched = Vec::new();
            for m in &rec.models {
                let key = fixed_key.clone().unwrap_or_else(|| m.model.clone());
                rows.entry(key.clone())
                    .or_insert_with(|| Row {
                        key: key.clone(),
                        ..Default::default()
                    })
                    .add_model(m);
                if !touched.contains(&key) {
                    touched.push(key);
                }
            }
            if touched.is_empty() {
                if let Some(key) = fixed_key {
                    rows.entry(key.clone()).or_insert_with(|| Row {
                        key: key.clone(),
                        ..Default::default()
                    });
                    touched.push(key);
                }
            }
            for key in touched {
                let row = rows.get_mut(&key).expect("row inserted above");
                row.files += 1;
                sum(&mut row.subagent_runs, rec.subagent_runs);
            }
        }
        if rows.is_empty() {
            continue;
        }
        let mut rows: Vec<Row> = rows.into_values().collect();
        if ctx.by != GroupBy::Day {
            rows.sort_by(|a, b| {
                b.total_tokens()
                    .cmp(&a.total_tokens())
                    .then(
                        b.credits
                            .unwrap_or(0.0)
                            .total_cmp(&a.credits.unwrap_or(0.0)),
                    )
                    .then(a.key.cmp(&b.key))
            });
        }
        let mut total = Row {
            key: "total".into(),
            ..Default::default()
        };
        for r in &rows {
            total.add_row(r);
        }
        // With --by model one record spans several rows, so count records,
        // not row sums.
        let harness_records: Vec<&&Record> =
            records.iter().filter(|r| r.harness == harness).collect();
        total.files = harness_records.len() as u64;
        total.subagent_runs = harness_records
            .iter()
            .filter_map(|r| r.subagent_runs)
            .reduce(|a, b| a + b);
        out.push(Table {
            harness: harness.as_str(),
            unit: if harness == Harness::Claude {
                "tokens"
            } else {
                "credits"
            },
            rows,
            total,
        });
    }
    out
}

fn human(n: Option<u64>) -> String {
    let Some(n) = n else { return "—".into() };
    if n < 1_000 {
        return n.to_string();
    }
    // Pick the unit by the rounded value, so 999_950 is "1.0M", not "1000.0K".
    let f = n as f64;
    for (scale, suffix) in [(1e3, "K"), (1e6, "M")] {
        let v = f / scale;
        if (v * 10.0).round() / 10.0 < 1000.0 {
            return format!("{v:.1}{suffix}");
        }
    }
    format!("{:.1}B", f / 1e9)
}

fn credits(c: Option<f64>) -> String {
    c.map_or_else(|| "—".into(), |c| format!("{c:.2}"))
}

fn pct(part: u64, whole: u64) -> String {
    if whole == 0 {
        return "—".into();
    }
    format!("{:.0}%", part as f64 * 100.0 / whole as f64)
}

fn by_label(by: GroupBy) -> &'static str {
    match by {
        GroupBy::Agent => "agent",
        GroupBy::Model => "model",
        GroupBy::Day => "day",
        GroupBy::Repo => "repo",
    }
}

fn harness_title(h: &str) -> &'static str {
    match h {
        "claude" => "Claude Code (tokens)",
        "kiro-cli-v2" => "Kiro CLI v2 (credits)",
        _ => "Kiro v3 (credits)",
    }
}

pub(super) fn render_text(records: &[&Record], ctx: &Context, color: ColorMode) -> String {
    let dim = |s: &str| crate::cli::output::status::dim(color, s);
    let mut out = String::new();
    if ctx.agents_known == 0 {
        let _ = writeln!(
            out,
            "No Konductor install found; run `konductor install` first."
        );
        return out;
    }
    let tables = tables(records, ctx);
    let _ = writeln!(
        out,
        "Konductor usage, last {}, by {}\n",
        ctx.since,
        by_label(ctx.by)
    );
    if tables.is_empty() {
        let _ = writeln!(out, "No Konductor sessions in this window.");
    }
    let key_w = tables
        .iter()
        .flat_map(|t| t.rows.iter().map(|r| r.key.chars().count()))
        .max()
        .unwrap_or(5)
        .clamp(12, 48);
    for t in &tables {
        let _ = writeln!(out, "{}", harness_title(t.harness));
        if t.harness == "claude" {
            let _ = writeln!(
                out,
                "  {:<key_w$} {:>6} {:>9} {:>8} {:>9} {:>9} {:>8}",
                by_label(ctx.by),
                "files",
                "requests",
                "input",
                "cache-wr",
                "cache-rd",
                "output"
            );
            for r in t.rows.iter().chain(std::iter::once(&t.total)) {
                let _ = writeln!(
                    out,
                    "  {:<key_w$} {:>6} {:>9} {:>8} {:>9} {:>9} {:>8}",
                    truncate(&r.key, key_w),
                    r.files,
                    r.requests,
                    human(r.input_tokens),
                    human(r.cache_write_tokens),
                    human(r.cache_read_tokens),
                    human(r.output_tokens)
                );
            }
            let tot = &t.total;
            let all_input = tot.input_tokens.unwrap_or(0)
                + tot.cache_write_tokens.unwrap_or(0)
                + tot.cache_read_tokens.unwrap_or(0);
            let _ = writeln!(
                out,
                "  {}",
                dim(&format!(
                    "cache-read share of input {} · thinking {} of output · web searches {}",
                    pct(tot.cache_read_tokens.unwrap_or(0), all_input),
                    pct(
                        tot.thinking_tokens.unwrap_or(0),
                        tot.output_tokens.unwrap_or(0)
                    ),
                    tot.web_search_requests.unwrap_or(0)
                ))
            );
        } else {
            let v3 = t.harness == "kiro-v3";
            // Kiro v2 subagents are separate session files, so only v3
            // has a subagent-runs column.
            let subs_col = |s: &str| {
                if v3 {
                    format!(" {s:>9}")
                } else {
                    String::new()
                }
            };
            let _ = writeln!(
                out,
                "  {:<key_w$} {:>8}{} {:>9} {:>9}",
                by_label(ctx.by),
                "sessions",
                subs_col("subagents"),
                if v3 { "turns" } else { "requests" },
                "credits"
            );
            for r in t.rows.iter().chain(std::iter::once(&t.total)) {
                let _ = writeln!(
                    out,
                    "  {:<key_w$} {:>8}{} {:>9} {:>9}",
                    truncate(&r.key, key_w),
                    r.files,
                    subs_col(&r.subagent_runs.unwrap_or(0).to_string()),
                    r.requests,
                    credits(r.credits)
                );
            }
            if v3 {
                let _ = writeln!(
                    out,
                    "  {}",
                    dim("subagent credits can't be split from the parent session, and whether the parent includes them is unverified (#289)")
                );
            }
        }
        let _ = writeln!(out);
    }
    let mut notes = Vec::new();
    if ctx.unparsed > 0 {
        notes.push(format!(
            "{} session files could not be parsed (unknown format)",
            ctx.unparsed
        ));
    }
    if ctx.unreadable > 0 {
        notes.push(format!(
            "{} session files could not be read",
            ctx.unreadable
        ));
    }
    if ctx.stale > 0 {
        notes.push(format!(
            "{} session files changed but could not be re-read; their last good data is shown",
            ctx.stale
        ));
    }
    if ctx.unreadable_cache_lines > 0 {
        notes.push(format!(
            "{} cache lines could not be read and were kept as-is",
            ctx.unreadable_cache_lines
        ));
    }
    if !tables.is_empty() {
        notes.push(
            "Usage is counted per whole session: a session active in the window counts in full, dated by its start"
                .into(),
        );
    }
    if tables.iter().any(|t| t.harness == "claude") {
        notes.push(
            "Claude Code main sessions count only when started with `claude --agent <name>`".into(),
        );
        notes.push(
            "Claude Code subagent output tokens are excluded: their transcripts record placeholder values"
                .into(),
        );
    }
    notes.push(
        "Native units only: tokens and credits are never summed. Local data; nothing is sent."
            .into(),
    );
    for n in notes {
        let _ = writeln!(out, "{}", dim(&n));
    }
    out
}

fn truncate(s: &str, w: usize) -> String {
    if s.chars().count() <= w {
        return s.to_string();
    }
    let keep: String = s
        .chars()
        .rev()
        .take(w - 1)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("…{keep}")
}

pub(super) fn render_json(records: &[&Record], ctx: &Context) -> String {
    let doc = serde_json::json!({
        "since": ctx.since,
        "by": by_label(ctx.by),
        "konductor_agents_known": ctx.agents_known,
        "harnesses": tables(records, ctx),
        "unparsed_files": ctx.unparsed,
        "unreadable_files": ctx.unreadable,
        "stale_files": ctx.stale,
        "unreadable_cache_lines": ctx.unreadable_cache_lines,
    });
    serde_json::to_string_pretty(&doc).unwrap_or_else(|_| "{}".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(h: Harness, agent: &str, models: Vec<ModelUsage>) -> Record {
        let mut r = crate::cli::metrics::collect::tests_support::record(agent);
        r.harness = h;
        r.models = models;
        r.first_ts = Some(0);
        r
    }

    fn tokens(model: &str, out: u64) -> ModelUsage {
        ModelUsage {
            model: model.into(),
            requests: 1,
            input_tokens: Some(1),
            cache_write_tokens: Some(0),
            cache_read_tokens: Some(10),
            output_tokens: Some(out),
            thinking_tokens: Some(0),
            web_search_requests: Some(0),
            credits: None,
        }
    }

    fn ctx(by: GroupBy) -> Context<'static> {
        Context {
            since: "7d",
            by,
            agents_known: 1,
            unparsed: 0,
            unreadable: 0,
            stale: 0,
            unreadable_cache_lines: 0,
            home: Path::new("/h"),
        }
    }

    fn kiro(credits: f64) -> ModelUsage {
        ModelUsage {
            model: "m".into(),
            requests: 2,
            credits: Some(credits),
            ..Default::default()
        }
    }

    #[test]
    fn human_and_pct_boundaries() {
        for (n, want) in [
            (None, "—"),
            (Some(0), "0"),
            (Some(999), "999"),
            (Some(1_000), "1.0K"),
            (Some(999_949), "999.9K"),
            (Some(999_950), "1.0M"),
            (Some(999_950_000), "1.0B"),
        ] {
            assert_eq!(human(n), want, "{n:?}");
        }
        assert_eq!(pct(1, 0), "—");
        assert_eq!(pct(1, 4), "25%");
    }

    #[test]
    fn render_text_without_an_install_says_so() {
        let mut c = ctx(GroupBy::Agent);
        c.agents_known = 0;
        assert!(render_text(&[], &c, ColorMode::disabled()).contains("No Konductor install found"));
    }

    #[test]
    fn render_text_empty_window_and_footer_counts() {
        let mut c = ctx(GroupBy::Agent);
        (c.unparsed, c.unreadable, c.stale, c.unreadable_cache_lines) = (2, 3, 4, 5);
        let out = render_text(&[], &c, ColorMode::disabled());
        assert!(out.contains("No Konductor sessions in this window."));
        for note in [
            "2 session files could not be parsed",
            "3 session files could not be read",
            "4 session files changed but could not be re-read",
            "5 cache lines could not be read",
        ] {
            assert!(out.contains(note), "missing {note:?} in:\n{out}");
        }
    }

    #[test]
    fn render_text_kiro_tables_and_long_keys() {
        let long = "k-".to_string() + &"x".repeat(80);
        let v2 = rec(Harness::KiroCliV2, &long, vec![kiro(1.5)]);
        let mut v3 = rec(Harness::KiroV3, "konductor", vec![kiro(0.25)]);
        v3.subagent_runs = Some(3);
        let out = render_text(&[&v2, &v3], &ctx(GroupBy::Agent), ColorMode::disabled());
        let v2_header = out
            .lines()
            .skip_while(|l| !l.starts_with("Kiro CLI v2"))
            .nth(1)
            .unwrap();
        assert!(!v2_header.contains("subagents"), "{v2_header}");
        assert!(out.contains("subagents") && out.contains("turns"));
        assert!(out.contains("#289"), "v3 note");
        assert!(
            out.contains('…') && !out.contains(&long),
            "long key truncated"
        );
        assert!(out.contains("counted per whole session"));
    }

    #[test]
    fn harnesses_get_separate_tables_and_units_never_mix() {
        let a = rec(Harness::Claude, "konductor", vec![tokens("opus", 5)]);
        let b = rec(
            Harness::KiroV3,
            "konductor",
            vec![ModelUsage {
                model: "m".into(),
                requests: 2,
                credits: Some(1.5),
                ..Default::default()
            }],
        );
        let t = tables(&[&a, &b], &ctx(GroupBy::Agent));
        assert_eq!(t.len(), 2);
        assert_eq!(t[0].unit, "tokens");
        assert_eq!(t[0].total.credits, None);
        assert_eq!(t[1].unit, "credits");
        assert_eq!(t[1].total.output_tokens, None);
        assert_eq!(t[1].total.credits, Some(1.5));
    }

    #[test]
    fn by_model_splits_one_record_into_model_rows() {
        let a = rec(
            Harness::Claude,
            "konductor",
            vec![tokens("opus", 5), tokens("haiku", 1)],
        );
        let t = tables(&[&a], &ctx(GroupBy::Model));
        assert_eq!(t[0].rows.len(), 2);
        assert_eq!(t[0].total.output_tokens, Some(6));
        assert_eq!(
            t[0].total.files, 1,
            "one session, even across two model rows"
        );
        assert_eq!(t[0].rows[0].key, "opus");
    }

    #[test]
    fn by_agent_counts_each_file_once() {
        let a = rec(
            Harness::Claude,
            "k-dev",
            vec![tokens("opus", 5), tokens("haiku", 1)],
        );
        let t = tables(&[&a], &ctx(GroupBy::Agent));
        assert_eq!(t[0].rows.len(), 1);
        assert_eq!(t[0].rows[0].files, 1);
    }

    #[test]
    fn json_output_is_valid() {
        let a = rec(Harness::Claude, "konductor", vec![tokens("opus", 5)]);
        let v: serde_json::Value =
            serde_json::from_str(&render_json(&[&a], &ctx(GroupBy::Day))).unwrap();
        assert_eq!(v["harnesses"][0]["rows"][0]["key"], "1970-01-01");
    }
}
