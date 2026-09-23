// SPDX-License-Identifier: Apache-2.0
//
// synth/parse_canonical.rs — aggregates a full source tree into one
// `CanonicalModel` (task 2.2's builder function).
//
// Walks agents/*.agent-spec.json, skills/*/SKILL.md, and
// agent-sops/*.sop.md. Aborts on the first parse failure. Rejects
// duplicate names within each collection. Sorts each output vec
// alphabetically by name for reproducible dist/ output.

use std::collections::BTreeSet;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::cli::synth::model::{AuxiliaryFile, CanonicalModel, ContextDef, SkillDef, SopDef};
use crate::cli::synth::parser::{self, ParseError};
use crate::cli::synth::path_safety::case_insensitive_fold_key;

/// Auxiliary files above this size are rejected before being read into memory.
const MAX_AUXILIARY_FILE_BYTES: u64 = 1024 * 1024;

/// Aggregates the full source tree into a single CanonicalModel.
/// Aborts on the first parse failure (structured ParseError{file,field,reason}).
///
/// Guards against a source tree that does not exist, or exists but is
/// not a directory. Without this, a nonexistent `source_dir` would
/// parse as a valid, silently-empty `CanonicalModel` (each of
/// `parse_agents`/`parse_skills`/`parse_sops`/`parse_context` treats a
/// missing subdirectory as "zero entries", a deliberate leniency for a
/// project that hasn't created one yet). Checked here in the shared
/// function so `synth`/`install --from`/`doctor` all get the same
/// protection.
///
/// Security contract: runs against untrusted source content in CI (see
/// ADR-7). `SkillDef.name`/`SopDef.name`/`ContextDef.name` are
/// validated against charset/format rules, but
/// `HarnessTransformer::transform` implementations MUST NOT use these
/// values as trusted path components without re-checking they stay
/// within the intended output directory.
pub fn parse_canonical(source_dir: &Path) -> Result<CanonicalModel, ParseError> {
    if !source_dir.exists() {
        return Err(ParseError {
            file: source_dir.display().to_string(),
            field: None,
            reason: "source_dir does not exist".to_string(),
        });
    }
    if source_dir.is_file() {
        return Err(ParseError {
            file: source_dir.display().to_string(),
            field: None,
            reason: "source_dir is a file, not a directory".to_string(),
        });
    }
    if !source_dir.is_dir() {
        return Err(ParseError {
            file: source_dir.display().to_string(),
            field: None,
            reason: "source_dir is not a directory".to_string(),
        });
    }

    let mut agents = parse_agents(&source_dir.join("agents"))?;
    let mut skills = parse_skills(&source_dir.join("skills"))?;
    let mut sops = parse_sops(&source_dir.join("agent-sops"))?;
    let mut context = parse_context(&source_dir.join("context"))?;

    agents.sort_by(|a, b| a.name.cmp(&b.name));
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    sops.sort_by(|a, b| a.name.cmp(&b.name));
    context.sort_by(|a, b| a.name.cmp(&b.name));

    check_dangling_context_references(&agents, &context)?;
    check_dangling_skill_references(&agents, &skills)?;
    check_dangling_sop_references(&agents, &sops)?;
    for warning in check_skill_scope_consistency(&agents) {
        eprintln!("konductor: warning: {warning}");
    }

    Ok(CanonicalModel {
        agents,
        skills,
        sops,
        context,
    })
}

/// Fails loudly when any agent's `contextNames` names a file with no
/// corresponding entry in `context` (parsed from the `context/`
/// directory). Silently shipping nothing for a dangling reference is
/// the exact bug this check exists to prevent -- every declared name
/// must resolve to a real file, checked here rather than left for the
/// installed agent to silently receive no context.
fn check_dangling_context_references(
    agents: &[parser::ParsedAgentSpec],
    context: &[ContextDef],
) -> Result<(), ParseError> {
    let known: BTreeSet<&str> = context.iter().map(|c| c.name.as_str()).collect();
    for agent in agents {
        for context_name in &agent.dependencies.context.context_names {
            if !known.contains(context_name.as_str()) {
                return Err(ParseError {
                    file: format!("agents/{}.agent-spec.json", agent.name),
                    field: Some("dependencies.context.contextNames".to_string()),
                    reason: format!(
                        "agent '{}' declares contextNames entry '{context_name}', \
                         but no such file exists under context/",
                        agent.name
                    ),
                });
            }
        }
    }
    Ok(())
}

/// Fails loudly when any agent's `dependencies.skills.skillNames`,
/// `clientConfig.claudeCli.skills`, or non-wildcard
/// `clientConfig.kiroCli.resources` `skill://.../<name>/SKILL.md`
/// entries name a skill with no corresponding entry in `skills/`. A
/// renamed or deleted skill still referenced by an agent spec is a
/// plausible authoring mistake that otherwise goes undetected -- checked
/// here, the same shared `parse_canonical` path
/// `check_dangling_context_references` uses, so `synth`/`install`/
/// `doctor` all benefit identically.
///
/// `dependencies.skills` is a wrapper object whose only recognized key
/// is `skillNames` (see `skill_names_from_dependencies`) -- the wrapper
/// key itself is never treated as a skill name.
///
/// A `resources` entry containing `*` is a glob (e.g. matching
/// per-workspace skills outside the canonical source tree), not a
/// single named reference, so it is skipped. Prefix matching for the
/// `skill://` case delegates to `kiro_cli_v2::match_skill_resource` --
/// the same classifier the `kiroCli` normalizer uses -- so a `skill://`
/// entry with an unrecognized prefix is treated as hand-authored/
/// external and skipped too.
fn check_dangling_skill_references(
    agents: &[parser::ParsedAgentSpec],
    skills: &[SkillDef],
) -> Result<(), ParseError> {
    let known: BTreeSet<&str> = skills.iter().map(|s| s.name.as_str()).collect();
    for agent in agents {
        for skill_name in skill_names_from_dependencies(&agent.dependencies.skills) {
            if !known.contains(skill_name) {
                return Err(ParseError {
                    file: format!("agents/{}.agent-spec.json", agent.name),
                    field: Some("dependencies.skills.skillNames".to_string()),
                    reason: format!(
                        "agent '{}' declares a dependencies.skills.skillNames entry \
                         '{skill_name}', but no such skill exists under skills/",
                        agent.name
                    ),
                });
            }
        }
        if let Some(claude_cli) = &agent.client_config.claude_cli {
            for skill_name in &claude_cli.skills {
                if !known.contains(skill_name.as_str()) {
                    return Err(ParseError {
                        file: format!("agents/{}.agent-spec.json", agent.name),
                        field: Some("clientConfig.claudeCli.skills".to_string()),
                        reason: format!(
                            "agent '{}' declares a clientConfig.claudeCli.skills entry \
                             '{skill_name}', but no such skill exists under skills/",
                            agent.name
                        ),
                    });
                }
            }
        }
        if let Some(kiro_cli) = &agent.client_config.kiro_cli {
            for resource in &kiro_cli.resources {
                let Some(skill_name) = super::kiro_cli_v2::match_skill_resource(resource) else {
                    continue;
                };
                if !known.contains(skill_name) {
                    return Err(ParseError {
                        file: format!("agents/{}.agent-spec.json", agent.name),
                        field: Some("clientConfig.kiroCli.resources".to_string()),
                        reason: format!(
                            "agent '{}' declares a clientConfig.kiroCli.resources entry \
                             '{resource}' naming skill '{skill_name}', but no such skill \
                             exists under skills/",
                            agent.name
                        ),
                    });
                }
            }
        }
    }
    Ok(())
}

/// Fails loudly when any agent's `dependencies.agentSops.agentSopNames`
/// names an SOP with no corresponding entry in `sops`. Mirrors
/// `check_dangling_context_references`/`check_dangling_skill_references`:
/// a renamed or deleted SOP still referenced by an agent spec otherwise
/// parses cleanly and ships silently. Unlike skills, SOPs have no
/// `clientConfig`-level reference surface, so `dependencies.agentSops.
/// agentSopNames` is the only surface to check.
fn check_dangling_sop_references(
    agents: &[parser::ParsedAgentSpec],
    sops: &[SopDef],
) -> Result<(), ParseError> {
    let known: BTreeSet<&str> = sops.iter().map(|s| s.name.as_str()).collect();
    for agent in agents {
        for sop_name in &agent.dependencies.agent_sops.agent_sop_names {
            if !known.contains(sop_name.as_str()) {
                return Err(ParseError {
                    file: format!("agents/{}.agent-spec.json", agent.name),
                    field: Some("dependencies.agentSops.agentSopNames".to_string()),
                    reason: format!(
                        "agent '{}' declares a dependencies.agentSops.agentSopNames entry \
                         '{sop_name}', but no such SOP exists under agent-sops/",
                        agent.name
                    ),
                });
            }
        }
    }
    Ok(())
}

/// Extracts the skill names declared under an agent's `dependencies.skills`.
/// The wire shape is a wrapper object with a single recognized key,
/// `skillNames`, whose value is a JSON array of skill directory names --
/// e.g. `{"skillNames": ["threat-modeling", "sdlc-navigator"]}`. Any
/// other key or a non-array/non-string value is ignored.
///
/// `pub(crate)`: also called from `kiro_cli_v2.rs`, which builds the
/// synth-side skill-scope sidecar (`_skill_scopes.json`) from the same
/// extraction this check uses, so the two can never define "the
/// skillNames this agent declares" differently.
pub(crate) fn skill_names_from_dependencies(
    skills: &std::collections::BTreeMap<String, Value>,
) -> impl Iterator<Item = &str> {
    skills
        .get("skillNames")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
}

