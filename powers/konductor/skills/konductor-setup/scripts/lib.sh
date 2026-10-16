#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# lib.sh -- shared helpers for konductor-setup's scripts.
#
# Meant to be sourced, not executed directly:
#   # shellcheck source=lib.sh
#   source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
#
# Every helper here exists to enforce this Power's fail-stop rule: a
# command's real stdout/stderr is always streamed, never captured into a
# variable and re-summarized, and a non-zero exit stops the whole flow
# immediately with that command's own error text intact -- never
# softened, retried against a fallback, or swallowed.

# `set -u` here (not `-e`/`-o pipefail`): a caller that sources this file
# before its own `set -euo pipefail` still gets unset-variable protection;
# `-e`'s interaction with a sourced file's own function definitions is
# easy to get wrong (an early `return` inside a conditional can look like
# a failure to a caller relying on `-e` alone).
set -u

# Set by konductor_resolve_target_binary; read by its callers
# (run-update.sh, run-uninstall.sh).
KONDUCTOR_RESOLVE_TARGET_BINARY_RESULT=""
# Companion: the resolved binary's OWN --version output, written straight
# into power-cli.json without re-invoking --version.
KONDUCTOR_RESOLVE_TARGET_BINARY_VERSION_RESULT=""
# Set by konductor_resolve_and_check_binary; read only within this file.
KONDUCTOR_RESOLVE_AND_CHECK_BINARY_RESULT=""

# konductor_log <message...>
# A single, greppable "=== [konductor-setup] ... ===" progress line,
# printed BEFORE each step does anything.
#
# Written to stderr: fetch_verify_binary/build_from_source/link_binary
# return their result -- a file path -- via a final `echo` on stdout,
# captured with `$(...)`. Narration on stdout would land inside that
# captured string ahead of the real value, corrupting it.
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
# Runs a command with its real stdout/stderr streamed directly, never
# `$(...)`-captured, and returns its exact exit status.
konductor_run() {
  konductor_log "Running: $*"
  "$@"
}

# konductor_run_cli <konductor-binary> <subcommand> [args...]
# Like konductor_run, for the `konductor` CLI itself (install/update/
# uninstall/doctor). Stdout still streams live. Stderr is captured to a
# temp file and relayed to the real stderr IN FULL immediately after the
# command exits -- every line is still shown verbatim, only the timing
# changes -- which lets this helper inspect it afterward for a GitHub
# rate-limit/auth signature and print a retry command. Applied only to
# these fast, one-shot CLI calls, never to konductor_run's other callers
# (`git clone`, `make build`), where interleaved live stderr matters more.
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
# "rate limit") in a `konductor` CLI invocation's own stderr.
#
# `doctor` has no --use-github-token flag at all, even though its own
# error text for this failure still suggests one (it reuses install's
# shared hint-rendering code) -- this function does not repeat that stale
# suggestion. --no-version-check is doctor's own way to skip the network
# call that triggered this in the first place.
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

# None of the three regexes below are `readonly`: lib.sh is sourced more
# than once per run (every sibling script sources it again), and
# `readonly` would be a real `set -e`-fatal error on the second sourcing.

# KONDUCTOR_CLI_VERSION_REGEX -- a bare semver, matching exactly what
# `konductor --version` prints after the "konductor " prefix.
# konductor_resolve_target_binary validates power-cli.json's cli_version
# against this BEFORE using it in any glob or path -- that value comes
# from a file this Power's own scripts did not necessarily write.
KONDUCTOR_CLI_VERSION_REGEX='^[0-9]+\.[0-9]+\.[0-9]+$'

# KONDUCTOR_CLI_TAG_REGEX -- the v-prefixed form of the same semver,
# matching every real GitHub release tag on this repo. construct_tag,
# fetch_verify_binary, and build_from_source each validate their own
# tag/version argument against this (or KONDUCTOR_CLI_VERSION_REGEX)
# BEFORE using it in a path, download URL, or `git clone --branch` ref --
# the value can arrive from --tag or KONDUCTOR_POWER_VERSION, and an
# unvalidated one would be a path-traversal write or a git-ref injection.
# shellcheck disable=SC2034 # read only by fetch-verify-binary.sh/build-from-source.sh after sourcing this file
KONDUCTOR_CLI_TAG_REGEX='^v[0-9]+\.[0-9]+\.[0-9]+$'

# KONDUCTOR_HARNESS_NAME_REGEX -- a safe shape (not an allowlist of real
# harness names, which the CLI itself already validates) for an optional
# `--harness <value>` forwarded verbatim to `konductor update`/`uninstall`
# by run-update.sh/run-uninstall.sh: refuses shell metacharacters, a
# path-traversal payload, or an empty string before the value is ever
# forwarded as an argv entry.
# shellcheck disable=SC2034 # read only by run-update.sh/run-uninstall.sh after sourcing this file
KONDUCTOR_HARNESS_NAME_REGEX='^[a-z0-9][a-z0-9-]*$'

