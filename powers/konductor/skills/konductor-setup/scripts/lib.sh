#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# lib.sh -- shared helpers for konductor-setup's scripts.
#
# Meant to be sourced, not executed directly:
#   # shellcheck source=lib.sh
#   source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
#
# Every helper here exists to enforce the design's fail-stop rule (see
# konductor-power-design.md §5.3, §9): a command's real stdout/stderr is
# always streamed, never captured into a variable and re-summarized, and
# a non-zero exit stops the whole flow immediately with that command's
# own error text intact -- never softened, retried against a fallback, or
# swallowed.

# `set -u` here (not `-e`/`-o pipefail`) so a caller that sources this file
# before setting its own `set -euo pipefail` still gets unset-variable
# protection; the caller is expected to set the rest itself, since `-e`'s
# interaction with a sourced file's own function definitions is easy to get
# wrong (a function body's early `return` inside a conditional can look like
# a failure to a caller relying on `-e` alone).
set -u

# Set by konductor_resolve_target_binary (below); read by its callers
# (run-update.sh, run-uninstall.sh) after calling it. Declared here,
# alongside the function, matching the *_RESULT convention this Power's
# scripts use throughout (see fetch-verify-binary.sh/build-from-source.sh/
# link-binary.sh's own identical pattern and its rationale).
KONDUCTOR_RESOLVE_TARGET_BINARY_RESULT=""
# Companion result: the resolved binary's OWN --version output (not any
# content version) -- callers write this straight into power-cli.json via
# konductor_write_power_cli_record without re-invoking --version
# themselves.
KONDUCTOR_RESOLVE_TARGET_BINARY_VERSION_RESULT=""
# Set by konductor_resolve_and_check_binary (below); read only within this
# same file, by konductor_resolve_target_binary, immediately after each
# call -- unlike the two *_RESULT variables above, no cross-file read
# exists for this one.
KONDUCTOR_RESOLVE_AND_CHECK_BINARY_RESULT=""

# konductor_log <message...>
# A single, greppable "=== [konductor-setup] ... ===" line, matching the
# visible-progress style scripts/konductor-bootstrap.sh already uses (see
# design §6). Every step prints one of these BEFORE it does anything.
#
# Written to STDERR, deliberately: several functions in this file's sibling
# scripts (fetch_verify_binary, build_from_source, link_binary) return their
# actual result -- a file path -- to their caller via a final `echo` on
# STDOUT, captured with `$(...)`. If this progress narration also went to
# stdout, it would land inside that captured string ahead of the real
# value, corrupting it. Stderr keeps the narration visible in the terminal
# (nothing here is ever captured on that stream) while leaving stdout free
# to carry exactly one thing: the value a caller asked for.
konductor_log() {
  echo "=== [konductor-setup] $* ===" >&2
}

# konductor_die <message...>
# Prints an error to stderr and returns 1 -- never exits the shell directly,
# so a caller that sources this file keeps control of whether to `exit` (a
# script entrypoint) or `return` (a sourced function under test).
konductor_die() {
  echo "error: $*" >&2
  return 1
}

# konductor_run <command...>
# Runs a command with its real stdout/stderr streamed directly -- never
# `$(...)`-captured -- and returns its exact exit status. This is the one
# indirection every step-level script uses to invoke an external command,
# so "never capture, always stream, always propagate the real exit code" is
# enforced in one place rather than re-implemented at each call site.
konductor_run() {
  konductor_log "Running: $*"
  "$@"
}

# konductor_run_cli <konductor-binary> <subcommand> [args...]
# Like konductor_run, but specific to invoking the `konductor` CLI itself
# (install/update/uninstall/doctor). Stdout still streams live, exactly as
# konductor_run's does. Stderr is captured to a temp file first and then
# relayed to the real stderr IN FULL, immediately after the command exits
# -- a deliberate, narrow trade-off from konductor_run's fully-live dual
# stream, made only here, not generally: it is what lets this helper
# inspect the CLI's own error text afterward for a GitHub rate-limit/auth
# signature and print an exact, copy-pasteable retry command, without ever
# inventing or guessing at what the CLI actually said. Every line of that
# stderr is still shown, verbatim, in full -- fail-stop's relay-word-for-
# word guarantee holds -- only the timing changes (all at once right after
# exit, instead of interleaved character-by-character during the run).
# Applied only to the `konductor` CLI's own install/update/uninstall/doctor
# calls (fast, one-shot, sub-second in the common case), never to
# `konductor_run`'s other real callers (`git clone`, `make build` in
# build-from-source.sh), which are longer-running and where interleaved
# live stderr is worth keeping.
konductor_run_cli() {
  local logfile status subcommand
  konductor_log "Running: $*"
  subcommand="${2:-}"
  logfile="$(mktemp)"
  set +e
  "$@" 2>"$logfile"
  status=$?
  set -e
  cat "$logfile" >&2
  if [[ $status -ne 0 ]] && grep -qE 'HTTP status (401|403)|[Rr]ate limit' "$logfile"; then
    konductor_suggest_rate_limit_retry "$subcommand" "$@"
  fi
  rm -f "$logfile"
  return $status
}

