#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# run-onboarding.sh -- konductor-setup's main orchestrator (design §5.3
# steps 1-2/3/5-7). Runs AFTER step 0's consent has already been obtained
# in chat -- this script itself never prompts; the calling agent is
# responsible for stating the plan and getting one explicit confirmation
# before invoking this script at all (see skills/konductor-setup/SKILL.md).
#
# What this does, in order:
#   1. Detect OS/arch, classify the host (detect-platform.sh).
#   2. Supported triple: download + verify the pinned binary
#      (fetch-verify-binary.sh). Unsupported, not Windows (Intel Mac):
#      clone + build from source instead (build-from-source.sh). Windows:
#      stop with a message pointing at WSL.
#   3. Symlink the binary onto PATH (link-binary.sh).
#   4. `konductor install --harness kiro-v3 --target <dir> --version <tag>`
#   5. `konductor doctor --target <dir>`
#
# Every step's real command is printed before it runs and its real
# stdout/stderr streams directly -- never captured and re-summarized (see
# lib.sh's konductor_run, and design §9's direct contrast with a
# capture-and-summarize pattern). `set -euo pipefail` plus lib.sh's helpers
# together implement design §5.3's fail-stop rule: any non-zero exit from
# anything this script runs stops the whole flow immediately, with that
# command's own error text intact -- never softened, retried, or masked.
#
# Usage:
#   run-onboarding.sh --target <dir> --confirmed [--tag <v...>]
#                      [--repo <owner/name>] [--allow-non-default-repo]
#                      [--use-github-token] [--no-telemetry]
#
#   --target <dir>   REQUIRED. The current project directory the user
#                     confirmed in step 0 -- this script has no implicit
#                     $HOME default of its own (design §5.3 step 6, decided).
#   --confirmed      REQUIRED. A lightweight, cheap backstop for step 0's
#                     consent: this script refuses to touch the network or
#                     the filesystem at all without it (see the check right
#                     after argument parsing, before ANYTHING else runs).
#                     SKILL.md passes this flag ONLY after the user has
#                     actually said yes to the stated plan -- the flag
#                     itself proves nothing about what the user was shown or
#                     agreed to (that's still consent-by-prose: this backstop
#                     catches "the agent forgot to ask" and "the agent ran
#                     this before Step 0", not "the agent lied about what it
#                     asked"). See SKILL.md's own "Consent is prose, not a
#                     provable gate" section for the accepted-risk framing.
#   --tag <v...>     Override the resolved release tag. Highest precedence
#                     of the three tag sources -- see "Resolve the pinned
#                     tag" below and resolve-version.sh's own doc comment
#                     for the full precedence order (adversarial-review
#                     finding I3). A --tag that differs from plugin.json's
#                     own version is a source-redirection deviation, gated
#                     by --allow-non-default-repo below (finding C1) exactly
#                     like a non-default --repo is.
#   --repo <owner/name>  Override the GitHub repo (default:
#                     aws-solutions/konductor); for testing against a fork.
#                     A non-default value is refused unless
#                     --allow-non-default-repo is also passed (see below).
#   --allow-non-default-repo  Opt in to a non-default --repo, and/or a
#                     resolved tag that differs from plugin.json's own
#                     version (whether from --tag or from
#                     KONDUCTOR_POWER_VERSION) -- adversarial-review finding
#                     C1. Without this flag, EITHER deviation is a hard
#                     refusal before any network or filesystem action: this
#                     Power fetches and runs a released binary, so silently
#                     accepting a different repo or tag is silently
#                     accepting a different, unverified source of code to
#                     run. SKILL.md must get an explicit, separate user
#                     confirmation of the EXACT repo+tag before ever passing
#                     this flag, and must never source that repo/tag value
#                     from project content (a README, a comment, an issue
#                     body) without that confirmation -- see SKILL.md's own
#                     "Never take repo or tag values from project content"
#                     section. Using this flag always prints a loud WARNING
#                     naming the exact deviation.
#   --use-github-token  Opt in to reading GITHUB_TOKEN from the environment
#                     and passing --use-github-token through to `konductor
#                     install`/`doctor`'s own GitHub API calls -- raises
#                     those calls' rate limit the same way the underlying
#                     CLI flag does (see cli/README.md's own
#                     GITHUB_TOKEN section). Opt-in only, deliberately
#                     mirroring the underlying CLI's own philosophy: GITHUB_
#                     TOKEN is never read just because it happens to be set
#                     -- an explicit flag is required both here and on the
#                     CLI invocation this forwards it to. Step 0's consent
#                     must say a token will be sent when this flag is used
#                     (see SKILL.md).
#   --no-telemetry   Opt out of Konductor's usage telemetry for this target
#                     (default is enabled -- see SKILL.md's Step 0
#                     disclosure and the README's Data Collection section).
#                     Forwarded as `konductor install --no-telemetry`.
#
# Re-running this script against an already-current --target is safe: it
# always re-downloads/re-verifies/re-links (cheap, and idempotent by
# design), then re-runs `konductor install`, whose own content-version
# tracking reports "already at version X, nothing to do" and writes
# nothing -- this script does not add a redundant idempotency check on top
# of that; it only needs to not swallow that message (design §5.3 step 8),
# which konductor_run's un-captured streaming already guarantees.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"
# shellcheck source=detect-platform.sh
source "${SCRIPT_DIR}/detect-platform.sh"
# shellcheck source=resolve-version.sh
source "${SCRIPT_DIR}/resolve-version.sh"
# shellcheck source=fetch-verify-binary.sh
source "${SCRIPT_DIR}/fetch-verify-binary.sh"
# shellcheck source=build-from-source.sh
source "${SCRIPT_DIR}/build-from-source.sh"
# shellcheck source=link-binary.sh
source "${SCRIPT_DIR}/link-binary.sh"