# konductor_write_power_cli_record <target-dir> <cli-version> <binary-path>
# Writes/refreshes <target-dir>/.konductor/power-cli.json -- this Power's
# OWN record of exactly which `konductor` CLI binary (and its own
# self-reported `--version`) it last used successfully for this target.
#
# Deliberately a SEPARATE file from the CLI's own install-info.json,
# never read or written by the `konductor` CLI itself. install-info.json's
# `agent_version` is the installed CONTENT's own version, and
# `update --version <v>` changes ONLY that, on whichever CLI binary
# happens to be resolved -- comparing power-cli.json's `cli_version`
# against it would conflate two unrelated axes: a legitimate content bump
# (`run-update.sh --version 2.0.0`, run on a perfectly good 1.0.2 CLI
# binary) would then lock every later update/uninstall out, since nothing
# reports `--version` as "2.0.0". power-cli.json tracks the CLI-binary
# axis on its own.
#
# Called only after a REAL success -- never on a failed run, so a failure
# never overwrites a still-good prior record.
konductor_write_power_cli_record() {
  local target_dir="$1" cli_version="$2" binary_path="$3"
  local power_cli_dir power_cli_json tmp_file

  konductor_require_cmd jq
  power_cli_dir="${target_dir}/.konductor"
  power_cli_json="${power_cli_dir}/power-cli.json"

  mkdir -p "$power_cli_dir"
  # Unpredictable temp name, not "${power_cli_json}.tmp.$$": a name
  # derivable from target_dir and the PID alone lets a symlink planted
  # ahead of time turn this write into a write-through-symlink.
  tmp_file="$(mktemp "${power_cli_dir}/.power-cli.json.tmp.XXXXXX")" || {
    konductor_die "failed to create a temporary file for power-cli.json in ${power_cli_dir}."
    return 1
  }
  if ! jq -n --arg v "$cli_version" --arg b "$binary_path" \
    '{cli_version: $v, binary: $b}' > "$tmp_file"; then
    rm -f "$tmp_file"
    konductor_die "failed to render power-cli.json's content for ${target_dir}."
    return 1
  fi
  if ! mv -f "$tmp_file" "$power_cli_json"; then
    rm -f "$tmp_file"
    konductor_die "failed to publish power-cli.json for ${target_dir}."
    return 1
  fi
  konductor_log "Recorded ${binary_path} (version ${cli_version}) as this target's own CLI binary in ${power_cli_json}"
}

