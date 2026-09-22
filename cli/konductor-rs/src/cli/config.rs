// SPDX-License-Identifier: Apache-2.0
//
// config.rs — Konductor config loader (Rust implementation).
//
// ── Scope (M1 declarative contract) ────────────────────────────────────────
// Reads `.konductor/config.yml` from the current project root if present,
// falls back to / merges with the preset defaults shipped at
// cli/gate-config/config.yml, validates required fields, and surfaces
// clear errors.
//
// ── Exit-code contract (IMPORTANT) ─────────────────────────────────────────
// A malformed or invalid config on user invocation is a USAGE ERROR, not
// the run-engine's "unresolved CRITICAL gate" signal. Per cli.rs's
// EXIT_USAGE_ERROR (64) / EXIT_CRITICAL_GATE (2) constants: this module
// never emits or reasons about exit code 2. Callers (cli/dispatch.rs) are
// responsible for mapping a `ConfigError` returned from this module to
// exit code 64 -- this module itself has no process::exit call, so it
// stays exit-code-agnostic and testable in isolation.
//
// ── Merge semantics ─────────────────────────────────────────────────────────
// The project config is merged FIELD-BY-FIELD over the preset defaults:
// any field present (non-null) in the project's `.konductor/config.yml`
// overrides the preset's value for that field; an absent field falls back
// to the preset. This is a shallow, whole-field merge -- nothing here
// requires deep merging, since every field (including `tier`) is a
// single scalar. Deep-merge semantics are deferred to whichever milestone
// first needs them; nothing in the M1 scope requires more than this.
// A third tier, `~/.konductor/config.yml` (user-level), merges between
// preset and project: preset -> user -> project, project wins on conflict;
// a missing user-level file is not an error, same as a missing project file.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::cli::install::index;

/// Config schema versions this loader understands. Bump alongside
/// cli/gate-config/config.yml's `version` field if the schema changes
/// incompatibly.
const SUPPORTED_CONFIG_VERSION: u64 = 1;

/// Severity ids valid at this milestone. Mirrors
/// cli/gate-config/severity-schema.yml's `severities[].id` list. Not
/// loaded dynamically from that YAML file at runtime (that file is
/// human/gate-author-facing reference data, not itself parsed by this
/// loader) -- kept as a small enum here and validated against by name,
/// since the set is fixed for this milestone.
///
/// `Config`'s own `default_severity`/`fail_on_severity_at_or_above`
/// fields stay `String` (the on-disk YAML representation, and the
/// stringified value `config get`/`config list` print) -- this enum
/// exists purely so in-memory validation/comparison sites use
/// `Severity::from_str` instead of matching bare string literals
/// against `VALID_SEVERITIES`. YAML has no enum type, so the on-disk
/// representation stays a plain string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Severity {
    Critical,
    High,
    Medium,
    Low,
    Info,
}

impl std::str::FromStr for Severity {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "CRITICAL" => Ok(Severity::Critical),
            "HIGH" => Ok(Severity::High),
            "MEDIUM" => Ok(Severity::Medium),
            "LOW" => Ok(Severity::Low),
            "INFO" => Ok(Severity::Info),
            _ => Err(()),
        }
    }
}

impl std::fmt::Display for Severity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Severity::Critical => "CRITICAL",
            Severity::High => "HIGH",
            Severity::Medium => "MEDIUM",
            Severity::Low => "LOW",
            Severity::Info => "INFO",
        };
        f.write_str(s)
    }
}

/// Backwards-compatible view of `Severity`'s values, for call sites that
/// want a plain slice (e.g. formatting an "expected one of ..." error
/// message).
const VALID_SEVERITIES: &[&str] = &["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

/// Tier ids valid at this milestone. Mirrors
/// cli/gate-config/scope-table.yml's `tiers` keys. A run has exactly one
/// active tier (not a set), validated against this fixed list.
const VALID_TIERS: &[&str] = &["trivial", "bugfix", "minor", "major", "full"];

/// Directory name a Konductor project/user config lives under, relative
/// to the project root or `$HOME`. Single source of truth for this
/// literal -- referenced by dispatch.rs, init.rs, and logging.rs instead
/// of each repeating `".konductor"`.
pub(crate) const KONDUCTOR_DIR_NAME: &str = ".konductor";

/// Config file name within `KONDUCTOR_DIR_NAME`. Single source of truth
/// for this literal.
pub(crate) const CONFIG_FILE_NAME: &str = "config.yml";

/// A loaded, validated Konductor configuration: the merge of a project's
/// `.konductor/config.yml` (if present) over the preset defaults shipped
/// at `cli/gate-config/config.yml`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Config {
    pub version: u64,
    pub severities_source: String,
    pub tiers_source: String,
    pub tier: String,
    pub default_severity: String,
    pub fail_on_severity_at_or_above: String,
}

