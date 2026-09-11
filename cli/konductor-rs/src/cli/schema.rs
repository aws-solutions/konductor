// SPDX-License-Identifier: Apache-2.0
//
// schema.rs — walks the REAL clap::Command tree (built by
// `<Cli as CommandFactory>::command()`) and serializes it as JSON, for the
// hidden `__dump_schema` command in cli.rs.
//
// This is intentionally NOT hand-copied from a spec file or from the
// Commands enum's doc comments: it introspects the clap::Command instance
// clap itself builds from the #[derive(Parser)] annotations, so the dump
// always reflects whatever the derive macros actually produced — the same
// object clap uses to parse argv and render --help.
//
// JSON shape:
//
//   {
//     "global_options": [ {name, flags, value_type, required, default, choices}, ... ],
//     "commands": [
//       {
//         "name": "install",
//         "args": [ {name, flags, value_type, required, default, choices}, ... ],
//         "subcommands": [ { "name": "get", "args": [...] }, ... ]  // only present if non-empty
//       },
//       ...
//     ]
//   }
//
// "args" holds BOTH options (flags) and positional arguments for that
// command, since a single hand-maintained `options`/`args` distinction would
// collapse naturally once flags carry their own `flags: []` (empty for positionals).

use clap::builder::PossibleValue;
use clap::{Arg, ArgAction, Command};
use serde_json::{json, Value};

/// Names hidden from the public command surface -- excluded from the
/// `commands` array of the dump. `__dump_schema` walking itself would be
/// self-referential noise, and clap's synthetic `help` subcommand is not
/// part of the 8-command contract either.
const EXCLUDED_SUBCOMMAND_NAMES: &[&str] = &["__dump_schema", "help"];

/// Entry point used by cli.rs's `Commands::DumpSchema` handler. Returns a
/// pretty-printed JSON string ready to print to stdout.
pub fn dump_schema_json() -> String {
    let cmd = <super::Cli as clap::CommandFactory>::command();
    let value = dump_command_tree(&cmd);
    serde_json::to_string_pretty(&value).expect("schema Value must serialize")
}

/// Builds the top-level `{global_options, commands}` object.
///
/// Global options are the `Arg`s declared directly on the root `Command`
/// that clap marks `global(true)` (config/verbose/json/no_color) PLUS
/// --version, which is root-only (not `global = true`, since it is not
/// meant to be parseable after a subcommand) but is still a top-level-only
/// option, not a per-command one -- so it belongs in `global_options` for
/// the purposes of this dump's shape, matching the schema contract's
/// top-level options. `--help` is excluded: it is a clap-synthetic arg
/// with no equivalent hand-declared option in that contract, and the
/// now-removed check_spec_drift.py's precedent never listed --help as a
/// "global option" either.
fn dump_command_tree(root: &Command) -> Value {
    let global_options: Vec<Value> = root
        .get_arguments()
        .filter(|a| a.get_id() != "help")
        .map(dump_arg)
        .collect();

    let commands: Vec<Value> = root
        .get_subcommands()
        .filter(|c| !EXCLUDED_SUBCOMMAND_NAMES.contains(&c.get_name()))
        .map(dump_command)
        .collect();

    json!({
        "global_options": global_options,
        "commands": commands,
    })
}

/// Builds one entry of the `commands` array: this command's own args
/// (excluding any `global(true)` args it inherited from the root, which
/// already appear in `global_options`) plus a nested `subcommands` array
/// for command groups like `config`.
fn dump_command(cmd: &Command) -> Value {
    let args: Vec<Value> = cmd
        .get_arguments()
        .filter(|a| a.get_id() != "help" && !a.is_global_set())
        .map(dump_arg)
        .collect();

    let subcommands: Vec<Value> = cmd
        .get_subcommands()
        .filter(|c| !EXCLUDED_SUBCOMMAND_NAMES.contains(&c.get_name()))
        .map(dump_command)
        .collect();

    let mut obj = json!({
        "name": cmd.get_name(),
        "args": args,
    });
    if !subcommands.is_empty() {
        obj["subcommands"] = Value::Array(subcommands);
    }
    obj
}