/// Consistency check (new, retrofit against existing specs -- see this
/// function's own doc comment for the semantics decision) between two
/// independent skill-reference surfaces on the same agent spec:
/// `clientConfig.kiroCli.resources`' `skill://.../<name>/SKILL.md`
/// entries (see `kiro_cli_v2::match_skill_resource`; a glob such as
/// `ws-*` is never a single named reference and is skipped, matching
/// `check_dangling_skill_references`'s own treatment), and
/// `dependencies.skills.skillNames`.
///
/// Semantics decision (explicit, not silently assumed): `skillNames` is
/// documented elsewhere in this workspace (`AGENTS.md`) as the
/// Kiro-runtime allowlist that scopes which skills an agent's MCP-served
/// `SkillsTool` may return -- so a `resources` entry naming a skill
/// implies that skill should also be in the allowlist. This check
/// therefore treats `resources` as required to be a SUBSET of
/// `skillNames`: every `skill://` resource name must appear in
/// `skillNames`, but `skillNames` may legitimately list names with no
/// corresponding `resources` entry (a skill available to `SkillsTool`
/// but not preloaded as a resource is a normal, intentional shape).
///
/// Scope: this check governs `cli/konductor-rs`'s OWN build/install
/// pipeline for `ASDLCCoreAICapabilities`'s external-customer CLI
/// installs. It is unrelated to, and does not supersede, any downstream
/// internal package's own separate AIM-based install pipeline, where
/// `dependencies.skills.skillNames` may already be load-bearing via a
/// different mechanism (agent-spec composition, not this crate).
///
/// Returns human-readable warning strings, one per agent with a
/// divergence -- never a `ParseError`: this is intentionally a WARNING,
/// not a hard error, because it is being introduced retroactively
/// against existing specs that may currently have real drift. Promoting
/// it to a hard error is a decision open to revisiting once the existing
/// corpus is clean.
fn check_skill_scope_consistency(agents: &[parser::ParsedAgentSpec]) -> Vec<String> {
    let mut warnings = Vec::new();
    for agent in agents {
        let Some(kiro_cli) = &agent.client_config.kiro_cli else {
            continue;
        };
        let skill_names: BTreeSet<&str> =
            skill_names_from_dependencies(&agent.dependencies.skills).collect();
        let mut missing: BTreeSet<&str> = BTreeSet::new();
        for resource in &kiro_cli.resources {
            let Some(skill_name) = super::kiro_cli_v2::match_skill_resource(resource) else {
                continue;
            };
            if !skill_names.contains(skill_name) {
                missing.insert(skill_name);
            }
        }
        if !missing.is_empty() {
            warnings.push(format!(
                "agent '{}' declares clientConfig.kiroCli.resources skill:// entries naming \
                 {:?}, which do not appear in dependencies.skills.skillNames {:?} -- resources \
                 should be a subset of skillNames (documented in this workspace's AGENTS.md as \
                 the Kiro-runtime allowlist); add the missing name(s) to skillNames",
                agent.name,
                missing.into_iter().collect::<Vec<_>>(),
                skill_names.into_iter().collect::<Vec<_>>()
            ));
        }
    }
    warnings
}

/// Lists direct children of `dir` matching `predicate`, sorted for determinism
/// before any processing occurs. Returns an empty vec if `dir` doesn't exist.
fn list_dir_entries(
    dir: &Path,
    predicate: impl Fn(&Path) -> bool,
) -> Result<Vec<PathBuf>, ParseError> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let read_dir = fs::read_dir(dir).map_err(|e| ParseError {
        file: dir.display().to_string(),
        field: None,
        reason: format!("failed to read directory: {e}"),
    })?;
    let mut entries = Vec::new();
    for entry in read_dir {
        let entry = entry.map_err(|e| ParseError {
            file: dir.display().to_string(),
            field: None,
            reason: format!("failed to read directory entry: {e}"),
        })?;
        let path = entry.path();
        if predicate(&path) {
            entries.push(path);
        }
    }
    entries.sort();
    Ok(entries)
}

/// Checks `items` for duplicate names (via `name_of`), returning a
/// structured `ParseError` naming the offending file (from the parallel
/// `labels` slice) on the first collision. Shared by
/// `parse_agents`/`parse_skills`/`parse_sops`/`parse_context` so the
/// uniqueness check has one production code path to test.
///
/// Also rejects a CASE-INSENSITIVE collision between two otherwise-
/// distinct names (e.g. `MySkill` and `myskill`), not just an exact
/// match: every `HarnessTransformer`
/// joins these names directly into an output path (`write_skill`,
/// `write_agent_file`, ...), and none of the per-transformer
/// containment checks (`reject_unsafe_*_name`) reject a case-variant
/// duplicate -- they only reject unsafe SHAPES (traversal, absolute
/// paths, NUL bytes), not collisions between two otherwise-safe names.
/// Two agents/skills/SOPs/context files whose names differ only by case
/// would resolve to the SAME on-disk path on a case-insensitive
/// filesystem (macOS APFS default, Windows NTFS), silently letting the
/// second write overwrite (or, for a skill directory, interleave into)
/// the first's output -- the same class of bug the `SKILL.md`-collision
/// guard in `path_safety.rs` exists to prevent, one level up (across
/// distinct model entities, not just one skill's own auxiliary files
/// vs. its generated `SKILL.md`).
fn assert_unique_names<T>(
    items: &[T],
    name_of: impl Fn(&T) -> &str,
    labels: &[String],
    collection: &str,
) -> Result<(), ParseError> {
    let mut seen = BTreeSet::new();
    let mut seen_case_insensitive: std::collections::BTreeMap<String, String> =
        std::collections::BTreeMap::new();
    for (item, label) in items.iter().zip(labels) {
        let name = name_of(item);
        if !seen.insert(name.to_string()) {
            return Err(ParseError {
                file: label.clone(),
                field: Some("name".to_string()),
                reason: format!("duplicate name '{name}' already defined in {collection}"),
            });
        }
        let folded = case_insensitive_fold_key(name);
        if let Some(existing) = seen_case_insensitive.insert(folded, name.to_string()) {
            return Err(ParseError {
                file: label.clone(),
                field: Some("name".to_string()),
                reason: format!(
                    "name '{name}' collides case-insensitively with '{existing}' already \
                     defined in {collection} -- both would resolve to the same on-disk path \
                     on a case-insensitive filesystem (macOS APFS default, Windows NTFS)"
                ),
            });
        }
    }
    Ok(())
}

fn parse_agents(agents_dir: &Path) -> Result<Vec<parser::ParsedAgentSpec>, ParseError> {
    let files = list_dir_entries(agents_dir, |p| {
        p.is_file()
            && p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.ends_with(".agent-spec.json"))
    })?;

    let mut agents = Vec::new();
    let mut labels = Vec::new();
    for file in files {
        let spec = parser::parse_agent_spec_file(&file)?;
        labels.push(file.display().to_string());
        agents.push(spec);
    }
    assert_unique_names(&agents, |a| a.name.as_str(), &labels, "agents")?;
    Ok(agents)
}

/// Reads a source file's text after rejecting symlinks and enforcing
/// the same size cap the auxiliary-file path uses. `context/` and
/// `agent-sops/` files are untrusted CI source content (ADR-7), so they
/// get the same hardening the skill path applies: `symlink_metadata`
/// does not follow the link, so a `context/leak -> /etc/passwd` symlink
/// is rejected here rather than dereferenced and copied into `dist/`.
fn read_checked_source_file(path: &Path, file_label: &str) -> Result<String, ParseError> {
    let meta = path.symlink_metadata().map_err(|e| ParseError {
        file: file_label.to_string(),
        field: None,
        reason: format!("failed to read file: {e}"),
    })?;
    if meta.file_type().is_symlink() {
        return Err(ParseError {
            file: file_label.to_string(),
            field: None,
            reason: "file is a symlink; symlinks are not allowed".to_string(),
        });
    }
    if meta.len() > MAX_AUXILIARY_FILE_BYTES {
        return Err(ParseError {
            file: file_label.to_string(),
            field: None,
            reason: format!(
                "file size {} bytes exceeds maximum of {MAX_AUXILIARY_FILE_BYTES} bytes",
                meta.len()
            ),
        });
    }
    fs::read_to_string(path).map_err(|e| ParseError {
        file: file_label.to_string(),
        field: None,
        reason: format!("failed to read file: {e}"),
    })
}

fn parse_sops(sops_dir: &Path) -> Result<Vec<SopDef>, ParseError> {
    let files = list_dir_entries(sops_dir, |p| {
        p.is_file()
            && p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.ends_with(".sop.md"))
    })?;

    let mut sops = Vec::new();
    let mut labels = Vec::new();
    for file in files {
        let file_label = file.display().to_string();
        let stem = file
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| n.strip_suffix(".sop.md"))
            .ok_or_else(|| ParseError {
                file: file_label.clone(),
                field: None,
                reason: "unable to derive SOP name from filename".to_string(),
            })?
            .to_string();
        validate_sop_name(&stem, &file_label)?;
        let body = read_checked_source_file(&file, &file_label)?;
        labels.push(file_label);
        sops.push(SopDef { name: stem, body });
    }
    assert_unique_names(&sops, |s| s.name.as_str(), &labels, "agent-sops")?;
    Ok(sops)
}

fn parse_context(context_dir: &Path) -> Result<Vec<ContextDef>, ParseError> {
    let files = list_dir_entries(context_dir, |p| p.is_file())?;

    let mut context = Vec::new();
    let mut labels = Vec::new();
    for file in files {
        let file_label = file.display().to_string();
        let name = file
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| ParseError {
                file: file_label.clone(),
                field: None,
                reason: "context file name is not valid UTF-8".to_string(),
            })?
            .to_string();
        validate_context_name(&name, &file_label)?;
        let body = read_checked_source_file(&file, &file_label)?;
        labels.push(file_label);
        context.push(ContextDef { name, body });
    }
    assert_unique_names(&context, |c| c.name.as_str(), &labels, "context")?;
    Ok(context)
}

/// Validates a `ContextDef.name` (the source filename under
/// `context/`): non-empty, and no path separators (defense-in-depth;
/// `read_dir` already prevents actual directory traversal via a
/// filename).
fn validate_context_name(name: &str, file_label: &str) -> Result<(), ParseError> {
    if name.is_empty() {
        return Err(ParseError {
            file: file_label.to_string(),
            field: Some("name".to_string()),
            reason: "name must not be empty".to_string(),
        });
    }
    if name.contains('/') || name.contains('\\') {
        return Err(ParseError {
            file: file_label.to_string(),
            field: Some("name".to_string()),
            reason: "name must not contain path separators".to_string(),
        });
    }
    Ok(())
}