/// Raw, partially-populated config as parsed directly from a YAML
/// document -- every field optional, since a project's own
/// `.konductor/config.yml` is allowed to omit any field and fall back to
/// the preset default for it. Deserialized separately from `Config`
/// (rather than making `Config`'s own fields `Option`) so `Config` itself
/// stays a fully-populated, already-merged-and-validated type everywhere
/// else in the codebase uses it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct RawConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    severities_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tiers_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_severity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fail_on_severity_at_or_above: Option<String>,
}

/// All the ways loading/validating a config can fail. Every variant is a
/// USAGE ERROR from the CLI's perspective (see module docstring) -- never
/// map any of these to exit code 2.
#[derive(Debug)]
pub enum ConfigError {
    /// The preset defaults, embedded at compile time from
    /// cli/gate-config/config.yml (see `PRESET_CONFIG_CONTENTS`), could
    /// not be parsed as YAML. A packaging bug, not a user error, but
    /// handled the same way as any other malformed-YAML case for
    /// consistency. Since the preset is now compiled in rather than read
    /// from disk at runtime, this can only be triggered by a broken build
    /// (a malformed cli/gate-config/config.yml at compile time) -- never
    /// by anything at the user's runtime environment.
    PresetMalformed {
        path: PathBuf,
        source: serde_yaml::Error,
    },
    /// The project's `.konductor/config.yml` exists but could not be
    /// read (e.g. permissions).
    ProjectConfigNotReadable {
        path: PathBuf,
        source: std::io::Error,
    },
    /// The project's `.konductor/config.yml` exists but is not valid
    /// YAML, or its shape does not match the expected fields.
    ProjectConfigMalformed {
        path: PathBuf,
        source: serde_yaml::Error,
    },
    /// The merged config's `version` field is not one this loader
    /// understands.
    UnsupportedVersion { found: u64, supported: u64 },
    /// The merged config's `default_severity` or
    /// `fail_on_severity_at_or_above` is not one of the known severity
    /// ids (see `VALID_SEVERITIES`).
    UnknownSeverity { field: &'static str, value: String },
    /// The merged config's `tier` is not one of the known tier ids (see
    /// `VALID_TIERS`).
    UnknownTier { value: String },
    /// `config set` was given a key that is not one of `_CONFIG_FIELDS`.
    /// Mirrors `config get`'s existing unknown-key handling (see
    /// dispatch.rs's `get_field`, which returns `None` for the same
    /// condition).
    UnknownKey { key: String },
    /// `config set`'s value could not be parsed/validated against the
    /// target field's expected type (e.g. a non-integer `version`, or a
    /// `default_severity` outside `VALID_SEVERITIES`).
    InvalidValue {
        key: String,
        value: String,
        reason: String,
    },
    /// The updated project config could not be serialized back to YAML
    /// (a packaging/programmer-error case -- `RawConfig` values built
    /// from validated input should always serialize).
    SerializeFailed { source: serde_yaml::Error },
    /// The updated project config could not be written to
    /// `.konductor/config.yml` (permissions, read-only filesystem, disk
    /// full, etc.).
    WriteFailed {
        path: PathBuf,
        source: std::io::Error,
    },
    /// Could not acquire the exclusive lock guarding the read-merge-write
    /// cycle below (see `cli::config_lock`'s module docstring for why
    /// this is needed): either the lock file/dir could not be
    /// opened/created, or another process held the lock for the entire
    /// bounded wait. Both cases are surfaced identically to the caller
    /// (a `config set` USAGE ERROR, exit 64) since neither is something
    /// the CLI itself can resolve.
    LockFailed {
        source: crate::cli::config_lock::ConfigLockError,
    },
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::PresetMalformed { path, source } => write!(
                f,
                "preset config defaults at {} are not valid YAML: {source}",
                path.display()
            ),
            ConfigError::ProjectConfigNotReadable { path, source } => write!(
                f,
                "could not read config file {}: {source}",
                path.display()
            ),
            ConfigError::ProjectConfigMalformed { path, source } => write!(
                f,
                "config file {} is not valid YAML: {source}",
                path.display()
            ),
            ConfigError::UnsupportedVersion { found, supported } => write!(
                f,
                "config version {found} is not supported by this CLI (expected {supported})"
            ),
            ConfigError::UnknownSeverity { field, value } => write!(
                f,
                "config field '{field}' has unknown severity '{value}' (expected one of {VALID_SEVERITIES:?})"
            ),
            ConfigError::UnknownTier { value } => write!(
                f,
                "config field 'tier' has unknown tier '{value}' (expected one of {VALID_TIERS:?})"
            ),
            ConfigError::UnknownKey { key } => write!(f, "unknown config key '{key}'"),
            ConfigError::InvalidValue { key, value, reason } => write!(
                f,
                "invalid value '{value}' for config key '{key}': {reason}"
            ),
            ConfigError::SerializeFailed { source } => {
                write!(f, "could not serialize updated config: {source}")
            }
            ConfigError::WriteFailed { path, source } => {
                write!(f, "could not write {}: {source}", path.display())
            }
            ConfigError::LockFailed { source } => write!(f, "{source}"),
        }
    }
}