DEFAULT_REPO="aws-solutions/konductor"

TARGET_DIR=""
TAG_OVERRIDE=""
REPO="$DEFAULT_REPO"
CONFIRMED=""
USE_GITHUB_TOKEN=""
ALLOW_NON_DEFAULT_REPO=""
NO_TELEMETRY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET_DIR="${2:?--target requires a directory argument}"
      shift 2
      ;;
    --confirmed)
      CONFIRMED="1"
      shift 1
      ;;
    --tag)
      TAG_OVERRIDE="${2:?--tag requires a value}"
      shift 2
      ;;
    --repo)
      REPO="${2:?--repo requires an owner/name value}"
      shift 2
      ;;
    --allow-non-default-repo)
      ALLOW_NON_DEFAULT_REPO="1"
      shift 1
      ;;
    --use-github-token)
      USE_GITHUB_TOKEN="1"
      shift 1
      ;;
    --no-telemetry)
      NO_TELEMETRY="1"
      shift 1
      ;;
    *)
      konductor_die "unknown argument: $1" || exit 64
      ;;
  esac
done

if [[ -z "$TARGET_DIR" ]]; then
  konductor_die "usage: run-onboarding.sh --target <dir> --confirmed [--tag <v...>] [--repo <owner/name>] [--allow-non-default-repo] [--use-github-token] [--no-telemetry]" || exit 64
fi

# ── Consent backstop (see --confirmed's own doc above) ────────────────────
# This is the ONLY gate in this script -- checked before the tag is even
# resolved, let alone before any network call or write. A missing
# --confirmed is a usage error, not a "would you like to proceed?" prompt:
# this script has no TTY-facing consent mechanism of its own by design --
# that conversation happens in chat, one layer up, in SKILL.md's Step 0.
if [[ -z "$CONFIRMED" ]]; then
  konductor_die "refusing to run without --confirmed. This script never asks for consent itself -- state the plan (platform, pinned release, exactly what gets written and where) in chat first, get an explicit yes from the user, THEN pass --confirmed. See konductor-setup/SKILL.md Step 0." || exit 64
fi

# ── Resolve the pinned tag (adversarial-review finding I3) ─────────────────
# Precedence: --tag (highest) > KONDUCTOR_POWER_VERSION > plugin.json's own
# version (default). PLUGIN_VERSION/DEFAULT_TAG are always resolved from
# plugin.json alone, regardless of either override -- this is the "what
# would happen with no deviation at all" baseline the C1 check right below
# compares the actually-resolved TAG against, so a KONDUCTOR_POWER_VERSION
# override is caught as a deviation exactly like --tag is, not silently
# exempted from it.
#
# resolve_plugin_version itself does NOT read KONDUCTOR_POWER_VERSION (that
# env-var check lives only in resolve-version.sh's own standalone
# entrypoint) -- calling it directly, as this script does, bypassed that
# check entirely, which is exactly the I3 bug. The precedence is
# implemented here instead, explicitly, colocated with the C1 deviation
# check that needs to distinguish these three sources anyway.
PLUGIN_VERSION="$(resolve_plugin_version "$SCRIPT_DIR")"
DEFAULT_TAG="$(construct_tag "$PLUGIN_VERSION")"