fn parse_skills(skills_dir: &Path) -> Result<Vec<SkillDef>, ParseError> {
    let dirs = list_dir_entries(skills_dir, |_| true)?;

    let mut skills = Vec::new();
    let mut labels = Vec::new();
    for dir in dirs {
        let symlink_meta = match dir.symlink_metadata() {
            Ok(m) => m,
            // Entry vanished between read_dir and symlink_metadata (TOCTOU
            // race on rapid file deletion). Skip rather than abort, since
            // the entry never existed from parse_canonical's perspective.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => {
                return Err(ParseError {
                    file: dir.display().to_string(),
                    field: None,
                    reason: format!("failed to stat skill directory entry: {e}"),
                })
            }
        };
        if symlink_meta.file_type().is_symlink() {
            return Err(ParseError {
                file: dir.display().to_string(),
                field: None,
                reason: "skill directory is a symlink; symlinks are not allowed".to_string(),
            });
        }
        if !symlink_meta.is_dir() {
            continue;
        }
        let skill_md = dir.join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }
        let dir_name = dir
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| ParseError {
                file: skill_md.display().to_string(),
                field: None,
                reason: "skill directory name is not valid UTF-8".to_string(),
            })?
            .to_string();

        let skill = parse_skill_dir(&dir, &skill_md, &dir_name)?;
        labels.push(skill_md.display().to_string());
        skills.push(skill);
    }
    assert_unique_names(&skills, |s| s.name.as_str(), &labels, "skills")?;
    Ok(skills)
}

/// Rejects a case-insensitive collision between two of ONE skill's own
/// `auxiliary_files` (e.g. `scripts/Run.sh` and `scripts/run.sh`), same
/// rationale as `assert_unique_names`'s case-insensitive check above,
/// scoped to auxiliary files instead of top-level model entity names.
/// An exact-match collision cannot occur here (`collect_auxiliary_files`
/// walks a real filesystem, which cannot produce two directory entries
/// with byte-identical names), so only the case-insensitive check is
/// needed.
fn assert_unique_auxiliary_paths_case_insensitive(
    auxiliary_files: &[AuxiliaryFile],
    file_label: &str,
) -> Result<(), ParseError> {
    let mut seen: std::collections::BTreeMap<String, PathBuf> = std::collections::BTreeMap::new();
    for aux in auxiliary_files {
        let folded = case_insensitive_fold_key(&aux.relative_path.to_string_lossy());
        if let Some(existing) = seen.insert(folded, aux.relative_path.clone()) {
            return Err(ParseError {
                file: file_label.to_string(),
                field: Some("auxiliary_files".to_string()),
                reason: format!(
                    "auxiliary file '{}' collides case-insensitively with '{}' -- both would \
                     resolve to the same on-disk path on a case-insensitive filesystem (macOS \
                     APFS default, Windows NTFS)",
                    aux.relative_path.display(),
                    existing.display()
                ),
            });
        }
    }
    Ok(())
}

fn parse_skill_dir(dir: &Path, skill_md: &Path, dir_name: &str) -> Result<SkillDef, ParseError> {
    let file_label = skill_md.display().to_string();
    if skill_md
        .symlink_metadata()
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(ParseError {
            file: file_label,
            field: None,
            reason: "SKILL.md is a symlink; symlinks are not allowed in skill directories"
                .to_string(),
        });
    }
    let size = fs::metadata(skill_md)
        .map_err(|e| ParseError {
            file: file_label.clone(),
            field: None,
            reason: format!("failed to read file: {e}"),
        })?
        .len();
    if size > MAX_AUXILIARY_FILE_BYTES {
        return Err(ParseError {
            file: file_label,
            field: None,
            reason: format!(
                "SKILL.md size {size} bytes exceeds maximum of {MAX_AUXILIARY_FILE_BYTES} bytes"
            ),
        });
    }
    let raw = fs::read_to_string(skill_md).map_err(|e| ParseError {
        file: file_label.clone(),
        field: None,
        reason: format!("failed to read file: {e}"),
    })?;

    let (frontmatter, body) = split_frontmatter(&raw, &file_label)?;
    let skill = build_skill_def(frontmatter, body, &file_label, dir_name)?;

    let mut auxiliary_files = Vec::new();
    collect_auxiliary_files(dir, dir, &mut auxiliary_files)?;
    auxiliary_files
        .sort_by(|a: &AuxiliaryFile, b: &AuxiliaryFile| a.relative_path.cmp(&b.relative_path));
    assert_unique_auxiliary_paths_case_insensitive(&auxiliary_files, &file_label)?;

    Ok(SkillDef {
        auxiliary_files,
        ..skill
    })
}

/// Splits `SKILL.md` content into (frontmatter YAML text, body). Frontmatter
/// is delimited by `---` lines at the start of the file.
///
/// Handles both LF and CRLF line endings: every line-boundary
/// strip/search here also matches an optional trailing `\r` before
/// the `\n`, not just the `\n` itself.
fn split_frontmatter<'a>(raw: &'a str, file_label: &str) -> Result<(&'a str, &'a str), ParseError> {
    let rest = raw.strip_prefix("---").ok_or_else(|| ParseError {
        file: file_label.to_string(),
        field: None,
        reason: "missing YAML frontmatter (expected leading '---')".to_string(),
    })?;
    let rest = rest
        .strip_prefix("\r\n")
        .or_else(|| rest.strip_prefix('\n'))
        .unwrap_or(rest);
    // Closing '---' must start a line, not just appear anywhere in the
    // YAML body (e.g. inside a multi-line string value).
    let end = rest
        .match_indices('\n')
        .find_map(|(i, _)| {
            let after = &rest[i + 1..];
            if after == "---" || after.starts_with("---\n") || after.starts_with("---\r\n") {
                Some(i)
            } else {
                None
            }
        })
        .ok_or_else(|| ParseError {
            file: file_label.to_string(),
            field: None,
            reason: "missing closing '---' for YAML frontmatter".to_string(),
        })?;
    // `end` is the index of the '\n' immediately before the closing
    // '---'; a CRLF-terminated line before it leaves a trailing '\r' at
    // `end - 1`, which must be excluded from `frontmatter` the same way
    // the '\n' itself is.
    let frontmatter = rest[..end].strip_suffix('\r').unwrap_or(&rest[..end]);
    // Skip '\n---'.
    let after = &rest[end + 1 + 3..];
    // Strip the delimiter line's own terminator, then at most one further
    // blank line -- the conventional single blank line between the
    // closing '---' and the body is a separator, not part of the body.
    // Anything beyond that (further blank lines) is intentional leading
    // whitespace in `body` and must be preserved, not collapsed.
    let body = strip_frontmatter_separator(after);
    Ok((frontmatter, body))
}

/// Strips the mandatory line terminator ending the closing `---` line,
/// then at most one further blank line (the conventional separator
/// between frontmatter and body). Any additional blank lines are left
/// in place as intentional leading whitespace in the body. A bare `\r`
/// is not a line terminator on its own (only `\n` or `\r\n` are), so it
/// is never stripped here except as part of a `\r\n` pair.
fn strip_frontmatter_separator(after: &str) -> &str {
    fn strip_one_terminator(s: &str) -> &str {
        s.strip_prefix("\r\n")
            .or_else(|| s.strip_prefix('\n'))
            .unwrap_or(s)
    }
    strip_one_terminator(strip_one_terminator(after))
}

fn build_skill_def(
    frontmatter: &str,
    body: &str,
    file_label: &str,
    dir_name: &str,
) -> Result<SkillDef, ParseError> {
    let value: Value = serde_yaml::from_str(frontmatter).map_err(|e| ParseError {
        file: file_label.to_string(),
        field: None,
        reason: format!("invalid YAML frontmatter: {e}"),
    })?;
    let obj = match value {
        Value::Object(map) => map,
        _ => {
            return Err(ParseError {
                file: file_label.to_string(),
                field: None,
                reason: "frontmatter must be a YAML mapping".to_string(),
            })
        }
    };

    // Presence only, not type: a type check on the YAML-resolved value
    // would diverge across runtimes for an ambiguous scalar like
    // `name: off` (bool in one YAML loader, string in the other). A
    // missing key is missing identically in both, so presence is safe.
    if !obj.contains_key("name") {
        return Err(ParseError {
            file: file_label.to_string(),
            field: Some("name".to_string()),
            reason: "missing".to_string(),
        });
    }
    // The raw source text is compared, not the YAML-resolved value, so
    // this stays non-divergent (`name: off` in dir `off` compares as
    // text "off" == "off" in both runtimes, never resolving to a bool).
    let raw_name = extract_raw_name(frontmatter).ok_or_else(|| ParseError {
        file: file_label.to_string(),
        field: Some("name".to_string()),
        reason: "could not extract 'name' value from frontmatter".to_string(),
    })?;
    if raw_name != dir_name {
        return Err(ParseError {
            file: file_label.to_string(),
            field: Some("name".to_string()),
            reason: format!(
                "skill name '{raw_name}' does not match its directory name '{dir_name}'"
            ),
        });
    }
    let name = dir_name.to_string();
    validate_skill_name(&name, file_label)?;

    // Presence only, not type: a type check here (e.g. "must be a
    // string") would diverge across runtimes for an ambiguous scalar
    // like `description: yes` (bool in one YAML loader, string in the
    // other), reintroducing a cross-runtime exit-code divergence. A
    // missing key is missing identically in both, so presence is safe.
    if !obj.contains_key("description") {
        return Err(ParseError {
            file: file_label.to_string(),
            field: Some("description".to_string()),
            reason: "missing".to_string(),
        });
    }

    Ok(SkillDef {
        name,
        raw_frontmatter: frontmatter.to_string(),
        body: body.to_string(),
        auxiliary_files: Vec::new(),
    })
}