impl std::error::Error for ConfigError {}

impl ConfigError {
    /// A stable, closed error-category string --
    /// never this error's own `Display` text, which routinely embeds a
    /// local filesystem path or a caller-supplied key/value.
    pub(crate) fn error_code(&self) -> &'static str {
        match self {
            ConfigError::PresetMalformed { .. } => "config.preset_malformed",
            ConfigError::ProjectConfigNotReadable { .. } => "config.project_config_not_readable",
            ConfigError::ProjectConfigMalformed { .. } => "config.project_config_malformed",
            ConfigError::UnsupportedVersion { .. } => "config.unsupported_version",
            ConfigError::UnknownSeverity { .. } => "config.unknown_severity",
            ConfigError::UnknownTier { .. } => "config.unknown_tier",
            ConfigError::UnknownKey { .. } => "config.unknown_key",
            ConfigError::InvalidValue { .. } => "config.invalid_value",
            ConfigError::SerializeFailed { .. } => "config.serialize_failed",
            ConfigError::WriteFailed { .. } => "config.write_failed",
            ConfigError::LockFailed { .. } => "config.lock_failed",
        }
    }
}

/// Preset config contents, embedded at compile time from
/// `cli/gate-config/config.yml` via `include_str!`.
///
/// Embedding the contents at compile time (rather than resolving a path
/// via `env!("CARGO_MANIFEST_DIR")` and reading it at runtime) avoids
/// baking the compile-time source-tree path into the binary: a path
/// resolved from `CARGO_MANIFEST_DIR` only exists on the machine that
/// built the binary, so once the binary is installed/run anywhere else
/// (a different machine, or even a different directory on the same
/// machine after the source tree is deleted or moved), every `init` /
/// `config` invocation would fail trying to read a path that no longer
/// exists. `include_str!` instead inlines the file's text into the
/// compiled binary itself at build time, so no filesystem access is
/// needed to obtain it ever again -- it is available unconditionally,
/// anywhere the binary runs.
///
/// `pub(crate)` rather than private: `init.rs` also needs this text, to
/// copy it verbatim into a freshly-scaffolded project's
/// `.konductor/config.yml` (see init.rs's module docstring for why it
/// copies text rather than re-serializing a parsed `Config`).
pub(crate) const PRESET_CONFIG_CONTENTS: &str = include_str!("../../../gate-config/config.yml");

/// Display-only label for the preset defaults, used in `PresetMalformed`
/// error messages. Not a filesystem path used for I/O (the preset is
/// compiled in via `PRESET_CONFIG_CONTENTS`, never read from disk at
/// runtime) -- kept only so error messages can still name the asset a
/// packaging bug would point at.
fn preset_config_display_path() -> PathBuf {
    PathBuf::from("cli/gate-config/config.yml")
}

/// Loads and validates the effective Konductor configuration: preset
/// defaults, then `~/.konductor/config.yml` (user-level, if present),
/// then the project's `.konductor/config.yml` (if it exists at
/// `project_root`) -- each tier overriding the previous.
///
/// `project_root` is the directory `.konductor/` is expected under (the
/// current working directory in normal CLI use; parameterized here so
/// tests can point at a scratch directory instead).
pub fn load_config(project_root: &Path) -> Result<Config, ConfigError> {
    load_config_with_home(project_root, dirs_home_dir().as_deref())
}

/// Same as `load_config`, but with the user's home directory passed in
/// explicitly rather than resolved from the `HOME` env var. Split out so
/// tests can exercise the user-tier merge deterministically without
/// mutating the process-global `HOME` env var, which is unsafe to do
/// from parallel `cargo test` threads (unlike a single CLI process,
/// where reading `HOME` once at startup is fine).
///
/// `pub(crate)` (not private) so `doctor::check_config_with_home`'s own
/// tests can drive a malformed-user-tier-config scenario the same
/// deterministic way, without mutating `HOME` either.
pub(crate) fn load_config_with_home(
    project_root: &Path,
    home_dir: Option<&Path>,
) -> Result<Config, ConfigError> {
    let preset = load_preset_defaults()?;
    super::trace::trace("trace", "config: loaded preset defaults layer");

    let merged = match home_dir {
        Some(home) => {
            let user_config_path = home.join(KONDUCTOR_DIR_NAME).join(CONFIG_FILE_NAME);
            if user_config_path.is_file() {
                let raw_user = load_raw_config(&user_config_path)?;
                super::trace::trace(
                    "trace",
                    &format!(
                        "config: applied user-tier layer from {}",
                        user_config_path.display()
                    ),
                );
                merge(preset, raw_user)
            } else {
                preset
            }
        }
        None => preset,
    };

    let project_config_path = project_root.join(KONDUCTOR_DIR_NAME).join(CONFIG_FILE_NAME);
    let merged = if project_config_path.is_file() {
        let raw_project = load_raw_config(&project_config_path)?;
        super::trace::trace(
            "trace",
            &format!(
                "config: applied project-tier layer from {}",
                project_config_path.display()
            ),
        );
        merge(merged, raw_project)
    } else {
        merged
    };

    validate(&merged)
}