# konductor_suggest_rate_limit_retry <subcommand> <command...>
# Prints an exact, copy-pasteable retry command after konductor_run_cli
# detects a GitHub rate-limit/auth signature ("HTTP status 401/403" or
# "rate limit", matching install/github.rs's own GithubFetchError::
# MetadataHttp/DownloadHttp wording and doctor.rs's identical version-check
# fetch error) in a `konductor` CLI invocation's own stderr.
#
# `doctor` has NO --use-github-token flag at all -- confirmed directly
# against cli.rs's `Commands::Doctor` variant, which declares only `from`/
# `target`/`all`/`no_version_check`. This matters because doctor.rs's own
# error text for this exact failure still says "...pass --use-github-token"
# (it reuses install's shared hint-rendering code, which has no way to
# know which command is calling it) -- a real, stale suggestion baked into
# the CLI itself that this function does NOT repeat. Passing
# --use-github-token to doctor would itself be a usage error (clap
# rejects an unrecognized flag), so doctor's own retry suggestion is
# --no-version-check instead -- the one flag doctor DOES have to skip the
# network call that triggered this in the first place.
konductor_suggest_rate_limit_retry() {
  local subcommand="$1"
  shift
  echo "" >&2
  echo "=== [konductor-setup] That looks like a GitHub API rate limit or auth problem, not a real failure in the install content itself. ===" >&2
  if [[ "$subcommand" == "doctor" ]]; then
    echo "'doctor' has no --use-github-token flag (confirmed against the CLI's own argument list) -- its stderr above may still suggest one; that suggestion does not apply to doctor." >&2
    echo "Retry with the network check skipped instead:" >&2
    echo "  $* --no-version-check" >&2
  else
    echo "If you have a GITHUB_TOKEN available, retry with:" >&2
    echo "  GITHUB_TOKEN=<your-token> $* --use-github-token" >&2
  fi
}

# KONDUCTOR_CLI_VERSION_REGEX -- a bare semver, matching exactly what
# `konductor --version` itself prints after the "konductor " prefix (see
# cli.rs's `run_inner`: `println!("konductor {}", env!("CARGO_PKG_VERSION"))`).
# konductor_resolve_target_binary validates power-cli.json's cli_version
# against this BEFORE using it in any glob or path -- a value read from a
# file this Power's own scripts did not necessarily write (see that
# function's own doc comment on power-cli.json's trust boundary) must
# never be trusted as glob-safe or path-safe just because it parsed as
# JSON.
#
# Deliberately NOT `readonly`: lib.sh is sourced more than once in a
# single run (every sibling script that sources link-binary.sh/
# fetch-verify-binary.sh/build-from-source.sh sources lib.sh a second
# time via each of THEIR own top-of-file `source .../lib.sh` lines, on
# top of run-onboarding.sh's own direct one) -- `readonly` on a second
# sourcing would itself be a real, `set -e`-fatal error the very first
# time this ever ran for real, not just a lint nit.
KONDUCTOR_CLI_VERSION_REGEX='^[0-9]+\.[0-9]+\.[0-9]+$'