# konductor_resolve_and_check_binary <candidate-path> <releases-dir>
# Resolves <candidate-path> through any symlink chain and confirms the
# FULLY-RESOLVED underlying file -- never the candidate path as given --
# is an existing regular file that is a DIRECT CHILD of <releases-dir>.
# Sets KONDUCTOR_RESOLVE_AND_CHECK_BINARY_RESULT and returns 0 when
# trusted; returns 1 (no message -- the caller decides how loud) otherwise.
#
# The trust check every konductor_resolve_target_binary candidate goes
# through (power-cli.json's recorded `binary`, each cache-glob match, the
# shared `~/.local/bin/konductor` symlink). A path-STRING check alone is
# not enough: a symlink dropped directly inside releases_dir can still
# point anywhere while its own name looks like an ordinary direct child
# -- and the shared symlink is a symlink BY DESIGN, so refusing "any
# symlink" outright would refuse the one candidate this Power relies on.
# Resolving fully and re-checking the RESOLVED path is what actually
# proves where the bytes that would run come from.
#
# Bounded to 20 hops against a symlink cycle. Not `readlink -f`: that
# GNU extension isn't guaranteed on macOS's BSD `readlink`, so this
# resolves one hop at a time with plain `readlink`.
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
# `~/.local/bin/konductor` symlink is still that binary -- that symlink
# is shared across every project and re-pointed by every onboarding run,
# so a project left alone while others were updated ends up with a
# shared binary that no longer matches what it needs.
#
# Reads <target-dir>/.konductor/power-cli.json (see
# konductor_write_power_cli_record for why this is separate from
# install-info.json's content-version `agent_version`).
#
# Sets KONDUCTOR_RESOLVE_TARGET_BINARY_RESULT to a verified-matching,
# fully-resolved binary path (never a symlink) and KONDUCTOR_
# RESOLVE_TARGET_BINARY_VERSION_RESULT to its own confirmed `--version`
# output, and returns 0 on success. Resolution order:
#   1. power-cli.json's own recorded binary, once trusted (see the trust
#      boundary below) and its `--version` matches the recorded
#      cli_version exactly.
#   2. A cached ~/.konductor/cli-releases/konductor-v<cli_version>-*
#      binary (downloaded or built, any platform triple) that likewise
#      resolves trusted and matches cli_version.
#   3. The shared ~/.local/bin/konductor, once trusted and matching
#      cli_version.
#   4. LEGACY targets with no power-cli.json at all: trust the shared
#      binary outright for this one run (still subject to the same trust
#      boundary -- "legacy" waives only the version comparison), log a
#      clear notice, and let the caller write a fresh power-cli.json
#      once the run succeeds -- every later run then resolves via step 1.
#   5. Otherwise fail closed, naming exactly what was checked -- never
#      falls back to a mismatched binary "close enough" to what was
#      recorded.
#
# Trust boundary on every candidate (power-cli.json's recorded `binary`,
# each cache-glob match, the shared symlink): only
# konductor_resolve_and_check_binary's fully-RESOLVED path is ever
# executed, and only once confirmed to be a regular file that is a DIRECT
# child of the flat `~/.konductor/cli-releases` cache directory. A
# candidate that does not resolve that way is treated as missing, never
# executed -- the guard against a crafted power-cli.json naming an
# arbitrary executable, or a symlink dropped inside cli-releases that
# points elsewhere. The shared `~/.local/bin/konductor` path is itself
# allowed to be a symlink (link-binary.sh creates it that way on
# purpose), but only once it resolves onto a real cli-releases file too.
konductor_resolve_target_binary() {
  local target_dir="$1"
  local power_cli_json="${target_dir}/.konductor/power-cli.json"
  local manifest_file="${target_dir}/.konductor/manifest"
  local releases_dir shared_bin resolved
  local recorded_binary recorded_version candidate candidate_version shared_version
  local legacy=""

  # Proof of onboarding is power-cli.json or (legacy target) the CLI's
  # own manifest file -- NEVER install-info.json, which is telemetry's
  # opt-in record alone: `install --no-telemetry` never writes it, and
  # `update --no-telemetry` deletes it. Gating on it would wrongly refuse
  # update/uninstall for every telemetry-opted-out target. power-cli.json
  # and manifest are both written unconditionally of telemetry.
  if [[ ! -f "$power_cli_json" && ! -f "$manifest_file" ]]; then
    konductor_die "no power-cli.json or manifest found at ${target_dir}/.konductor -- this target was not onboarded by this Power (or both files were removed). Run scripts/run-onboarding.sh --target ${target_dir} --confirmed first."
    return 1
  fi
  konductor_require_cmd jq

  # `~/.konductor/cli-releases` is a FLAT directory -- every cached
  # binary lands directly in it, never a subdirectory -- so "exactly one
  # path separator past the prefix" is a sufficient direct-child test.
  releases_dir="${HOME:?HOME must be set}/.konductor/cli-releases"
  shared_bin="${HOME}/.local/bin/konductor"

  if [[ -f "$power_cli_json" ]]; then
    recorded_binary="$(jq -r '.binary // empty' "$power_cli_json" 2>/dev/null || true)"
    recorded_version="$(jq -r '.cli_version // empty' "$power_cli_json" 2>/dev/null || true)"

    if [[ -z "$recorded_version" || ! "$recorded_version" =~ $KONDUCTOR_CLI_VERSION_REGEX ]]; then
      konductor_die "${power_cli_json} has a missing or malformed cli_version (got: '${recorded_version:-<empty>}', expected a bare semver like 1.0.2) -- refusing to trust it for a glob or path lookup. Re-run onboarding for this project: scripts/run-onboarding.sh --target ${target_dir} --confirmed"
      return 1
    fi

    # Trust-boundary check -- see this function's own doc comment above.
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

  # LEGACY path (resolution order step 4): no cli_version to compare
  # against, so trust the shared binary outright -- still through the
  # same resolve-and-check trust boundary; only the version check is waived.
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

  # Non-legacy fallback: the recorded binary didn't pan out -- search the
  # cache, then the shared symlink, for any binary still reporting that
  # exact version. Every glob match still goes through the same
  # resolve-and-check trust boundary before ever being run.
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
      # shellcheck disable=SC2034 # read only by run-update.sh/run-uninstall.sh after sourcing this file
      KONDUCTOR_RESOLVE_TARGET_BINARY_RESULT="$resolved"
      # shellcheck disable=SC2034 # read only by run-update.sh/run-uninstall.sh after sourcing this file
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

# konductor_publish_cached_binary <source> <destination>
# Copies a verified or built binary to a same-directory temporary file, then
# atomically replaces the cache entry. Cache entries must be regular files.
konductor_publish_cached_binary() {
  local source="$1" destination="$2" cache_dir temp_file

  if [[ ! -f "$source" ]]; then
    konductor_die "source binary ${source} is not a regular file."
    return 1
  fi

  cache_dir="$(dirname "$destination")"
  mkdir -p "$cache_dir"
  if [[ -d "$destination" || -L "$destination" ]]; then
    konductor_die "cache destination ${destination} is not a regular file path."
    return 1
  fi

  temp_file="$(mktemp "${cache_dir}/.$(basename "$destination").tmp.XXXXXX")"
  if ! cp "$source" "$temp_file"; then
    rm -f "$temp_file"
    konductor_die "failed to copy ${source} into the release cache."
    return 1
  fi
  if ! chmod +x "$temp_file"; then
    rm -f "$temp_file"
    konductor_die "failed to mark cached binary ${temp_file} executable."
    return 1
  fi
  if ! mv -f "$temp_file" "$destination"; then
    rm -f "$temp_file"
    konductor_die "failed to publish cached binary ${destination}."
    return 1
  fi
}