/// Resolves the current user's home directory for locating
/// `~/.konductor/config.yml`. Routes through `index::env_home_dir`
/// rather than reading `HOME` directly, so `HOME=""` is treated the
/// same as unset -- skips the user-tier merge entirely, rather than
/// resolving to a relative `.konductor/config.yml` that would read (or
/// silently miss) a cwd-relative file no user asked for.
fn dirs_home_dir() -> Option<PathBuf> {
    index::env_home_dir()
}

/// `config set <key> <value>`: validates `key` against the known config
/// field set (`_CONFIG_FIELDS`), parses/validates `value` against that
/// field's expected type, merges the result into the project's existing
/// `.konductor/config.yml` (or the preset defaults if no project config
/// exists yet), and writes it back atomically via `atomic_write`.
///
/// Reuses `load_config`'s "load raw config, merge with preset defaults"
/// pipeline: the updated project `RawConfig` is re-merged with the
/// preset and re-validated via `validate` before writing, so a `set`
/// can never persist a config that would fail to load afterward.
///
/// ── Concurrency (lost-update race fix) ──────────────────────────────────
/// The read, merge, and write are a single critical section: two
/// concurrent `set_config_value` calls that both read the same
/// pre-update snapshot would each write a full-file rewrite reflecting
/// only their own change, silently discarding whichever write lands
/// first. `write_atomic` alone doesn't prevent this -- it only
/// guarantees the write itself is crash-safe, not that the
/// read-merge-write cycle around it is serialized. `config_lock::acquire`
/// closes that gap: an exclusive lock is held for the entire cycle
/// below, so concurrent `config set` calls serialize rather than racing.
/// A timed-out lock acquisition returns `ConfigError::LockFailed`
/// (exit 64) rather than blocking indefinitely.
///
/// Returns the fully-validated effective `Config` after the write, so
/// the caller can echo a confirmation.
pub fn set_config_value(
    project_root: &Path,
    key: &str,
    value: &str,
) -> Result<Config, ConfigError> {
    if !_CONFIG_FIELDS.contains(&key) {
        return Err(ConfigError::UnknownKey {
            key: key.to_string(),
        });
    }

    let konductor_dir = project_root.join(KONDUCTOR_DIR_NAME);

    // Acquire the lock BEFORE the read step and hold `_lock_guard` until
    // this function returns (it drops, releasing the lock, at the end of
    // this scope) -- the read, merge, and write below must all happen
    // while this lock is held, or the race this lock exists to close
    // reopens.
    let _lock_guard = crate::cli::config_lock::acquire(&konductor_dir)
        .map_err(|source| ConfigError::LockFailed { source })?;

    let project_config_path = konductor_dir.join(CONFIG_FILE_NAME);
    let mut raw_project = if project_config_path.is_file() {
        load_raw_config(&project_config_path)?
    } else {
        RawConfig::default()
    };

    apply_field(&mut raw_project, key, value)?;

    // Re-validate the FULL effective config (project merged over preset)
    // before writing anything, so a `set` can never persist a value that
    // would leave the project unloadable.
    let preset = load_preset_defaults()?;
    let effective = validate(&merge(preset, raw_project.clone()))?;

    std::fs::create_dir_all(&konductor_dir).map_err(|source| ConfigError::WriteFailed {
        path: konductor_dir.clone(),
        source,
    })?;
    let serialized = serde_yaml::to_string(&raw_project)
        .map_err(|source| ConfigError::SerializeFailed { source })?;
    crate::cli::atomic_write::write_atomic(&project_config_path, serialized.as_bytes()).map_err(
        |source| ConfigError::WriteFailed {
            path: project_config_path.clone(),
            source,
        },
    )?;

    Ok(effective)
}