# konductor_write_power_cli_record <target-dir> <cli-version> <binary-path>
# Writes/refreshes <target-dir>/.konductor/power-cli.json -- this Power's
# OWN record of exactly which `konductor` CLI binary (and its own
# self-reported `--version`) it last used successfully for this target.
#
# Deliberately a SEPARATE file from the CLI's own <target-dir>/.konductor/
# install-info.json, never read or written by the `konductor` CLI itself.
# install-info.json's `agent_version` field records the installed
# CONTENT's own version -- confirmed directly against install_info.rs's
# own header comment ("the installed content's own version, reported
# separately from the running binary's version") -- and `update --version
# <v>` (cli.rs's `release_version` field on `Commands::Update`) changes
# that CONTENT version on purpose, on ANY CLI binary, with no effect on
# and no relationship to which binary ran the command. An earlier version
# of konductor_resolve_target_binary compared power-cli.json's would-be
# `cli_version` against install-info.json's `agent_version` directly --
# conflating two independent axes -- which meant a single
# `run-update.sh --version 2.0.0` (a legitimate content-version bump, run
# with the SAME, perfectly good 1.0.2 CLI binary) locked every LATER
# update/uninstall out entirely, since nothing on the machine reports
# `--version` as "2.0.0" (that string names a content release, not a CLI
# release, and 2.0.0 may not even be a real CLI release at all).
# power-cli.json exists specifically so this Power tracks the CLI-binary
# axis on its own, never inferring it from a field that was never about
# the CLI binary in the first place.
#
# Called only after a REAL success (a completed `konductor install`/
# `update` run) -- never on a failed run, so a failure never overwrites a
# still-good prior record with the mid-failure state.
konductor_write_power_cli_record() {
  local target_dir="$1" cli_version="$2" binary_path="$3"
  local power_cli_dir power_cli_json tmp_file

  konductor_require_cmd jq
  power_cli_dir="${target_dir}/.konductor"
  power_cli_json="${power_cli_dir}/power-cli.json"
  tmp_file="${power_cli_json}.tmp.$$"

  mkdir -p "$power_cli_dir"
  if ! jq -n --arg v "$cli_version" --arg b "$binary_path" \
    '{cli_version: $v, binary: $b}' > "$tmp_file"; then
    rm -f "$tmp_file"
    konductor_die "failed to render power-cli.json's content for ${target_dir}."
    return 1
  fi
  mv -f "$tmp_file" "$power_cli_json"
  konductor_log "Recorded ${binary_path} (version ${cli_version}) as this target's own CLI binary in ${power_cli_json}"
}

# konductor_resolve_and_check_binary <candidate-path> <releases-dir>
# Resolves <candidate-path> through any symlink chain and confirms the
# FULLY-RESOLVED underlying file -- never the candidate path as given --
# is an existing regular file that is a DIRECT CHILD of <releases-dir>.
# Sets KONDUCTOR_RESOLVE_AND_CHECK_BINARY_RESULT to that resolved path and
# returns 0 when trusted; returns 1 (no message printed -- the caller
# decides how loud to be) otherwise.
#
# This is the single trust check every one of konductor_resolve_target_
# binary's three candidate sources goes through: power-cli.json's own
# recorded `binary`, each `konductor-v<version>-*` cache-glob match, and
# the shared `~/.local/bin/konductor` symlink itself. A path-STRING check
# alone (e.g. "does this literal path start with releases_dir") is not
# enough: a SYMLINK sitting directly inside releases_dir (dropped there
# by a crafted power-cli.json, or by anything else with write access to
# that directory) can still point anywhere else on disk while its own
# name looks like a perfectly ordinary direct child -- and the shared
# `~/.local/bin/konductor` path is a symlink BY DESIGN (link-binary.sh
# creates it as one on purpose), so refusing "any symlink" outright would
# refuse the one candidate this Power itself relies on. Resolving fully
# and re-checking the RESOLVED path is what actually proves where the
# bytes that would run come from, for every candidate alike.
#
# Bounded to 20 hops to guard against a symlink cycle. Deliberately NOT
# `readlink -f`: that flag is a GNU extension not guaranteed present on
# macOS's BSD `readlink` (this Power supports macOS on both Apple Silicon
# and Intel), so this resolves one hop at a time with plain `readlink`,
# which both implementations support identically.
konductor_resolve_and_check_binary() {
  local path="$1" releases_dir="$2"
  local resolved hops target

  if [[ ! -e "$path" ]]; then
    return 1
  fi

  resolved="$path"
  hops=0
  while [[ -L "$resolved" ]]; do
    hops=$((hops + 1))
    if [[ $hops -gt 20 ]]; then
      return 1
    fi
    target="$(readlink "$resolved")"
    case "$target" in
      /*) resolved="$target" ;;
      *) resolved="$(dirname "$resolved")/$target" ;;
    esac
    if [[ ! -e "$resolved" ]]; then
      return 1
    fi
  done

  case "$resolved" in
    "${releases_dir}"/*)
      if [[ "${resolved#"${releases_dir}"/}" == */* ]]; then
        return 1
      fi
      ;;
    *)
      return 1
      ;;
  esac

  if [[ ! -f "$resolved" ]]; then
    return 1
  fi

  KONDUCTOR_RESOLVE_AND_CHECK_BINARY_RESULT="$resolved"
  return 0
}