/// Extracts the source text of the top-level `name:` value from raw YAML
/// frontmatter, without YAML-resolving it: the text after `name:` on its
/// own line, trimmed, with one layer of matching surrounding quotes
/// (single or double) stripped if present. Returns `None` if no `name:`
/// line is found (the caller's presence check already covers a missing
/// key; this only fires if that line-based scan itself fails to match).
///
/// Accepts only a plain top-level `name:` line; a trailing comment, a
/// quoted `"name":` key, a space before the colon, flow-style `{name:
/// ...}`, or a duplicate `name:` key all fail to match and error
/// honestly rather than being parsed.
fn extract_raw_name(frontmatter: &str) -> Option<String> {
    for line in frontmatter.lines() {
        // Require the line to be exactly `name:` (optionally followed by
        // trailing whitespace only) before the value, so a trailing
        // comment like `name: foo # comment` does not match: `strip_prefix`
        // alone would accept it and return "foo # comment" as the name.
        let Some(rest) = line.strip_prefix("name:") else {
            continue;
        };
        let value = rest.trim();
        if value.is_empty() {
            continue;
        }
        if value.contains('#') {
            // A trailing comment after the value -- reject rather than
            // silently including the comment text in the extracted name.
            return None;
        }
        let unquoted = if value.len() >= 2
            && ((value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\'')))
        {
            &value[1..value.len() - 1]
        } else {
            value
        };
        return Some(unquoted.to_string());
    }
    None
}

/// Validates a `SkillDef.name` (the skill's directory name) per Kiro
/// spec: max 64 chars, lowercase letters/numbers/hyphens only, no
/// leading/trailing/consecutive hyphens. Directory/frontmatter name
/// agreement is enforced separately, in `build_skill_def`.
fn validate_skill_name(name: &str, file_label: &str) -> Result<(), ParseError> {
    if name.is_empty() || name.len() > 64 {
        return Err(ParseError {
            file: file_label.to_string(),
            field: Some("name".to_string()),
            reason: "name must be 1-64 characters".to_string(),
        });
    }
    let valid_chars = name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !valid_chars {
        return Err(ParseError {
            file: file_label.to_string(),
            field: Some("name".to_string()),
            reason: "name must contain only lowercase letters, numbers, and hyphens".to_string(),
        });
    }
    if name.starts_with('-') || name.ends_with('-') || name.contains("--") {
        return Err(ParseError {
            file: file_label.to_string(),
            field: Some("name".to_string()),
            reason: "name must not have leading, trailing, or consecutive hyphens".to_string(),
        });
    }
    Ok(())
}

/// Validates a `SopDef.name` (derived from its filename stem): non-empty,
/// and no path separators (defense-in-depth; `read_dir` already prevents
/// actual directory traversal via a filename).
fn validate_sop_name(name: &str, file_label: &str) -> Result<(), ParseError> {
    if name.is_empty() {
        return Err(ParseError {
            file: file_label.to_string(),
            field: Some("name".to_string()),
            reason: "name must not be empty".to_string(),
        });
    }
    if name.contains('/') || name.contains('\\') {
        return Err(ParseError {
            file: file_label.to_string(),
            field: Some("name".to_string()),
            reason: "name must not contain path separators".to_string(),
        });
    }
    Ok(())
}

/// Recursively collects every file under `dir` (relative to `skill_root`) as
/// an `AuxiliaryFile`, excluding `SKILL.md` itself.
fn collect_auxiliary_files(
    skill_root: &Path,
    dir: &Path,
    out: &mut Vec<AuxiliaryFile>,
) -> Result<(), ParseError> {
    let entries = list_dir_entries(dir, |_| true)?;
    for path in entries {
        let symlink_meta = path.symlink_metadata().map_err(|e| ParseError {
            file: path.display().to_string(),
            field: None,
            reason: format!("failed to read file: {e}"),
        })?;
        if symlink_meta.file_type().is_symlink() {
            return Err(ParseError {
                file: path.display().to_string(),
                field: None,
                reason:
                    "auxiliary file is a symlink; symlinks are not allowed in skill directories"
                        .to_string(),
            });
        }
        if symlink_meta.is_dir() {
            collect_auxiliary_files(skill_root, &path, out)?;
            continue;
        }
        if path == skill_root.join("SKILL.md") {
            continue;
        }
        out.push(read_auxiliary_file(skill_root, &path)?);
    }
    Ok(())
}