/// Parses `value` against `key`'s expected type and writes it into
/// `raw_project`'s matching field. Mirrors `get_field`/`list_fields`'
/// (dispatch.rs) field set and stringification rules in reverse.
/// `default_severity` / `fail_on_severity_at_or_above` are validated
/// against `VALID_SEVERITIES`, and `tier` against `VALID_TIERS`, up
/// front (rather than deferring entirely to the post-merge `validate`
/// call) so an invalid value is reported against the specific key/value
/// the user passed, not a generic merged-config error.
fn apply_field(raw_project: &mut RawConfig, key: &str, value: &str) -> Result<(), ConfigError> {
    match key {
        "version" => {
            let parsed = value
                .parse::<u64>()
                .map_err(|_| ConfigError::InvalidValue {
                    key: key.to_string(),
                    value: value.to_string(),
                    reason: "expected a non-negative integer".to_string(),
                })?;
            raw_project.version = Some(parsed);
        }
        "severities_source" => raw_project.severities_source = Some(value.to_string()),
        "tiers_source" => raw_project.tiers_source = Some(value.to_string()),
        "tier" => {
            if !VALID_TIERS.contains(&value) {
                return Err(ConfigError::InvalidValue {
                    key: key.to_string(),
                    value: value.to_string(),
                    reason: format!("expected one of {VALID_TIERS:?}"),
                });
            }
            raw_project.tier = Some(value.to_string());
        }
        "default_severity" => {
            require_severity(Some(value), "default_severity").map_err(|_| {
                ConfigError::InvalidValue {
                    key: key.to_string(),
                    value: value.to_string(),
                    reason: format!("expected one of {VALID_SEVERITIES:?}"),
                }
            })?;
            raw_project.default_severity = Some(value.to_string());
        }
        "fail_on_severity_at_or_above" => {
            require_severity(Some(value), "fail_on_severity_at_or_above").map_err(|_| {
                ConfigError::InvalidValue {
                    key: key.to_string(),
                    value: value.to_string(),
                    reason: format!("expected one of {VALID_SEVERITIES:?}"),
                }
            })?;
            raw_project.fail_on_severity_at_or_above = Some(value.to_string());
        }
        _ => {
            return Err(ConfigError::UnknownKey {
                key: key.to_string(),
            })
        }
    }
    Ok(())
}

/// The full set of config field names `config get`/`config set`/`config
/// list` recognize. Single source of truth for `config set`'s
/// unknown-key rejection, kept consistent with `Config`'s own fields and
/// dispatch.rs's `get_field`/`list_fields`.
///
/// `pub(crate)` (rather than private) so dispatch.rs's own test module
/// can assert its `get_field`/`list_fields` key sets exactly match this
/// one -- see dispatch.rs's `get_field_and_list_fields_match_config_fields`.
pub(crate) const _CONFIG_FIELDS: &[&str] = &[
    "version",
    "severities_source",
    "tiers_source",
    "tier",
    "default_severity",
    "fail_on_severity_at_or_above",
];

/// Parses the compiled-in preset defaults (`PRESET_CONFIG_CONTENTS`) as a
/// fully-populated `RawConfig` (every field expected present -- the
/// preset is the ultimate fallback, so it must not itself be relying on
/// any fallback).
///
/// Pure parsing, no filesystem access: the preset text is embedded at
/// compile time (see `PRESET_CONFIG_CONTENTS`'s docstring), so there is
/// no I/O path here to fail, and thus no `PresetNotReadable` case is
/// possible any more -- only a malformed-YAML packaging bug
/// (`PresetMalformed`) remains reachable.
fn load_preset_defaults() -> Result<RawConfig, ConfigError> {
    serde_yaml::from_str(PRESET_CONFIG_CONTENTS).map_err(|source| ConfigError::PresetMalformed {
        path: preset_config_display_path(),
        source,
    })
}

/// Loads a project's `.konductor/config.yml` as a `RawConfig` (fields
/// optional -- the project file may omit any field and rely on the
/// preset fallback for it).
///
/// An empty file, or one containing only a YAML document marker (`---`)
/// and/or comments, parses as YAML `null` rather than a mapping;
/// `serde_yaml` cannot deserialize `null` directly into `RawConfig`
/// (a struct), so this is handled explicitly via `Option<RawConfig>` and
/// defaulted to `RawConfig::default()` (all fields `None`, i.e. "defer
/// entirely to the preset"). Without this, an empty/near-empty config
/// file would incorrectly raise `ProjectConfigMalformed` instead of
/// falling back to the preset defaults for a legitimate, non-malformed
/// input.
fn load_raw_config(path: &Path) -> Result<RawConfig, ConfigError> {
    let contents =
        std::fs::read_to_string(path).map_err(|source| ConfigError::ProjectConfigNotReadable {
            path: path.to_path_buf(),
            source,
        })?;
    let raw: Option<RawConfig> =
        serde_yaml::from_str(&contents).map_err(|source| ConfigError::ProjectConfigMalformed {
            path: path.to_path_buf(),
            source,
        })?;
    Ok(raw.unwrap_or_default())
}