/// Builds one `{name, flags, value_type, required, default, choices}`
/// entry for a single clap `Arg` (works for both options and positionals).
fn dump_arg(arg: &Arg) -> Value {
    let is_bool_flag = matches!(arg.get_action(), ArgAction::SetTrue | ArgAction::SetFalse);
    json!({
        "name": arg.get_id().to_string(),
        "flags": arg_flags(arg),
        "value_type": arg_value_type(arg, is_bool_flag),
        "required": arg.is_required_set(),
        "default": arg_default(arg),
        "choices": if is_bool_flag { Value::Null } else { arg_choices(arg) },
    })
}

/// All flag spellings for an option arg (e.g. ["--verbose", "-v"]).
/// Positional args (no `--`/`-` strings) get an empty array -- the
/// agreed schema contract's JSON shape uses an empty `flags` list, not
/// `null`, to distinguish "positional with zero flags" from "a field
/// that couldn't be introspected".
fn arg_flags(arg: &Arg) -> Vec<String> {
    let mut flags = Vec::new();
    if let Some(long) = arg.get_long() {
        flags.push(format!("--{long}"));
    }
    for long_alias in arg.get_all_aliases().into_iter().flatten() {
        flags.push(format!("--{long_alias}"));
    }
    if let Some(short) = arg.get_short() {
        flags.push(format!("-{short}"));
    }
    for short_alias in arg.get_all_short_aliases().into_iter().flatten() {
        flags.push(format!("-{short_alias}"));
    }
    flags
}

/// Best-effort classification of a clap Arg's value type into one of the
/// coarse buckets diff_schema.py compares: "bool" (a SetTrue/SetFalse
/// flag), "enum" (has possible_values / a value_parser restricting to a
/// finite choice set), "path" (declared value name looks path-like, e.g.
/// this repo's `--from`/`--config`/`--target` args), or "string" (the
/// fallback for everything else, including positionals like `config get
/// <key>`).
///
/// clap's derive macros do not preserve a distinct "this is a
/// std::path::PathBuf" marker once the field is typed as plain `String`
/// (as every arg in cli.rs is, per the Cli struct) -- there is no runtime
/// type-tag to introspect for "path-ness" beyond the value_name/id hint.
/// Since diff_schema.py treats "path" and "string" as equivalent anyway
/// (documented there), misclassifying a path-flavored String arg as
/// "string" here is harmless; the id/value_name heuristic below is
/// applied only as a best-effort improvement.
fn arg_value_type(arg: &Arg, is_bool_flag: bool) -> &'static str {
    if is_bool_flag {
        return "bool";
    }
    if arg.get_value_parser().possible_values().is_some() {
        return "enum";
    }
    let id = arg.get_id().as_str();
    if id.contains("path") || id == "from" || id == "config" || id == "target" {
        return "path";
    }
    "string"
}

/// The arg's default value as a string, or `null` if it has none. clap
/// stores defaults as `OsStr`s (there can be more than one, for
/// multi-value args); this CLI has no multi-value args, so the first
/// default value is authoritative.
fn arg_default(arg: &Arg) -> Value {
    match arg.get_default_values().first() {
        Some(v) => json!(v.to_string_lossy().to_string()),
        None => Value::Null,
    }
}

/// The arg's allowed choice set (e.g. init's ["solo", "team", "org"]), or
/// `null` if the arg is not choice-constrained.
fn arg_choices(arg: &Arg) -> Value {
    match arg.get_value_parser().possible_values() {
        Some(values) => {
            let names: Vec<String> = values
                .map(|v: PossibleValue| v.get_name().to_string())
                .collect();
            json!(names)
        }
        None => Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `--from` (install/synth's SOURCE flag, formerly `--local`) must
    /// classify as "path", matching the schema contract's documented
    /// `--from`/`--config`/`--target` set.
    #[test]
    fn arg_value_type_classifies_from_as_path() {
        let arg = Arg::new("from").long("from");
        assert_eq!(arg_value_type(&arg, false), "path");
    }
}