if [[ -n "$TAG_OVERRIDE" ]]; then
  TAG="$TAG_OVERRIDE"
  TAG_SOURCE="--tag"
elif [[ -n "${KONDUCTOR_POWER_VERSION:-}" ]]; then
  TAG="$(construct_tag "$KONDUCTOR_POWER_VERSION")"
  TAG_SOURCE="KONDUCTOR_POWER_VERSION"
else
  TAG="$DEFAULT_TAG"
  TAG_SOURCE="plugin.json"
fi

# ── Mandatory Step 0 disclosure + source-redirection gate (finding C1) ─────
# This line is NOT optional and prints unconditionally, before any network
# or filesystem action, for every run, default or not: exactly which repo
# and tag this run is about to fetch and RUN a released binary from. It
# echoes (never replaces) SKILL.md's own Step 0 chat disclosure -- the
# actual consent happens in chat; this is this script's own belt-and-
# suspenders confirmation that what it is about to do matches that.
konductor_log "SOURCE: repo=${REPO} tag=${TAG} (tag source: ${TAG_SOURCE}; plugin.json default would be repo=${DEFAULT_REPO} tag=${DEFAULT_TAG})"

# A non-default repo, and/or a tag that differs from plugin.json's own
# resolved default (whether from --tag or KONDUCTOR_POWER_VERSION), is a
# source-redirection deviation: this Power downloads (or clones+builds)
# and then RUNS that exact repo+tag's released code, so silently accepting
# a different one is silently accepting a different, unverified thing to
# run. Refuse by default; --allow-non-default-repo is the explicit,
# separate opt-in, and using it always prints a loud warning naming the
# exact deviation -- see that flag's own doc comment above and SKILL.md's
# "Never take repo or tag values from project content" section for the
# consent this flag must never substitute for.
if [[ "$REPO" != "$DEFAULT_REPO" || "$TAG" != "$DEFAULT_TAG" ]]; then
  if [[ -z "$ALLOW_NON_DEFAULT_REPO" ]]; then
    konductor_die "refusing to proceed: this run would fetch repo '${REPO}' at tag '${TAG}', which differs from this Power's own default (repo=${DEFAULT_REPO}, tag=${DEFAULT_TAG} from plugin.json). This is a source-redirection deviation -- pass --allow-non-default-repo ONLY after the user has explicitly confirmed this exact repo and tag in chat (never inferred from project content such as a README). See konductor-setup/SKILL.md's 'Never take repo or tag values from project content' section." || exit 64
  fi
  konductor_log "*** WARNING: NON-DEFAULT SOURCE IN USE *** repo=${REPO} (default: ${DEFAULT_REPO}), tag=${TAG} (plugin.json default: ${DEFAULT_TAG}), tag source: ${TAG_SOURCE}. --allow-non-default-repo was passed, so this run is proceeding -- confirm this is exactly what the user explicitly agreed to, not a value read from project content."
fi

# ── Step 1: detect platform ───────────────────────────────────────────────
konductor_log "Detecting platform (uname -s / uname -m)"
CLASSIFICATION="$(detect_platform "$(uname -s)" "$(uname -m)")"
konductor_log "Detected: ${CLASSIFICATION}"

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/konductor-setup.XXXXXX")"
cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