# konductor_resolve_target_binary <target-dir>
# Resolves the `konductor` binary that ACTUALLY matches a given target's
# OWN recorded CLI binary, rather than assuming the machine-wide
# `~/.local/bin/konductor` symlink is still that binary (adversarial-
# review finding C2). That symlink is shared across every project on the
# machine and re-pointed by every onboarding run -- a project onboarded
# weeks ago, then left alone while OTHER projects were onboarded/updated
# with newer pinned releases, ends up with a shared binary that no longer
# matches what THIS target actually needs.
#
# Reads <target-dir>/.konductor/power-cli.json (see
# konductor_write_power_cli_record's own doc comment for exactly why this
# is a SEPARATE file from install-info.json, never the CLI's own
# `agent_version`, which is a content version and independent of which
# CLI binary ran the command).
#
# Sets KONDUCTOR_RESOLVE_TARGET_BINARY_RESULT to a verified-matching,
# FULLY-RESOLVED binary path (never a symlink -- konductor_resolve_and_
# check_binary's own resolution result, run directly) and KONDUCTOR_
# RESOLVE_TARGET_BINARY_VERSION_RESULT to that binary's own confirmed
# `--version` output, and returns 0 on success. Resolution order:
#   1. power-cli.json's own recorded binary, if the file exists and
#      RESOLVES (see konductor_resolve_and_check_binary and the trust-
#      boundary note below) to a trusted, direct-child regular file
#      whose own `--version` output still matches the recorded
#      cli_version exactly.
#   2. A cached ~/.konductor/cli-releases/konductor-v<cli_version>-*
#      binary (every binary ever verified-and-cached by
#      fetch-verify-binary.sh or build-from-source.sh, regardless of
#      platform triple or whether it was downloaded or built from
#      source) that likewise resolves to a trusted, direct-child regular
#      file whose OWN `--version` output matches cli_version -- never
#      trusting the filename alone as proof of content, and never
#      trusting a glob match's own path string alone either.
#   3. The shared ~/.local/bin/konductor, once RESOLVED to a trusted,
#      direct-child regular file whose own `--version` output matches
#      cli_version.
#   4. LEGACY targets with no power-cli.json at all (onboarded before
#      this Power tracked its own CLI binary per target): trust the
#      shared binary for this one run (still subject to the same
#      resolve-and-check trust boundary as every other candidate --
#      "legacy" only waives the version comparison, never the location
#      check), log a clear notice, and let the caller write a fresh
#      power-cli.json afterward (via konductor_write_power_cli_record)
#      once the run actually succeeds -- every later run then resolves
#      through step 1 above instead.
#   5. If nothing above matches, fail closed with a message naming
#      exactly what was checked and pointing at re-running onboarding --
#      never silently falls back to a mismatched binary "close enough"
#      to what was recorded.
#
# Trust boundary on every one of the three candidate sources below (power-
# cli.json's own recorded `binary`, each cache-glob match, and the shared
# `~/.local/bin/konductor` symlink): only konductor_resolve_and_check_
# binary's fully-RESOLVED path -- never the candidate path as given -- is
# ever executed, and only once that resolved path is confirmed to be a
# regular file that is a DIRECT child of the flat `~/.konductor/
# cli-releases` cache directory (see that directory's own invariant,
# documented at its first use below). Every candidate that does not
# resolve that way is treated exactly like a missing one -- falling
# through to the next resolution step -- never executed. This is the
# guard against a crafted or hand-edited power-cli.json naming an
# arbitrary executable elsewhere on disk, OR a symlink dropped directly
# inside cli-releases (matching the cache-glob's own naming convention on
# its face) that actually points somewhere else entirely; the shared
# `~/.local/bin/konductor` path is allowed to itself be a symlink -- that
# is how link-binary.sh creates it on purpose -- but only once resolving
# it lands on a real, direct-child file under cli-releases, exactly like
# every other trusted candidate.
konductor_resolve_target_binary() {
  local target_dir="$1"
  local install_info="${target_dir}/.konductor/install-info.json"
  local power_cli_json="${target_dir}/.konductor/power-cli.json"
  local releases_dir shared_bin resolved
  local recorded_binary recorded_version candidate candidate_version shared_version
  local legacy=""

  if [[ ! -f "$install_info" ]]; then
    konductor_die "no install-info found at ${install_info} -- this target was not onboarded by this Power (or the file was removed). Run scripts/run-onboarding.sh --target ${target_dir} --confirmed first."
    return 1
  fi
  konductor_require_cmd jq

  # `~/.konductor/cli-releases` is a FLAT directory -- every binary ever
  # verified-and-cached by fetch-verify-binary.sh (`stable_path="${releases_dir}/${asset_name}"`)
  # or build-from-source.sh (`stable_path="${releases_dir}/konductor-${tag}-source-build"`)
  # lands directly in it, never in a subdirectory -- so "does this path
  # have exactly one path separator past the releases_dir prefix" is a
  # complete, sufficient test for "is this a direct child of it", not an
  # approximation.
  releases_dir="${HOME:?HOME must be set}/.konductor/cli-releases"
  shared_bin="${HOME}/.local/bin/konductor"

  if [[ -f "$power_cli_json" ]]; then
    recorded_binary="$(jq -r '.binary // empty' "$power_cli_json" 2>/dev/null || true)"
    recorded_version="$(jq -r '.cli_version // empty' "$power_cli_json" 2>/dev/null || true)"

    if [[ -z "$recorded_version" || ! "$recorded_version" =~ $KONDUCTOR_CLI_VERSION_REGEX ]]; then
      konductor_die "${power_cli_json} has a missing or malformed cli_version (got: '${recorded_version:-<empty>}', expected a bare semver like 1.0.2) -- refusing to trust it for a glob or path lookup. Re-run onboarding for this project: scripts/run-onboarding.sh --target ${target_dir} --confirmed"
      return 1
    fi

    # Trust-boundary check (see this function's own doc comment above) --
    # resolves any symlink chain and re-validates the RESOLVED path.
    if [[ -n "$recorded_binary" ]] && konductor_resolve_and_check_binary "$recorded_binary" "$releases_dir"; then
      resolved="$KONDUCTOR_RESOLVE_AND_CHECK_BINARY_RESULT"
      candidate_version="$("$resolved" --version 2>/dev/null | awk '{print $2}')"
      if [[ "$candidate_version" == "$recorded_version" ]]; then
        konductor_log "Using ${resolved} (version ${candidate_version}, recorded in ${power_cli_json})"
        KONDUCTOR_RESOLVE_TARGET_BINARY_RESULT="$resolved"
        KONDUCTOR_RESOLVE_TARGET_BINARY_VERSION_RESULT="$candidate_version"
        return 0
      fi
    fi

    konductor_log "${power_cli_json}'s recorded binary (${recorded_binary:-<none>}) is missing, does not resolve to a trusted direct-child regular file under ${releases_dir}, or no longer reports cli_version ${recorded_version} -- searching this target's own cache and the shared binary instead."
  else
    legacy="1"
    konductor_log "No power-cli.json found for ${target_dir} (a target onboarded before this Power tracked its own CLI binary per target) -- trusting the shared ${shared_bin} for this one run; a fresh record is written once this run succeeds."
  fi

  # LEGACY path: no recorded cli_version exists yet to compare anything
  # against, so trust the shared binary outright, whatever version it
  # currently is -- see this function's own doc comment, resolution
  # order step 4. Still goes through the same resolve-and-check trust
  # boundary as every other candidate -- "legacy" waives the version
  # comparison, never the location check.
  if [[ -n "$legacy" ]]; then
    if konductor_resolve_and_check_binary "$shared_bin" "$releases_dir"; then
      resolved="$KONDUCTOR_RESOLVE_AND_CHECK_BINARY_RESULT"
      shared_version="$("$resolved" --version 2>/dev/null | awk '{print $2}')"
      if [[ -n "$shared_version" ]]; then
        KONDUCTOR_RESOLVE_TARGET_BINARY_RESULT="$resolved"
        KONDUCTOR_RESOLVE_TARGET_BINARY_VERSION_RESULT="$shared_version"
        return 0
      fi
    fi
    konductor_die "no power-cli.json for ${target_dir} (a legacy target), and the shared ${shared_bin} is missing, does not resolve to a trusted direct-child regular file under ${releases_dir}, or reports no version. Re-run onboarding for this project: scripts/run-onboarding.sh --target ${target_dir} --confirmed"
    return 1
  fi

  # Non-legacy fallback: power-cli.json named a real cli_version, but its
  # own recorded binary didn't pan out -- search the cache, then the
  # shared symlink, for ANY binary that still reports that exact version.
  # Every glob match still goes through the same resolve-and-check trust
  # boundary before ever being run -- a symlink dropped directly inside
  # cli-releases with a name matching this glob pattern is not
  # automatically trusted just because ITS OWN NAME looks like a direct
  # child; only its fully-resolved target being one is what matters.
  if [[ -d "$releases_dir" ]]; then
    for candidate in "${releases_dir}"/konductor-v"${recorded_version}"-*; do
      [[ -e "$candidate" ]] || continue
      konductor_resolve_and_check_binary "$candidate" "$releases_dir" || continue
      resolved="$KONDUCTOR_RESOLVE_AND_CHECK_BINARY_RESULT"
      candidate_version="$("$resolved" --version 2>/dev/null | awk '{print $2}')"
      if [[ "$candidate_version" == "$recorded_version" ]]; then
        konductor_log "Using this target's own cached binary: ${resolved}"
        KONDUCTOR_RESOLVE_TARGET_BINARY_RESULT="$resolved"
        KONDUCTOR_RESOLVE_TARGET_BINARY_VERSION_RESULT="$candidate_version"
        return 0
      fi
    done
  fi

  if konductor_resolve_and_check_binary "$shared_bin" "$releases_dir"; then
    resolved="$KONDUCTOR_RESOLVE_AND_CHECK_BINARY_RESULT"
    shared_version="$("$resolved" --version 2>/dev/null | awk '{print $2}')"
    if [[ "$shared_version" == "$recorded_version" ]]; then
      konductor_log "Using the shared ${shared_bin} (resolved to ${resolved}; version ${shared_version} matches this target's recorded cli_version)"
      # Both assignments below are read only by run-update.sh/run-uninstall.sh,
      # which source this file -- see lib.sh's own top-of-file declaration
      # comment for why shellchecking lib.sh BY ITSELF can never see that
      # read (no standalone entrypoint of its own to reference it from
      # within this same file); `shellcheck -x run-update.sh` and
      # `shellcheck -x run-uninstall.sh` are the authoritative check.
      # shellcheck disable=SC2034
      KONDUCTOR_RESOLVE_TARGET_BINARY_RESULT="$resolved"
      # shellcheck disable=SC2034
      KONDUCTOR_RESOLVE_TARGET_BINARY_VERSION_RESULT="$shared_version"
      return 0
    fi
  fi

  konductor_die "no binary on this machine matches ${target_dir}'s recorded CLI version (${recorded_version}, from ${power_cli_json}) -- checked the recorded binary, every cached binary under ${releases_dir}, and the shared ${shared_bin} (version ${shared_version:-<not found>}). Re-run onboarding for this project: scripts/run-onboarding.sh --target ${target_dir} --confirmed"
  return 1
}

# konductor_require_cmd <cmd> <hint>
# Fails closed with a specific, actionable message if <cmd> is not on PATH,
# rather than letting a later step fail with a generic "command not found".
konductor_require_cmd() {
  local cmd="$1" hint="${2:-}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    if [[ -n "$hint" ]]; then
      konductor_die "'$cmd' is required but was not found on PATH. $hint"
    else
      konductor_die "'$cmd' is required but was not found on PATH."
    fi
    return 1
  fi
}

# konductor_sha256_verify <sidecar-file>
# Verifies a downloaded artifact against its .sha256 sidecar, from within
# the sidecar's own directory (so the sidecar's recorded filename resolves
# as a sibling, matching write_sidecar's own convention). Prefers
# sha256sum (Linux default); falls back to `shasum -a 256` (macOS).
konductor_sha256_verify() {
  local sidecar="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$sidecar"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c "$sidecar"
  else
    konductor_die "this step requires 'sha256sum' or 'shasum' to verify the download, and neither was found on PATH."
    return 1
  fi
}