fn read_auxiliary_file(skill_root: &Path, path: &Path) -> Result<AuxiliaryFile, ParseError> {
    // Security contract: symlinks are rejected before this point (see
    // `collect_auxiliary_files`), so `relative_path` is a real in-tree
    // path. Consumers MUST still join it via `output_dir.join(..)` with
    // `strip_prefix` or equivalent before writing to `dist/`, to prevent
    // path traversal.
    let file_label = path.display().to_string();
    let metadata = fs::metadata(path).map_err(|e| ParseError {
        file: file_label.clone(),
        field: None,
        reason: format!("failed to read file: {e}"),
    })?;

    if metadata.len() > MAX_AUXILIARY_FILE_BYTES {
        return Err(ParseError {
            file: file_label,
            field: None,
            reason: format!(
                "file size {} bytes exceeds maximum of {MAX_AUXILIARY_FILE_BYTES} bytes",
                metadata.len()
            ),
        });
    }

    let mode = metadata.permissions().mode();
    if mode & 0o7000 != 0 {
        return Err(ParseError {
            file: file_label,
            field: None,
            reason: "auxiliary file has setuid/setgid/sticky bit set".to_string(),
        });
    }
    let executable = mode & 0o111 != 0;

    let content = fs::read(path).map_err(|e| ParseError {
        file: file_label.clone(),
        field: None,
        reason: format!("failed to read file: {e}"),
    })?;

    let relative_path = path.strip_prefix(skill_root).map_err(|_| ParseError {
        file: file_label.clone(),
        field: None,
        reason: "auxiliary file path escapes skill directory".to_string(),
    })?;

    Ok(AuxiliaryFile {
        relative_path: relative_path.to_path_buf(),
        content,
        executable,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `extract_raw_name` must reject a trailing comment rather than
    /// folding it into the name: `name: foo # comment` would otherwise
    /// extract "foo # comment" (comment and all), which then flows into
    /// the skill's on-disk directory name and manifest path. An empty
    /// value is skipped, not returned as an empty name.
    #[test]
    fn extract_raw_name_rejects_trailing_comment_and_empty_value() {
        assert_eq!(extract_raw_name("name: foo # comment"), None);
        assert_eq!(extract_raw_name("name:"), None);
        assert_eq!(extract_raw_name("name: foo"), Some("foo".to_string()));
        assert_eq!(extract_raw_name("name: \"foo\""), Some("foo".to_string()));
    }

    /// `extract_raw_name` matches only a plain top-level `name:` line, so
    /// a quoted `"name":` key, a space before the colon (`name :`), and
    /// flow-style (`{name: foo}`) all fail to match and return None -- the
    /// caller then errors honestly rather than extracting a bad name.
    #[test]
    fn extract_raw_name_rejects_quoted_key_space_before_colon_and_flow_style() {
        // Quoted key: the line starts with `"name`, not `name:`.
        assert_eq!(extract_raw_name("\"name\": foo"), None);
        // Space before the colon: the line starts with `name `, not `name:`.
        assert_eq!(extract_raw_name("name : foo"), None);
        // Flow-style mapping: the line starts with `{name:`, not `name:`.
        assert_eq!(extract_raw_name("{name: foo}"), None);
    }
    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-parse-canonical-test-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_agent_spec(dir: &Path, name: &str) {
        fs::create_dir_all(dir.join("agents")).unwrap();
        let content = format!(
            r#"{{"schemaVersion":"1","name":"{name}","config":{{"description":"d","systemPrompt":"s","model":"m"}},"clientConfig":{{}}}}"#
        );
        fs::write(
            dir.join("agents").join(format!("{name}.agent-spec.json")),
            content,
        )
        .unwrap();
    }

    fn write_agent_spec_with_context_names(dir: &Path, name: &str, context_names: &[&str]) {
        fs::create_dir_all(dir.join("agents")).unwrap();
        let names_json = context_names
            .iter()
            .map(|n| format!("\"{n}\""))
            .collect::<Vec<_>>()
            .join(",");
        let content = format!(
            r#"{{"schemaVersion":"1","name":"{name}","config":{{"description":"d","systemPrompt":"s","model":"m"}},"dependencies":{{"context":{{"contextNames":[{names_json}]}}}},"clientConfig":{{}}}}"#
        );
        fs::write(
            dir.join("agents").join(format!("{name}.agent-spec.json")),
            content,
        )
        .unwrap();
    }

    fn write_agent_spec_with_dependencies_skills(dir: &Path, name: &str, skill_names: &[&str]) {
        fs::create_dir_all(dir.join("agents")).unwrap();
        let names_json = skill_names
            .iter()
            .map(|n| format!("\"{n}\""))
            .collect::<Vec<_>>()
            .join(",");
        let content = format!(
            r#"{{"schemaVersion":"1","name":"{name}","config":{{"description":"d","systemPrompt":"s","model":"m"}},"dependencies":{{"skills":{{"skillNames":[{names_json}]}}}},"clientConfig":{{}}}}"#
        );
        fs::write(
            dir.join("agents").join(format!("{name}.agent-spec.json")),
            content,
        )
        .unwrap();
    }

    fn write_agent_spec_with_sop_names(dir: &Path, name: &str, sop_names: &[&str]) {
        fs::create_dir_all(dir.join("agents")).unwrap();
        let names_json = sop_names
            .iter()
            .map(|n| format!("\"{n}\""))
            .collect::<Vec<_>>()
            .join(",");
        let content = format!(
            r#"{{"schemaVersion":"1","name":"{name}","config":{{"description":"d","systemPrompt":"s","model":"m"}},"dependencies":{{"agentSops":{{"agentSopNames":[{names_json}]}}}},"clientConfig":{{}}}}"#
        );
        fs::write(
            dir.join("agents").join(format!("{name}.agent-spec.json")),
            content,
        )
        .unwrap();
    }

    fn write_agent_spec_with_claude_cli_skills(dir: &Path, name: &str, skill_names: &[&str]) {
        fs::create_dir_all(dir.join("agents")).unwrap();
        let names_json = skill_names
            .iter()
            .map(|n| format!("\"{n}\""))
            .collect::<Vec<_>>()
            .join(",");
        let content = format!(
            r#"{{"schemaVersion":"1","name":"{name}","config":{{"description":"d","systemPrompt":"s","model":"m"}},"clientConfig":{{"claudeCli":{{"skills":[{names_json}]}}}}}}"#
        );
        fs::write(
            dir.join("agents").join(format!("{name}.agent-spec.json")),
            content,
        )
        .unwrap();
    }

    fn write_agent_spec_with_kiro_cli_resources(dir: &Path, name: &str, resources: &[&str]) {
        fs::create_dir_all(dir.join("agents")).unwrap();
        let resources_json = resources
            .iter()
            .map(|r| format!("\"{r}\""))
            .collect::<Vec<_>>()
            .join(",");
        let content = format!(
            r#"{{"schemaVersion":"1","name":"{name}","config":{{"description":"d","systemPrompt":"s","model":"m"}},"clientConfig":{{"kiroCli":{{"resources":[{resources_json}]}}}}}}"#
        );
        fs::write(
            dir.join("agents").join(format!("{name}.agent-spec.json")),
            content,
        )
        .unwrap();
    }

    /// Builds a `ParsedAgentSpec` directly (bypassing the filesystem)
    /// declaring both `dependencies.skills.skillNames` and
    /// `clientConfig.kiroCli.resources` -- the two surfaces
    /// `check_skill_scope_consistency` compares. Used only by that
    /// check's own tests, which don't need real `skills/` directories on
    /// disk since the consistency check never touches them.
    fn agent_spec_with_skill_names_and_resources(
        name: &str,
        skill_names: &[&str],
        resources: &[&str],
    ) -> parser::ParsedAgentSpec {
        let names_json = skill_names
            .iter()
            .map(|n| format!("\"{n}\""))
            .collect::<Vec<_>>()
            .join(",");
        let resources_json = resources
            .iter()
            .map(|r| format!("\"{r}\""))
            .collect::<Vec<_>>()
            .join(",");
        let content = format!(
            r#"{{"schemaVersion":"1","name":"{name}","config":{{"description":"d","systemPrompt":"s","model":"m"}},"dependencies":{{"skills":{{"skillNames":[{names_json}]}}}},"clientConfig":{{"kiroCli":{{"resources":[{resources_json}]}}}}}}"#
        );
        parser::parse_agent_spec_str(&content, "agents/test.agent-spec.json").unwrap()
    }

    /// Clean case: every `skill://` resource entry's name already
    /// appears in `skillNames` -- resources are a subset of skillNames,
    /// so no warning is produced.
    #[test]
    fn check_skill_scope_consistency_clean_case_produces_no_warnings() {
        let agent = agent_spec_with_skill_names_and_resources(
            "k-example",
            &["constraints", "sdlc-navigator"],
            &["skill://skills/constraints/SKILL.md"],
        );
        let warnings = check_skill_scope_consistency(&[agent]);
        assert!(
            warnings.is_empty(),
            "resources is a subset of skillNames; expected no warnings, got: {warnings:?}"
        );
    }

    /// Drift case: a `skill://` resource entry names a skill absent from
    /// `skillNames` -- resources is NOT a subset of skillNames, which
    /// must produce exactly one warning naming the agent and the missing
    /// skill, and it must never be surfaced as a `ParseError` (this is a
    /// warning, not a hard error).
    #[test]
    fn check_skill_scope_consistency_drift_case_produces_warning() {
        let agent = agent_spec_with_skill_names_and_resources(
            "k-example",
            &["sdlc-navigator"],
            &["skill://skills/constraints/SKILL.md"],
        );
        let warnings = check_skill_scope_consistency(&[agent]);
        assert_eq!(warnings.len(), 1, "got: {warnings:?}");
        assert!(warnings[0].contains("k-example"));
        assert!(warnings[0].contains("constraints"));
    }

    /// `skillNames` may legitimately list a name with no corresponding
    /// `resources` entry (skillNames is not required to be a subset of
    /// resources -- only the reverse) -- no warning.
    #[test]
    fn check_skill_scope_consistency_skill_names_superset_of_resources_produces_no_warning() {
        let agent = agent_spec_with_skill_names_and_resources(
            "k-example",
            &["constraints", "sdlc-navigator"],
            &[],
        );
        let warnings = check_skill_scope_consistency(&[agent]);
        assert!(
            warnings.is_empty(),
            "skillNames listing a name with no resources entry must not warn, got: {warnings:?}"
        );
    }

    /// A wildcard `skill://` resource (e.g. a `ws-*` workspace-skills
    /// glob) is never checked against `skillNames` -- matching
    /// `check_dangling_skill_references`'s own treatment of globs.
    #[test]
    fn check_skill_scope_consistency_never_checks_wildcard_resources() {
        let agent = agent_spec_with_skill_names_and_resources(
            "k-example",
            &[],
            &["skill://.kiro/skills/ws-*/SKILL.md"],
        );
        let warnings = check_skill_scope_consistency(&[agent]);
        assert!(warnings.is_empty(), "got: {warnings:?}");
    }

    /// An agent with no `clientConfig.kiroCli` section at all is skipped
    /// entirely -- this check is scoped to Kiro CLI agents, same as
    /// `check_dangling_skill_references`'s own `kiro_cli` branch.
    #[test]
    fn check_skill_scope_consistency_skips_agent_with_no_kiro_cli_config() {
        let content = r#"{"schemaVersion":"1","name":"claude-only","config":{"description":"d","systemPrompt":"s","model":"m"},"dependencies":{"skills":{"skillNames":["sdlc-navigator"]}},"clientConfig":{}}"#;
        let agent = parser::parse_agent_spec_str(content, "agents/test.agent-spec.json").unwrap();
        let warnings = check_skill_scope_consistency(&[agent]);
        assert!(warnings.is_empty(), "got: {warnings:?}");
    }

    fn write_skill(dir: &Path, name: &str) {
        let skill_dir = dir.join("skills").join(name);
        fs::create_dir_all(&skill_dir).unwrap();
        let content =
            format!("---\nname: {name}\ndescription: A test skill.\n---\n\n# {name}\n\nBody.\n");
        fs::write(skill_dir.join("SKILL.md"), content).unwrap();
    }

    fn write_sop(dir: &Path, name: &str) {
        fs::create_dir_all(dir.join("agent-sops")).unwrap();
        fs::write(
            dir.join("agent-sops").join(format!("{name}.sop.md")),
            format!("# {name}\n\nBody.\n"),
        )
        .unwrap();
    }

    fn write_context(dir: &Path, file_name: &str) {
        fs::create_dir_all(dir.join("context")).unwrap();
        fs::write(
            dir.join("context").join(file_name),
            format!("# {file_name}\n\nContext body.\n"),
        )
        .unwrap();
    }

    #[test]
    fn empty_source_dir_yields_empty_model() {
        let dir = temp_dir("empty");
        let model = parse_canonical(&dir).unwrap();
        assert!(model.agents.is_empty());
        assert!(model.skills.is_empty());
        assert!(model.sops.is_empty());
        assert!(model.context.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn single_valid_agent_spec_produces_one_agent() {
        let dir = temp_dir("one-agent");
        write_agent_spec(&dir, "k-example");
        let model = parse_canonical(&dir).unwrap();
        assert_eq!(model.agents.len(), 1);
        assert_eq!(model.agents[0].name, "k-example");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicate_agent_name_is_rejected() {
        let dir = temp_dir("dup-agent");
        fs::create_dir_all(dir.join("agents")).unwrap();
        for label in ["a", "b"] {
            let content =
                r#"{"schemaVersion":"1","name":"dup","config":{"description":"d","systemPrompt":"s","model":"m"},"clientConfig":{}}"#
                    .to_string();
            fs::write(
                dir.join("agents").join(format!("{label}.agent-spec.json")),
                content,
            )
            .unwrap();
        }
        let err = parse_canonical(&dir).unwrap_err();
        assert_eq!(err.field, Some("name".to_string()));
        assert!(err.reason.contains("duplicate name"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicate_skill_name_is_rejected() {
        // Skill names must equal their own directory name (enforced by
        // validate_skill_name), so a real duplicate-yielding fixture would
        // need two directories with the same name, which one filesystem
        // cannot hold. Exercise the production `assert_unique_names` path
        // directly against a hand-crafted vec of colliding SkillDefs.
        let dir = temp_dir("dup-skill");
        write_skill(&dir, "dup");
        let skill_dir = dir.join("skills").join("dup");
        let skill_md = skill_dir.join("SKILL.md");
        let skill = parse_skill_dir(&skill_dir, &skill_md, "dup").unwrap();

        let skills = vec![skill.clone(), skill];
        let labels = vec![
            skill_md.display().to_string(),
            skill_md.display().to_string(),
        ];
        let err = assert_unique_names(&skills, |s| s.name.as_str(), &labels, "skills")
            .expect_err("expected a duplicate-name ParseError");
        assert_eq!(err.field, Some("name".to_string()));
        assert!(err.reason.contains("duplicate name"));
        let _ = fs::remove_dir_all(&dir);
    }

    /// Confirms the case-insensitive collision scenario is structurally
    /// UNREACHABLE for skills specifically, unlike agents/SOPs/context:
    /// `validate_skill_name` already requires lowercase-only names (`name
    /// must contain only lowercase letters, numbers, and hyphens`), so
    /// `MySkill` is rejected by that pre-existing check before
    /// `assert_unique_names`'s case-insensitive collision check ever
    /// runs -- two lowercase-only names can case-fold-collide only by
    /// being byte-identical, which the EXACT-match branch already
    /// catches. This is a deliberate scope note, not a gap: the
    /// case-insensitive check in `assert_unique_names` stays in the
    /// shared helper (harmless no-op for skills) rather than being
    /// carved out per-collection, since removing it there would need to
    /// be re-added the moment `validate_skill_name` ever allows
    /// uppercase.
    #[test]
    fn mixed_case_skill_name_is_rejected_by_validate_skill_name_not_case_insensitive_check() {
        let dir = temp_dir("mixed-case-skill");
        write_skill(&dir, "MySkill");
        let err = parse_canonical(&dir).unwrap_err();
        assert!(
            err.reason
                .contains("must contain only lowercase letters, numbers, and hyphens"),
            "got: {}",
            err.reason
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// Data-integrity regression guard: two agents whose names differ
    /// only by case (`MyAgent`/`myagent`, which `validate_agent_name` --
    /// unlike `validate_skill_name` -- does not restrict to lowercase)
    /// are genuinely distinct on this case-sensitive test filesystem, but
    /// would resolve to the SAME on-disk path once written to `dist/`
    /// on a case-insensitive filesystem (macOS APFS default, Windows
    /// NTFS). This fails (returns `Ok` instead of `Err`) if the
    /// case-insensitive check is ever removed from `assert_unique_names`.
    #[test]
    fn case_insensitive_duplicate_agent_name_is_rejected() {
        let dir = temp_dir("case-dup-agent");
        write_agent_spec(&dir, "MyAgent");
        write_agent_spec(&dir, "myagent");
        let err = parse_canonical(&dir).unwrap_err();
        assert!(err.reason.contains("collides case-insensitively"));
        let _ = fs::remove_dir_all(&dir);
    }

    /// `assert_unique_names`'s case-insensitive fold goes through
    /// `path_safety::case_insensitive_fold_key` (NFC normalization, then
    /// full-Unicode `str::to_lowercase`), not `str::to_ascii_lowercase`,
    /// which only normalizes ASCII A-Z/a-z. The threat model this check
    /// exists for is a real case-insensitive filesystem (macOS APFS
    /// default, Windows NTFS), and both of those case-fold the FULL
    /// Unicode range by default -- so two agent names differing only by
    /// non-ASCII case (`"café"` vs `"CAFÉ"`) still collide on-disk and an
    /// ASCII-only fold would let that slip past undetected. This matches
    /// the identical filesystem-collision guard in `registry.rs`'s
    /// `transformer_names_are_unique_case_insensitively`. This fails
    /// (returns `Ok` instead of `Err`) if the fold is ever narrowed to
    /// `to_ascii_lowercase`.
    #[test]
    fn case_insensitive_duplicate_agent_name_is_rejected_for_non_ascii_case() {
        let dir = temp_dir("case-dup-agent-non-ascii");
        write_agent_spec(&dir, "cafe-CAFÉ");
        write_agent_spec(&dir, "cafe-café");
        let err = parse_canonical(&dir).unwrap_err();
        assert!(
            err.reason.contains("collides case-insensitively"),
            "got: {}",
            err.reason
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// NFC/NFD counterpart of the non-ASCII-case test above: two agent
    /// names that are visually and semantically identical but composed
    /// differently -- one NFC-precomposed (`"café"`, one codepoint for
    /// `é`), one NFD-decomposed (`"cafe\u{301}"`, `e` + a combining
    /// acute accent) -- must also collide. A bare `str::to_lowercase`
    /// fold (no normalization step) does NOT unify these two forms, so
    /// this fails (returns `Ok` instead of `Err`) unless
    /// `assert_unique_names` folds through `case_insensitive_fold_key`
    /// (NFC normalization before lowercasing), not a plain
    /// `to_lowercase()`.
    #[test]
    fn case_insensitive_duplicate_agent_name_is_rejected_for_nfc_nfd_composition() {
        let dir = temp_dir("case-dup-agent-nfc-nfd");
        write_agent_spec(&dir, "cafe-caf\u{e9}");
        write_agent_spec(&dir, "cafe-cafe\u{301}");
        let err = parse_canonical(&dir).unwrap_err();
        assert!(
            err.reason.contains("collides case-insensitively"),
            "got: {}",
            err.reason
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// Data-integrity regression guard, auxiliary-file half: two
    /// auxiliary files within the SAME skill whose relative paths differ
    /// only by case
    /// (`scripts/Run.sh`/`scripts/run.sh`) must be rejected -- both
    /// would resolve to the same on-disk path once written, alongside
    /// the skill's own generated `SKILL.md`.
    #[test]
    fn case_insensitive_duplicate_auxiliary_file_path_is_rejected() {
        let dir = temp_dir("case-dup-aux");
        let skill_dir = dir.join("skills").join("aux-skill");
        fs::create_dir_all(skill_dir.join("scripts")).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: aux-skill\ndescription: A test skill.\n---\n\nBody.\n",
        )
        .unwrap();
        fs::write(skill_dir.join("scripts").join("Run.sh"), "#!/bin/sh\n").unwrap();
        fs::write(skill_dir.join("scripts").join("run.sh"), "#!/bin/sh\n").unwrap();

        let err = parse_canonical(&dir).unwrap_err();
        assert_eq!(err.field, Some("auxiliary_files".to_string()));
        assert!(
            err.reason.contains("collides case-insensitively"),
            "got: {}",
            err.reason
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// Non-ASCII counterpart of the above (see
    /// `case_insensitive_duplicate_agent_name_is_rejected_for_non_ascii_case`
    /// for the full-Unicode-fold rationale): two
    /// auxiliary files within the same skill whose relative paths differ
    /// only by non-ASCII case (`scripts/Café.sh`/`scripts/CAFÉ.sh`) must
    /// also be rejected -- `assert_unique_auxiliary_paths_case_insensitive`
    /// folds via the same shared `case_insensitive_fold_key` as
    /// `assert_unique_names`.
    #[test]
    fn case_insensitive_duplicate_auxiliary_file_path_is_rejected_for_non_ascii_case() {
        let dir = temp_dir("case-dup-aux-non-ascii");
        let skill_dir = dir.join("skills").join("aux-skill-non-ascii");
        fs::create_dir_all(skill_dir.join("scripts")).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: aux-skill-non-ascii\ndescription: A test skill.\n---\n\nBody.\n",
        )
        .unwrap();
        fs::write(skill_dir.join("scripts").join("Café.sh"), "#!/bin/sh\n").unwrap();
        fs::write(skill_dir.join("scripts").join("CAFÉ.sh"), "#!/bin/sh\n").unwrap();

        let err = parse_canonical(&dir).unwrap_err();
        assert_eq!(err.field, Some("auxiliary_files".to_string()));
        assert!(
            err.reason.contains("collides case-insensitively"),
            "got: {}",
            err.reason
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn output_collections_are_sorted_alphabetically() {
        let dir = temp_dir("sorted");
        write_agent_spec(&dir, "zeta");
        write_agent_spec(&dir, "alpha");
        write_skill(&dir, "zeta-skill");
        write_skill(&dir, "alpha-skill");
        write_sop(&dir, "zeta-sop");
        write_sop(&dir, "alpha-sop");
        write_context(&dir, "zeta-context.md");
        write_context(&dir, "alpha-context.md");

        let model = parse_canonical(&dir).unwrap();
        assert_eq!(
            model
                .context
                .iter()
                .map(|c| c.name.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha-context.md", "zeta-context.md"]
        );
        assert_eq!(
            model
                .agents
                .iter()
                .map(|a| a.name.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha", "zeta"]
        );
        assert_eq!(
            model
                .skills
                .iter()
                .map(|s| s.name.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha-skill", "zeta-skill"]
        );
        assert_eq!(
            model
                .sops
                .iter()
                .map(|s| s.name.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha-sop", "zeta-sop"]
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn auxiliary_file_with_setuid_bit_is_rejected() {
        let dir = temp_dir("setuid");
        write_skill(&dir, "setuid-skill");
        let aux = dir.join("skills").join("setuid-skill").join("script.sh");
        fs::write(&aux, "#!/bin/sh\n").unwrap();
        let mut perms = fs::metadata(&aux).unwrap().permissions();
        perms.set_mode(0o4755); // setuid
        fs::set_permissions(&aux, perms).unwrap();

        let err = parse_canonical(&dir).unwrap_err();
        assert!(err.reason.contains("setuid/setgid/sticky"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn auxiliary_file_above_max_size_is_rejected() {
        let dir = temp_dir("oversized");
        write_skill(&dir, "oversized-skill");
        let aux = dir.join("skills").join("oversized-skill").join("big.bin");
        let oversized = vec![0u8; (MAX_AUXILIARY_FILE_BYTES + 1) as usize];
        fs::write(&aux, oversized).unwrap();

        let err = parse_canonical(&dir).unwrap_err();
        assert!(err.reason.contains("exceeds maximum"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn skill_name_not_matching_directory_name_is_rejected() {
        let dir = temp_dir("name-mismatch");
        let skill_dir = dir.join("skills").join("actual-dir-name");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: different-name\ndescription: d.\n---\n\nBody.\n",
        )
        .unwrap();

        let err = parse_canonical(&dir).unwrap_err();
        assert!(err.reason.contains("does not match its directory name"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn skill_yaml_name_bool_word_matching_directory_is_accepted() {
        // `name: off` is a YAML 1.1 bool word in some loaders; the raw
        // source text "off" is compared against the directory name
        // "off" without ever YAML-resolving it, so this is accepted
        // rather than diverging across runtimes.
        let dir = temp_dir("bool-word-name");
        let skill_dir = dir.join("skills").join("off");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: off\ndescription: d.\n---\n\nBody.\n",
        )
        .unwrap();

        let model = parse_canonical(&dir).unwrap();
        assert_eq!(model.skills[0].name, "off");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn bare_cr_before_name_line_does_not_shadow_it() {
        // `.lines()` splits only on `\n`, so a value containing a bare
        // `\r` before the real `name:` line stays on one line and never
        // fractures into a spurious `name:`-prefixed line.
        let dir = temp_dir("bare-cr-name");
        let skill_dir = dir.join("skills").join("real-name");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nnote: \"a\rname: evil\"\nname: real-name\ndescription: d.\n---\n\nBody.\n",
        )
        .unwrap();

        let model = parse_canonical(&dir).unwrap();
        assert_eq!(model.skills[0].name, "real-name");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn line_separator_before_name_line_does_not_shadow_it() {
        // Same as `bare_cr_before_name_line_does_not_shadow_it` for
        // U+2028 LINE SEPARATOR, another boundary `.lines()` ignores.
        let dir = temp_dir("line-sep-name");
        let skill_dir = dir.join("skills").join("real-name");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nnote: \"a\u{2028}name: evil\"\nname: real-name\ndescription: d.\n---\n\nBody.\n",
        )
        .unwrap();

        let model = parse_canonical(&dir).unwrap();
        assert_eq!(model.skills[0].name, "real-name");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn skill_yaml_name_quoted_matching_directory_is_accepted() {
        let dir = temp_dir("quoted-name");
        let skill_dir = dir.join("skills").join("actual-dir-name");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: \"actual-dir-name\"\ndescription: d.\n---\n\nBody.\n",
        )
        .unwrap();

        let model = parse_canonical(&dir).unwrap();
        assert_eq!(model.skills[0].name, "actual-dir-name");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn skill_name_with_uppercase_is_rejected() {
        let dir = temp_dir("uppercase");
        let skill_dir = dir.join("skills").join("Bad-Name");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: Bad-Name\ndescription: d.\n---\n\nBody.\n",
        )
        .unwrap();

        let err = parse_canonical(&dir).unwrap_err();
        assert_eq!(err.field, Some("name".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn auxiliary_file_symlink_is_rejected() {
        let dir = temp_dir("aux-symlink");
        write_skill(&dir, "symlink-skill");
        let outside = dir.join("outside.txt");
        fs::write(&outside, "secret").unwrap();
        let link = dir.join("skills").join("symlink-skill").join("pwn");
        std::os::unix::fs::symlink(&outside, &link).unwrap();

        let err = parse_canonical(&dir).unwrap_err();
        assert!(err.reason.contains("symlink"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn skill_directory_symlink_is_rejected() {
        let dir = temp_dir("skill-dir-symlink");
        write_skill(&dir, "real-skill");
        let real_skill_dir = dir.join("skills").join("real-skill");
        let link = dir.join("skills").join("linked-skill");
        std::os::unix::fs::symlink(&real_skill_dir, &link).unwrap();

        let err = parse_canonical(&dir).unwrap_err();
        assert!(err.reason.contains("symlink"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn skill_md_symlink_is_rejected() {
        let dir = temp_dir("skill-md-symlink");
        let skill_dir = dir.join("skills").join("linked-skill-md");
        fs::create_dir_all(&skill_dir).unwrap();
        let target = skill_dir.join("real-content.md");
        fs::write(&target, "not actually SKILL.md content").unwrap();
        let skill_md = skill_dir.join("SKILL.md");
        std::os::unix::fs::symlink(&target, &skill_md).unwrap();

        let err = parse_canonical(&dir).unwrap_err();
        assert!(err.reason.contains("symlink"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn frontmatter_is_preserved_verbatim_including_unmodeled_and_ambiguous_shaped_keys() {
        // Passthrough: synth does not parse frontmatter into typed
        // fields or reject ambiguous scalar shapes -- the raw text
        // (including a bare `yes`) round-trips unchanged.
        let dir = temp_dir("verbatim-frontmatter");
        let skill_dir = dir.join("skills").join("verbatim-frontmatter");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: verbatim-frontmatter\ndescription: d.\nversion: yes\nlicense: 42\ntags: not-a-list\n---\n\nBody.\n",
        )
        .unwrap();

        let model = parse_canonical(&dir).unwrap();
        let skill = &model.skills[0];
        assert_eq!(
            skill.raw_frontmatter,
            "name: verbatim-frontmatter\ndescription: d.\nversion: yes\nlicense: 42\ntags: not-a-list"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sop_with_empty_stem_is_rejected() {
        let dir = temp_dir("empty-sop-stem");
        fs::create_dir_all(dir.join("agent-sops")).unwrap();
        fs::write(dir.join("agent-sops").join(".sop.md"), "# Body\n").unwrap();

        let err = parse_canonical(&dir).unwrap_err();
        assert_eq!(err.field, Some("name".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sop_name_is_accepted_with_valid_stem() {
        let dir = temp_dir("valid-sop-stem");
        write_sop(&dir, "valid-sop");
        let model = parse_canonical(&dir).unwrap();
        assert_eq!(model.sops.len(), 1);
        assert_eq!(model.sops[0].name, "valid-sop");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn oversized_skill_md_is_rejected() {
        let dir = temp_dir("oversized-skill-md");
        let skill_dir = dir.join("skills").join("oversized-skill-md");
        fs::create_dir_all(&skill_dir).unwrap();
        let oversized = "x".repeat((MAX_AUXILIARY_FILE_BYTES + 1) as usize);
        fs::write(skill_dir.join("SKILL.md"), oversized).unwrap();

        let err = parse_canonical(&dir).unwrap_err();
        assert!(err.reason.contains("SKILL.md size"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn source_dir_is_a_file_returns_error() {
        let dir = temp_dir("source-is-file");
        let file_path = dir.join("not-a-directory.txt");
        fs::write(&file_path, "content").unwrap();

        let err = parse_canonical(&file_path).unwrap_err();
        assert!(err.reason.contains("source_dir is a file"));
        let _ = fs::remove_dir_all(&dir);
    }

    /// A `source_dir` that does not exist at all must fail loudly, not
    /// parse as a valid-but-empty `CanonicalModel`. Without this guard,
    /// `agents/`, `skills/`, `agent-sops/`, and `context/` underneath a
    /// nonexistent path also don't exist, and each subdirectory parser
    /// treats "missing subdirectory" as "zero entries" rather than an
    /// error -- so the whole tree would silently parse as empty. The
    /// guard lives in this shared function (not only in
    /// `doctor::check_source`) so `synth`/`install --from` get the same
    /// protection as `doctor`.
    #[test]
    fn source_dir_that_does_not_exist_returns_error() {
        let base = temp_dir("source-dir-nonexistent-base");
        let nonexistent = base.join("does-not-exist-at-all");
        assert!(
            !nonexistent.exists(),
            "path must not exist for this test to be valid"
        );

        let err = parse_canonical(&nonexistent).unwrap_err();
        assert!(
            err.reason.contains("does not exist"),
            "expected a does-not-exist error, got: {err:?}"
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn agent_with_valid_context_names_resolves_context_files() {
        let dir = temp_dir("valid-context");
        write_context(&dir, "routing-rules.md");
        write_agent_spec_with_context_names(&dir, "k-example", &["routing-rules.md"]);

        let model = parse_canonical(&dir).unwrap();
        assert_eq!(model.context.len(), 1);
        assert_eq!(model.context[0].name, "routing-rules.md");
        assert_eq!(
            model.agents[0].dependencies.context.context_names,
            vec!["routing-rules.md".to_string()]
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// The exact bug this whole feature exists to fix: an agent spec
    /// declaring a `contextNames` entry with no corresponding file
    /// under `context/` must fail loudly at synth, naming the agent and
    /// the missing file -- never silently ship nothing.
    #[test]
    fn agent_with_dangling_context_name_is_rejected() {
        let dir = temp_dir("dangling-context");
        write_agent_spec_with_context_names(&dir, "k-example", &["missing-file.md"]);

        let err = parse_canonical(&dir).unwrap_err();
        assert_eq!(
            err.field,
            Some("dependencies.context.contextNames".to_string())
        );
        assert!(err.reason.contains("k-example"));
        assert!(err.reason.contains("missing-file.md"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn agent_with_no_context_names_is_unaffected_by_context_dir() {
        let dir = temp_dir("no-context-names");
        write_agent_spec(&dir, "k-example");
        write_context(&dir, "unrelated.md");

        let model = parse_canonical(&dir).unwrap();
        assert_eq!(model.agents.len(), 1);
        assert!(model.agents[0]
            .dependencies
            .context
            .context_names
            .is_empty());
        assert_eq!(model.context.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    /// A real, plausible authoring mistake: an agent's `dependencies.skills`
    /// names a skill with no corresponding directory under `skills/`. Must
    /// fail loudly, naming the agent, the field, and the missing skill --
    /// analogous to `agent_with_dangling_context_name_is_rejected`.
    #[test]
    fn agent_with_dangling_dependencies_skills_entry_is_rejected() {
        let dir = temp_dir("dangling-dependencies-skills");
        write_agent_spec_with_dependencies_skills(&dir, "k-example", &["missing-skill"]);

        let err = parse_canonical(&dir).unwrap_err();
        assert_eq!(
            err.field,
            Some("dependencies.skills.skillNames".to_string())
        );
        assert!(err.reason.contains("k-example"));
        assert!(err.reason.contains("missing-skill"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn agent_with_valid_dependencies_skills_entry_resolves_skill() {
        let dir = temp_dir("valid-dependencies-skills");
        write_skill(&dir, "real-skill");
        write_agent_spec_with_dependencies_skills(&dir, "k-example", &["real-skill"]);

        let model = parse_canonical(&dir).unwrap();
        assert_eq!(model.agents.len(), 1);
        assert_eq!(model.skills.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Regression test for a real bug: an earlier implementation iterated
    /// `dependencies.skills`'s map KEYS directly (i.e. checked the literal
    /// string `"skillNames"` against `skills/`), which fails every real
    /// agent spec since none of them ship a skill literally named
    /// `skillNames`. The wrapper key itself must never be treated as a
    /// skill name -- only the strings inside its array value are.
    #[test]
    fn agent_with_dependencies_skills_wrapper_key_is_not_treated_as_a_skill_name() {
        let dir = temp_dir("dependencies-skills-wrapper-key-not-a-skill");
        write_skill(&dir, "real-skill");
        write_agent_spec_with_dependencies_skills(&dir, "k-example", &["real-skill"]);

        let model = parse_canonical(&dir).unwrap();
        assert_eq!(model.agents.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Same authoring mistake via `clientConfig.claudeCli.skills` instead
    /// of `dependencies.skills` -- both fields name skills by exact
    /// directory name and must be checked.
    #[test]
    fn agent_with_dangling_claude_cli_skills_entry_is_rejected() {
        let dir = temp_dir("dangling-claude-cli-skills");
        write_agent_spec_with_claude_cli_skills(&dir, "k-example", &["missing-skill"]);

        let err = parse_canonical(&dir).unwrap_err();
        assert_eq!(err.field, Some("clientConfig.claudeCli.skills".to_string()));
        assert!(err.reason.contains("k-example"));
        assert!(err.reason.contains("missing-skill"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn agent_with_valid_claude_cli_skills_entry_resolves_skill() {
        let dir = temp_dir("valid-claude-cli-skills");
        write_skill(&dir, "real-skill");
        write_agent_spec_with_claude_cli_skills(&dir, "k-example", &["real-skill"]);

        let model = parse_canonical(&dir).unwrap();
        assert_eq!(model.agents.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Same authoring mistake via a non-wildcard `skill://` entry in
    /// `clientConfig.kiroCli.resources` (e.g.
    /// `skill://~/.kiro/skills/missing-skill/SKILL.md`).
    #[test]
    fn agent_with_dangling_kiro_cli_resource_skill_reference_is_rejected() {
        let dir = temp_dir("dangling-kiro-cli-resources");
        write_agent_spec_with_kiro_cli_resources(
            &dir,
            "k-example",
            &["skill://~/.kiro/skills/missing-skill/SKILL.md"],
        );

        let err = parse_canonical(&dir).unwrap_err();
        assert_eq!(
            err.field,
            Some("clientConfig.kiroCli.resources".to_string())
        );
        assert!(err.reason.contains("k-example"));
        assert!(err.reason.contains("missing-skill"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn agent_with_valid_kiro_cli_resource_skill_reference_resolves_skill() {
        let dir = temp_dir("valid-kiro-cli-resources");
        write_skill(&dir, "real-skill");
        write_agent_spec_with_kiro_cli_resources(
            &dir,
            "k-example",
            &["skill://~/.kiro/skills/real-skill/SKILL.md"],
        );

        let model = parse_canonical(&dir).unwrap();
        assert_eq!(model.agents.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    /// A wildcard `skill://` resource entry (e.g. per-workspace skills
    /// living outside the canonical source tree) is a glob, not a
    /// reference to one named skill, and must never be checked against
    /// `skills/` -- this is real production shape (see every shipped
    /// agent's `skill://.kiro/skills/ws-*/SKILL.md` entry).
    #[test]
    fn agent_with_wildcard_kiro_cli_resource_entry_is_never_checked() {
        let dir = temp_dir("wildcard-kiro-cli-resources");
        write_agent_spec_with_kiro_cli_resources(
            &dir,
            "k-example",
            &["skill://.kiro/skills/ws-*/SKILL.md"],
        );

        let model = parse_canonical(&dir).unwrap();
        assert_eq!(model.agents.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    /// A real, plausible authoring mistake: an agent's
    /// `dependencies.agentSops.agentSopNames` names an SOP with no
    /// corresponding file under `agent-sops/`. Must fail loudly, naming
    /// the agent, the field, and the missing SOP -- analogous to
    /// `agent_with_dangling_dependencies_skills_entry_is_rejected`.
    #[test]
    fn agent_with_dangling_sop_name_is_rejected() {
        let dir = temp_dir("dangling-sop-name");
        write_agent_spec_with_sop_names(&dir, "k-example", &["missing-sop"]);

        let err = parse_canonical(&dir).unwrap_err();
        assert_eq!(
            err.field,
            Some("dependencies.agentSops.agentSopNames".to_string())
        );
        assert!(err.reason.contains("k-example"));
        assert!(err.reason.contains("missing-sop"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn agent_with_valid_sop_name_resolves_sop() {
        let dir = temp_dir("valid-sop-name");
        write_sop(&dir, "real-sop");
        write_agent_spec_with_sop_names(&dir, "k-example", &["real-sop"]);

        let model = parse_canonical(&dir).unwrap();
        assert_eq!(model.agents.len(), 1);
        assert_eq!(model.sops.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn agent_with_no_agent_sop_names_is_unaffected_by_sops_dir() {
        let dir = temp_dir("no-agent-sop-names");
        write_agent_spec(&dir, "k-example");
        write_sop(&dir, "unrelated-sop");

        let model = parse_canonical(&dir).unwrap();
        assert_eq!(model.agents.len(), 1);
        assert!(model.agents[0]
            .dependencies
            .agent_sops
            .agent_sop_names
            .is_empty());
        assert_eq!(model.sops.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicate_context_name_is_rejected() {
        let dir = temp_dir("dup-context");
        fs::create_dir_all(dir.join("context")).unwrap();
        // A single filesystem can't hold two files with the same name,
        // so exercise the production `assert_unique_names` path
        // directly against a hand-crafted vec, matching this file's
        // other duplicate-name tests (see `duplicate_skill_name_is_rejected`).
        let context = vec![
            ContextDef {
                name: "dup.md".to_string(),
                body: "a".to_string(),
            },
            ContextDef {
                name: "dup.md".to_string(),
                body: "b".to_string(),
            },
        ];
        let labels = vec!["context/dup.md".to_string(), "context/dup.md".to_string()];
        let err = assert_unique_names(&context, |c| c.name.as_str(), &labels, "context")
            .expect_err("expected a duplicate-name ParseError");
        assert_eq!(err.field, Some("name".to_string()));
        assert!(err.reason.contains("duplicate name"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn parse_context_rejects_symlink() {
        use std::os::unix::fs::symlink;
        let dir = temp_dir("context-symlink");
        fs::create_dir_all(dir.join("context")).unwrap();
        // A symlink under context/ pointing outside the tree must be
        // rejected, not dereferenced and its target copied into dist/
        // (an information-disclosure path). Matches the skill contract.
        let outside = dir.join("secret.txt");
        fs::write(&outside, b"secret\n").unwrap();
        symlink(&outside, dir.join("context").join("leak.md")).unwrap();
        let err = parse_canonical(&dir).unwrap_err();
        assert!(
            err.reason.contains("symlink"),
            "expected a symlink-rejection error, got: {err:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_context_rejects_oversized_file() {
        let dir = temp_dir("context-oversize");
        fs::create_dir_all(dir.join("context")).unwrap();
        let oversized = "x".repeat((MAX_AUXILIARY_FILE_BYTES + 1) as usize);
        fs::write(dir.join("context").join("big.md"), oversized).unwrap();
        let err = parse_canonical(&dir).unwrap_err();
        assert!(
            err.reason.contains("exceeds maximum"),
            "expected a size-cap error, got: {err:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// Test fixture (see `tests/fixtures/model_cases.json`) so
    /// assertions derive from one source of truth rather than
    /// hand-duplicated literals.
    const MODEL_FIXTURE_CASES: &str = include_str!("../../../tests/fixtures/model_cases.json");

    fn write_fixture_files(dir: &Path, files: &serde_json::Map<String, Value>) {
        for (rel_path, content) in files {
            let path = dir.join(rel_path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, content.as_str().unwrap()).unwrap();
        }
    }

    #[test]
    fn shared_fixture_cases_match_expected() {
        let doc: serde_json::Value = serde_json::from_str(MODEL_FIXTURE_CASES).unwrap();
        let cases = doc["cases"].as_array().unwrap();
        let mut checked = 0;
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let dir = temp_dir(&format!("fixture-{name}"));

            if let Some(files) = case["files"].as_object() {
                write_fixture_files(&dir, files);
            }

            // `source_dir_is_file` fixture cases point parse_canonical at
            // a file, not the constructed tree, to exercise Fix 8.
            let source_dir = if case["input"].get("source_dir_is_file") == Some(&Value::Bool(true))
            {
                let file_path = dir.join("not-a-directory.txt");
                fs::write(&file_path, "content").unwrap();
                file_path
            } else if case["input"].get("skill_md_oversized") == Some(&Value::Bool(true)) {
                // A 1MB+ fixture string is impractical to embed in JSON;
                // synthesize the oversized SKILL.md directly on disk.
                let skill_dir = dir.join("skills").join("oversized-skill-md");
                fs::create_dir_all(&skill_dir).unwrap();
                let oversized = "x".repeat((MAX_AUXILIARY_FILE_BYTES + 1) as usize);
                fs::write(skill_dir.join("SKILL.md"), oversized).unwrap();
                dir.clone()
            } else {
                dir.clone()
            };

            let result = parse_canonical(&source_dir);

            if let Some(expected_ok) = case["expected"].get("ok") {
                checked += 1;
                let model =
                    result.unwrap_or_else(|e| panic!("case {name} expected ok, got error: {e}"));

                let agent_names: Vec<&str> = model.agents.iter().map(|a| a.name.as_str()).collect();
                let expected_agent_names: Vec<&str> = expected_ok["agent_names"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap())
                    .collect();
                assert_eq!(
                    agent_names, expected_agent_names,
                    "case {name}: agent_names"
                );

                let skill_names: Vec<&str> = model.skills.iter().map(|s| s.name.as_str()).collect();
                let expected_skill_names: Vec<&str> = expected_ok["skill_names"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap())
                    .collect();
                assert_eq!(
                    skill_names, expected_skill_names,
                    "case {name}: skill_names"
                );

                let sop_names: Vec<&str> = model.sops.iter().map(|s| s.name.as_str()).collect();
                let expected_sop_names: Vec<&str> = expected_ok["sop_names"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap())
                    .collect();
                assert_eq!(sop_names, expected_sop_names, "case {name}: sop_names");

                if let Some(expected_raw) = expected_ok
                    .get("skill_raw_frontmatter")
                    .and_then(|v| v.as_str())
                {
                    let skill = model
                        .skills
                        .iter()
                        .find(|s| Some(s.name.as_str()) == expected_skill_names.first().copied())
                        .unwrap_or_else(|| panic!("case {name}: expected at least one skill"));
                    assert_eq!(
                        skill.raw_frontmatter, expected_raw,
                        "case {name}: skill_raw_frontmatter"
                    );
                }

                if let Some(expected_body) = expected_ok.get("skill_body").and_then(|v| v.as_str())
                {
                    let skill = model
                        .skills
                        .iter()
                        .find(|s| s.name == skill_names[0])
                        .unwrap();
                    assert_eq!(skill.body, expected_body, "case {name}: skill_body");
                }
            } else if let Some(expected_error) = case["expected"].get("error") {
                checked += 1;
                let err = result.expect_err(&format!("case {name} expected error, got ok"));
                if let Some(field) = expected_error.get("field").and_then(|v| v.as_str()) {
                    assert_eq!(
                        err.field.as_deref(),
                        Some(field),
                        "case {name}: error.field"
                    );
                }
                if let Some(substring) = expected_error
                    .get("reason_substring")
                    .and_then(|v| v.as_str())
                {
                    assert!(
                        err.reason.contains(substring),
                        "case {name}: expected reason to contain {substring:?}, got {:?}",
                        err.reason
                    );
                }
            }

            let _ = fs::remove_dir_all(&dir);
        }
        assert!(checked > 0, "expected at least one fixture case");
    }
}