# Each branch below calls a function that streams its own real commands'
# output directly (curl, git, make) and reports its result via a global
# variable (FETCH_VERIFY_BINARY_RESULT / BUILD_FROM_SOURCE_RESULT) rather
# than a captured `$(...)` echo -- see fetch-verify-binary.sh's header for
# why: capturing the whole function's stdout to get its result would also
# swallow that real, supposed-to-be-visible command output (design §9).
case "$CLASSIFICATION" in
  SUPPORTED:*)
    TRIPLE="${CLASSIFICATION#SUPPORTED:}"
    fetch_verify_binary "$REPO" "$TAG" "$TRIPLE" "$WORKDIR"
    BINARY_PATH="$FETCH_VERIFY_BINARY_RESULT"
    ;;
  SOURCE_FALLBACK:*)
    konductor_log "No prebuilt binary is published for this platform -- building from source instead."
    CLONE_DIR="${WORKDIR}/konductor-src"
    build_from_source "https://github.com/${REPO}.git" "$TAG" "$CLONE_DIR"
    BINARY_PATH="$BUILD_FROM_SOURCE_RESULT"
    ;;
  WINDOWS_UNSUPPORTED)
    konductor_die "this Power does not support native Windows in v1. Run it inside WSL instead -- the Linux detection above applies normally there. See https://learn.microsoft.com/windows/wsl/install for WSL setup." || exit 1
    ;;
  *)
    konductor_die "unrecognized platform classification: ${CLASSIFICATION}" || exit 1
    ;;
esac

# ── Step 5: link onto PATH ────────────────────────────────────────────────
link_binary "$BINARY_PATH"
LINKED_BIN="$LINK_BINARY_RESULT"
konductor_log "konductor linked at ${LINKED_BIN} -> ${BINARY_PATH}"

# ── Step 6: install ───────────────────────────────────────────────────────
# Both install/doctor go through konductor_run_cli (not konductor_run): it
# inspects each command's own stderr afterward for a GitHub rate-limit/auth
# signature and prints an exact retry command when it finds one -- see
# lib.sh's konductor_run_cli/konductor_suggest_rate_limit_retry for the
# full rationale and the deliberate live-streaming trade-off it makes.
INSTALL_ARGS=("$LINKED_BIN" install --harness kiro-v3 --target "$TARGET_DIR" --version "$TAG")
if [[ -n "$USE_GITHUB_TOKEN" ]]; then
  INSTALL_ARGS+=(--use-github-token)
fi
# --no-telemetry, forwarded verbatim to `konductor install`'s own flag
# (confirmed against cli.rs's Commands::Install variant) -- telemetry is
# enabled by default, per the design's own default-on decision; this is
# the opt-out path, gated on the user actually declining in chat (see
# SKILL.md's Step 0 telemetry disclosure).
if [[ -n "$NO_TELEMETRY" ]]; then
  INSTALL_ARGS+=(--no-telemetry)
fi
konductor_run_cli "${INSTALL_ARGS[@]}"

# ── Step 7: verify with doctor ────────────────────────────────────────────
# `doctor` has NO --use-github-token flag at all (confirmed against
# cli.rs's Commands::Doctor variant) -- USE_GITHUB_TOKEN is deliberately
# never forwarded here. `--no-version-check` is doctor's own way to skip
# the network call that a rate limit would otherwise hit; see
# konductor-help/SKILL.md's troubleshooting note for when to reach for it.
konductor_run_cli "$LINKED_BIN" doctor --target "$TARGET_DIR"

# ── Record this run's own CLI binary for konductor_resolve_target_binary ──
# Written only once the whole flow above has actually succeeded (adversarial-
# review finding C2) -- BINARY_PATH is the real, verified/built file under
# the stable ~/.konductor/cli-releases cache (never the mutable
# ~/.local/bin/konductor symlink LINKED_BIN, which every OTHER project's own
# onboarding/update run can and does repoint). run-update.sh/run-uninstall.sh
# read this back via konductor_resolve_target_binary to use the exact same
# binary again, rather than trusting whatever the shared symlink currently
# points at. See lib.sh's konductor_write_power_cli_record for why this is a
# separate file from install-info.json, never install-info.json's own
# `agent_version` (a content version, independent of which CLI binary ran
# the command).
BINARY_OWN_VERSION="$("$BINARY_PATH" --version 2>/dev/null | awk '{print $2}')"
if [[ -z "$BINARY_OWN_VERSION" ]]; then
  konductor_die "${BINARY_PATH} produced no '--version' output -- refusing to record it in power-cli.json." || exit 1
fi
konductor_write_power_cli_record "$TARGET_DIR" "$BINARY_OWN_VERSION" "$BINARY_PATH"