/// Field-by-field, shallow merge of `override_cfg` over `base` (see module
/// docstring's "Merge semantics" section). `base` is expected to already
/// be fully-populated by the time `validate` runs, so any field
/// `override_cfg` leaves `None` falls back to `base`'s value; a
/// truly-missing preset field (packaging bug) surfaces as a validation
/// error downstream rather than panicking here.
fn merge(base: RawConfig, override_cfg: RawConfig) -> RawConfig {
    RawConfig {
        version: override_cfg.version.or(base.version),
        severities_source: override_cfg.severities_source.or(base.severities_source),
        tiers_source: override_cfg.tiers_source.or(base.tiers_source),
        tier: override_cfg.tier.or(base.tier),
        default_severity: override_cfg.default_severity.or(base.default_severity),
        fail_on_severity_at_or_above: override_cfg
            .fail_on_severity_at_or_above
            .or(base.fail_on_severity_at_or_above),
    }
}

/// Validates a merged `RawConfig` and converts it into a fully-populated
/// `Config`. A field that is still `None` after merging against the
/// preset (i.e. the preset itself omitted it -- a packaging bug) is
/// reported the same way as any other invalid value, rather than
/// panicking or silently defaulting further.
fn validate(raw: &RawConfig) -> Result<Config, ConfigError> {
    let version = raw.version.ok_or(ConfigError::UnsupportedVersion {
        found: 0,
        supported: SUPPORTED_CONFIG_VERSION,
    })?;
    if version != SUPPORTED_CONFIG_VERSION {
        return Err(ConfigError::UnsupportedVersion {
            found: version,
            supported: SUPPORTED_CONFIG_VERSION,
        });
    }

    let tier = require_tier(raw.tier.as_deref())?;

    let default_severity = require_severity(raw.default_severity.as_deref(), "default_severity")?;
    let fail_on_severity_at_or_above = require_severity(
        raw.fail_on_severity_at_or_above.as_deref(),
        "fail_on_severity_at_or_above",
    )?;

    Ok(Config {
        version,
        severities_source: raw.severities_source.clone().unwrap_or_default(),
        tiers_source: raw.tiers_source.clone().unwrap_or_default(),
        tier,
        default_severity,
        fail_on_severity_at_or_above,
    })
}

/// Validates that `value` is present and one of `VALID_TIERS`, returning
/// it owned on success.
fn require_tier(value: Option<&str>) -> Result<String, ConfigError> {
    let value = value.ok_or_else(|| ConfigError::UnknownTier {
        value: "<missing>".to_string(),
    })?;
    if VALID_TIERS.contains(&value) {
        Ok(value.to_string())
    } else {
        Err(ConfigError::UnknownTier {
            value: value.to_string(),
        })
    }
}

/// Validates that `value` is present and one of `VALID_SEVERITIES`,
/// returning it owned on success.
fn require_severity(value: Option<&str>, field: &'static str) -> Result<String, ConfigError> {
    let value = value.ok_or_else(|| ConfigError::UnknownSeverity {
        field,
        value: "<missing>".to_string(),
    })?;
    if value.parse::<Severity>().is_ok() {
        Ok(value.to_string())
    } else {
        Err(ConfigError::UnknownSeverity {
            field,
            value: value.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-config-test-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// `HOME=""` must skip the user-tier merge the same way an unset
    /// `HOME` does, not resolve `dirs_home_dir()` to a relative path
    /// and read (or silently miss) a cwd-relative `.konductor/config.yml`
    /// no user asked for. Compares `load_config` (which resolves `HOME`
    /// from the environment) under `HOME=""` against
    /// `load_config_with_home(&root, None)` -- this file's own
    /// deliberate "no user tier" baseline -- rather than `HOME` unset,
    /// since the two must be indistinguishable to `load_config`.
    #[test]
    fn load_config_with_home_set_to_empty_string_skips_user_tier_like_unset() {
        let _guard = crate::cli::test_home_lock::lock_home();
        let root = scratch_dir("empty-home-skips-user-tier");
        let original_home = std::env::var_os("HOME");
        std::env::set_var("HOME", "");

        let with_empty_home = load_config(&root).expect("preset defaults must still load");

        match original_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }

        let with_no_user_tier =
            load_config_with_home(&root, None).expect("preset defaults must still load");

        assert_eq!(
            with_empty_home, with_no_user_tier,
            "HOME=\"\" must produce the exact same config as no user tier at all -- \
             resolving it to a relative path could pick up a stray .konductor/config.yml \
             under cwd and merge it in as if it were ~/.konductor/config.yml"
        );
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn loads_preset_defaults_successfully() {
        // Exercises the real shipped preset file end-to-end (no project
        // override) -- this is the "nothing exists yet" path `init` and
        // first-run `config` commands hit. Uses `load_config_with_home`
        // with `None` so this only ever reflects the preset, regardless
        // of whether the host running this test has a real
        // `~/.konductor/config.yml`.
        let root = scratch_dir("no-project-config");
        let config =
            load_config_with_home(&root, None).expect("preset defaults must load and validate");
        assert_eq!(config.version, SUPPORTED_CONFIG_VERSION);
        assert!(VALID_TIERS.contains(&config.tier.as_str()));
        assert!(VALID_SEVERITIES.contains(&config.default_severity.as_str()));
        assert!(VALID_SEVERITIES.contains(&config.fail_on_severity_at_or_above.as_str()));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn project_config_overrides_preset_fields() {
        let root = scratch_dir("project-override");
        let konductor_dir = root.join(KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&konductor_dir).unwrap();
        fs::write(
            konductor_dir.join(CONFIG_FILE_NAME),
            "version: 1\ndefault_severity: LOW\n",
        )
        .unwrap();

        // `load_config_with_home(&root, None)`, not `load_config(&root)`:
        // this only exercises the project tier, so it must not read the
        // real process-global $HOME env var (unsafe to do from parallel
        // `cargo test` threads without the crate-wide HOME_ENV_LOCK --
        // see `three_tier_precedence`'s own comment for the same reason).
        let config =
            load_config_with_home(&root, None).expect("override config must load and validate");
        assert_eq!(config.default_severity, Severity::Low.to_string());
        // tier was not set by the project -- must fall back to the
        // preset's value, not be empty/missing.
        assert!(VALID_TIERS.contains(&config.tier.as_str()));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rejects_unknown_severity() {
        let root = scratch_dir("bad-severity");
        let konductor_dir = root.join(KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&konductor_dir).unwrap();
        fs::write(
            konductor_dir.join(CONFIG_FILE_NAME),
            "version: 1\ndefault_severity: NOT_A_SEVERITY\n",
        )
        .unwrap();

        // See `project_config_overrides_preset_fields` for why this uses
        // `load_config_with_home(&root, None)` rather than `load_config`.
        let err = load_config_with_home(&root, None).expect_err("bogus severity must be rejected");
        assert!(matches!(err, ConfigError::UnknownSeverity { .. }));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rejects_unsupported_version() {
        let root = scratch_dir("bad-version");
        let konductor_dir = root.join(KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&konductor_dir).unwrap();
        fs::write(konductor_dir.join(CONFIG_FILE_NAME), "version: 999\n").unwrap();

        // See `project_config_overrides_preset_fields` for why this uses
        // `load_config_with_home(&root, None)` rather than `load_config`.
        let err =
            load_config_with_home(&root, None).expect_err("unsupported version must be rejected");
        assert!(matches!(err, ConfigError::UnsupportedVersion { .. }));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rejects_unknown_tier() {
        let root = scratch_dir("bad-tier");
        let konductor_dir = root.join(KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&konductor_dir).unwrap();
        fs::write(
            konductor_dir.join(CONFIG_FILE_NAME),
            "version: 1\ntier: not_a_tier\n",
        )
        .unwrap();

        // See `project_config_overrides_preset_fields` for why this uses
        // `load_config_with_home(&root, None)` rather than `load_config`.
        let err = load_config_with_home(&root, None).expect_err("unknown tier must be rejected");
        assert!(matches!(err, ConfigError::UnknownTier { .. }));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn accepts_valid_tier_override() {
        let root = scratch_dir("valid-tier");
        let konductor_dir = root.join(KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&konductor_dir).unwrap();
        fs::write(
            konductor_dir.join(CONFIG_FILE_NAME),
            "version: 1\ntier: full\n",
        )
        .unwrap();

        // See `project_config_overrides_preset_fields` for why this uses
        // `load_config_with_home(&root, None)` rather than `load_config`.
        let config =
            load_config_with_home(&root, None).expect("valid tier override must be accepted");
        assert_eq!(config.tier, "full");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rejects_malformed_yaml() {
        let root = scratch_dir("malformed-yaml");
        let konductor_dir = root.join(KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&konductor_dir).unwrap();
        fs::write(konductor_dir.join(CONFIG_FILE_NAME), "not: valid: yaml: [").unwrap();

        // See `project_config_overrides_preset_fields` for why this uses
        // `load_config_with_home(&root, None)` rather than `load_config`.
        let err = load_config_with_home(&root, None).expect_err("malformed YAML must be rejected");
        assert!(matches!(err, ConfigError::ProjectConfigMalformed { .. }));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn empty_project_config_falls_back_to_preset_defaults() {
        // An empty `.konductor/config.yml` parses as YAML `null`, which
        // must fall back entirely to the preset defaults, not raise
        // `ProjectConfigMalformed`. Uses `load_config_with_home` with
        // `None` on both sides so this only ever compares against the
        // preset, regardless of the host's real `~/.konductor/config.yml`.
        let root = scratch_dir("empty-project-config");
        let konductor_dir = root.join(KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&konductor_dir).unwrap();
        fs::write(konductor_dir.join(CONFIG_FILE_NAME), "").unwrap();

        let config = load_config_with_home(&root, None)
            .expect("empty config.yml must fall back to preset defaults");
        let preset = load_config_with_home(&scratch_dir("empty-project-config-baseline"), None)
            .expect("preset-only load must succeed for comparison");
        assert_eq!(config, preset);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn document_marker_only_project_config_falls_back_to_preset_defaults() {
        // Same fallback path as `empty_project_config_falls_back_to_preset_defaults`,
        // but for a config.yml containing only a YAML document marker and
        // a comment -- still parses as `null`, not a mapping.
        let root = scratch_dir("marker-only-project-config");
        let konductor_dir = root.join(KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&konductor_dir).unwrap();
        fs::write(
            konductor_dir.join(CONFIG_FILE_NAME),
            "---\n# just a comment\n",
        )
        .unwrap();

        let config = load_config_with_home(&root, None)
            .expect("document-marker-only config.yml must fall back to preset defaults");
        assert_eq!(config.version, SUPPORTED_CONFIG_VERSION);
        assert!(VALID_TIERS.contains(&config.tier.as_str()));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn preset_defaults_are_compiled_in_not_read_from_disk() {
        // Regression test for the CARGO_MANIFEST_DIR fix: the preset
        // must be available purely from the compiled binary (via
        // `include_str!`), with no dependency on a runtime filesystem
        // path derived from where the binary was built. This is
        // exercised by parsing `PRESET_CONFIG_CONTENTS` directly --
        // no `env!("CARGO_MANIFEST_DIR")`, no `std::fs` call involved.
        let raw: RawConfig =
            serde_yaml::from_str(PRESET_CONFIG_CONTENTS).expect("embedded preset must parse");
        assert_eq!(raw.version, Some(SUPPORTED_CONFIG_VERSION));
        assert!(raw.tier.is_some());

        // load_preset_defaults() must succeed identically -- it is now a
        // pure parse of the same embedded constant, with no I/O path
        // that could raise a `PresetNotReadable`-style error (that
        // variant no longer exists at all).
        load_preset_defaults()
            .expect("load_preset_defaults must succeed with no filesystem access");
    }

    #[test]
    fn three_tier_precedence() {
        // User-level `~/.konductor/config.yml` overrides the preset;
        // the project's `.konductor/config.yml` overrides the user tier.
        // Uses `load_config_with_home` (home dir passed explicitly)
        // rather than mutating the `HOME` env var, which is unsafe to do
        // from parallel `cargo test` threads.
        let fake_home = scratch_dir("three-tier-home");
        let user_konductor_dir = fake_home.join(KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&user_konductor_dir).unwrap();
        fs::write(
            user_konductor_dir.join(CONFIG_FILE_NAME),
            "version: 1\ndefault_severity: LOW\nfail_on_severity_at_or_above: HIGH\n",
        )
        .unwrap();

        let project_root = scratch_dir("three-tier-project");

        // No project config yet: user tier must win over the preset.
        let config = load_config_with_home(&project_root, Some(&fake_home))
            .expect("user-tier config must load");
        assert_eq!(config.default_severity, Severity::Low.to_string());
        assert_eq!(
            config.fail_on_severity_at_or_above,
            Severity::High.to_string()
        );

        // Project config now overrides the user tier for the field it
        // sets, while still falling back to the user tier for the field
        // it omits.
        let project_konductor_dir = project_root.join(KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&project_konductor_dir).unwrap();
        fs::write(
            project_konductor_dir.join(CONFIG_FILE_NAME),
            "version: 1\ndefault_severity: CRITICAL\n",
        )
        .unwrap();
        let config = load_config_with_home(&project_root, Some(&fake_home))
            .expect("project-tier config must load");
        assert_eq!(config.default_severity, Severity::Critical.to_string());
        assert_eq!(
            config.fail_on_severity_at_or_above,
            Severity::High.to_string()
        );

        fs::remove_dir_all(&fake_home).ok();
        fs::remove_dir_all(&project_root).ok();
    }

    #[test]
    fn config_fields_matches_serialized_struct_keys() {
        // Guard against drift between the hand-maintained _CONFIG_FIELDS
        // list and Config's actual fields: serialize a fully-populated
        // Config via its existing Serialize derive and assert the
        // resulting key set is exactly _CONFIG_FIELDS's set.
        let config = Config {
            version: SUPPORTED_CONFIG_VERSION,
            severities_source: "test".to_string(),
            tiers_source: "test".to_string(),
            tier: "full".to_string(),
            default_severity: Severity::Low.to_string(),
            fail_on_severity_at_or_above: Severity::High.to_string(),
        };
        let value = serde_json::to_value(&config).expect("Config must serialize");
        let map = value
            .as_object()
            .expect("Config must serialize to an object");
        let serialized_keys: std::collections::BTreeSet<&str> =
            map.keys().map(String::as_str).collect();
        let declared_keys: std::collections::BTreeSet<&str> =
            _CONFIG_FIELDS.iter().copied().collect();
        assert_eq!(serialized_keys, declared_keys);
    }
}
