#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# konductor-install.sh
#
# ── WHAT THIS DOES ───────────────────────────────────────────────────────────
# Downloads a prebuilt `konductor` CLI binary for the host's platform from
# this repo's GitHub releases, verifies its checksum, and installs it onto
# PATH -- no local clone or Rust build. Target-triple detection mirrors
# `cli/konductor-rs/src/cli/install/target_triple.rs`'s `map_triple` table
# byte-for-byte, so this script and `konductor install` always agree on
# which triple a given host maps to.
#
# Finishes by running `konductor install --harness <HARNESS>` with no
# `--from` flag, so `install`'s own remote-install path fetches the
# packaged agent/skill/SOP `dist/` tarball and the platform's
# `skill-lookup-mcp` binary -- this script does not handle those itself.
#
# Lighter-weight than `scripts/konductor-clone-install.sh`, at a cost: it
# always installs the latest published release (no pinned commit) and only
# covers the three triples the release build matrix publishes (no Intel
# macOS, no Windows). Use `konductor-clone-install.sh` for those cases.
#
# ── USAGE ────────────────────────────────────────────────────────────────────
#   scripts/konductor-install.sh
#
# `REPO` defaults to `aws-solutions/konductor` (override to test a fork).
# `KONDUCTOR_HARNESS` defaults to `kiro-cli-v2`; passed through verbatim to
# `konductor install --harness` (same convention as
# `konductor-clone-install.sh`).
# `KONDUCTOR_USE_GITHUB_TOKEN` opts into reading `GITHUB_TOKEN` and sending
# it as a bearer token on this script's GitHub API requests -- needed only
# while this repo is still private ahead of its public launch. Mirrors
# `konductor install --use-github-token`'s exact semantics. Requires `jq`
# on this opt-in path only, to resolve an asset's authenticated download
# URL from the release metadata.
# `KONDUCTOR_TAG` pins the install to one published release (e.g.
# `KONDUCTOR_TAG=v0.1.2`), fetching `GET .../releases/tags/<tag>` in place
# of `GET .../releases/latest`. Unset (the default) keeps resolving
# whatever release is currently latest.

set -euo pipefail

REPO="${REPO:-aws-solutions/konductor}"
# `install` validates HARNESS itself and exits 64 on an invalid value.
HARNESS="${KONDUCTOR_HARNESS:-kiro-cli-v2}"

LOCAL_BIN="${HOME}/.local/bin"
# Kept separate from `<install-target>/.konductor/bin/` (install's own
# skill-lookup-mcp destination) so this script's binary is never mistaken
# for a file the install manifest tracks.
KONDUCTOR_RELEASES_DIR="${HOME}/.konductor/cli-releases"

# ── Dependency checks ────────────────────────────────────────────────────────
# Fail loudly, before any network access, rather than midway through a
# partially-completed download.
if ! command -v curl >/dev/null 2>&1; then
  echo "error: this script requires 'curl', which was not found on PATH." >&2
  exit 1
fi

# sha256sum ships by default on Linux; shasum -a 256 is the macOS
# equivalent. Both read the same sha256sum-format sidecar
# (`write_sidecar` in cli/konductor-rs/src/cli/synth/sidecar.rs), so
# either verifies it identically.
if command -v sha256sum >/dev/null 2>&1; then
  verify_sha256_sidecar() { sha256sum -c "$1"; }
elif command -v shasum >/dev/null 2>&1; then
  verify_sha256_sidecar() { shasum -a 256 -c "$1"; }
else
  echo "error: this script requires 'sha256sum' or 'shasum' to verify the downloaded binary, and neither was found on PATH." >&2
  exit 1
fi

# An empty/unset GITHUB_TOKEN with the opt-in set is treated the same as
# not opting in at all.
GITHUB_TOKEN_ACTIVE=""
if [[ -n "${KONDUCTOR_USE_GITHUB_TOKEN:-}" && -n "${GITHUB_TOKEN:-}" ]]; then
  GITHUB_TOKEN_ACTIVE="1"
  if ! command -v jq >/dev/null 2>&1; then
    echo "error: KONDUCTOR_USE_GITHUB_TOKEN requires 'jq' to resolve an authenticated asset URL from the release metadata, and it was not found on PATH." >&2
    exit 1
  fi
fi

# ── Target triple detection ──────────────────────────────────────────────────
# Mirrors `map_triple`'s match table byte-for-byte, keyed on `uname`'s
# string shapes (Linux/Darwin, x86_64/aarch64/arm64) instead of Rust's
# std::env::consts (linux/macos, x86_64/aarch64). Must agree with
# `konductor install`'s own triple detection for the same host, since
# `install --harness` (no --from) independently re-derives it to fetch the
# matching skill-lookup-mcp binary.
#
# Deliberately narrow: any other OS/ARCH combination -- notably Intel
# macOS (no free GitHub Actions runner to build it) and Windows -- fails
# rather than guessing a triple with no published asset behind it.
map_target_triple() {
  case "$1/$2" in
    Linux/x86_64) echo "x86_64-unknown-linux-musl" ;;
    Linux/aarch64) echo "aarch64-unknown-linux-musl" ;;
    Darwin/arm64) echo "aarch64-apple-darwin" ;;
    *) return 1 ;;
  esac
}

HOST_OS="$(uname -s)"
HOST_ARCH="$(uname -m)"
if ! TARGET_TRIPLE="$(map_target_triple "${HOST_OS}" "${HOST_ARCH}")"; then
  echo "error: no prebuilt konductor binary is published for this platform (uname -s=${HOST_OS}, uname -m=${HOST_ARCH})." >&2
  echo "Supported platforms: Linux x86_64, Linux aarch64, and macOS on Apple Silicon (arm64)." >&2
  echo "Use scripts/konductor-clone-install.sh to build from source instead." >&2
  exit 1
fi

# ── Release version resolution ───────────────────────────────────────────────
# Reads the same `tag_name` field from the same `GET .../releases/latest`
# endpoint `fetch_latest_release_metadata` reads, so "latest" here never
# drifts from the CLI's own notion of it. `KONDUCTOR_TAG`, when set, swaps
# the endpoint for `GET .../releases/tags/<tag>` instead -- same field,
# same fetch/parse/empty-check path below.
extract_tag_name() {
  grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/'
}

if [[ -n "${KONDUCTOR_TAG:-}" ]]; then
  echo "=== [konductor-install] Resolving pinned release ${KONDUCTOR_TAG} for ${REPO} ==="
  RELEASE_METADATA_URL="https://api.github.com/repos/${REPO}/releases/tags/${KONDUCTOR_TAG}"
else
  echo "=== [konductor-install] Resolving latest release version for ${REPO} ==="
  RELEASE_METADATA_URL="https://api.github.com/repos/${REPO}/releases/latest"
fi
if [[ -n "${GITHUB_TOKEN_ACTIVE}" ]]; then
  METADATA_FETCH_STATUS=0
  # The bearer token goes through curl's `--config -` (stdin), not a `-H`
  # command-line argument, so it never lands in the process table where
  # another local user could read it via `ps aux` or `/proc/<pid>/cmdline`.
  RELEASE_METADATA="$(printf 'header = "Authorization: Bearer %s"\n' "${GITHUB_TOKEN}" | curl -fsSL --config - -H "User-Agent: konductor-install" -H "Accept: application/vnd.github+json" "${RELEASE_METADATA_URL}")" || METADATA_FETCH_STATUS=$?
else
  METADATA_FETCH_STATUS=0
  RELEASE_METADATA="$(curl -fsSL -H "User-Agent: konductor-install" -H "Accept: application/vnd.github+json" "${RELEASE_METADATA_URL}")" || METADATA_FETCH_STATUS=$?
fi
if [[ "${METADATA_FETCH_STATUS}" -ne 0 ]]; then
  if [[ -n "${KONDUCTOR_TAG:-}" ]]; then
    echo "error: failed to fetch release metadata from ${RELEASE_METADATA_URL} -- check network access, or that ${REPO} has a release tagged '${KONDUCTOR_TAG}'." >&2
  else
    echo "error: failed to fetch release metadata from ${RELEASE_METADATA_URL} -- check network access, or that ${REPO} has at least one published release." >&2
  fi
  exit 1
fi
# Shielded with `|| true`: under `set -euo pipefail`, `extract_tag_name`'s
# `grep -o ... | head -n 1 | sed ...` pipeline can fail the whole
# assignment (grep exits 1 when tag_name is absent, or gets SIGPIPE'd by
# head closing early on multiple matches), which without this guard would
# abort the script here instead of reaching the friendly check below.
RELEASE_VERSION="$(printf '%s' "${RELEASE_METADATA}" | extract_tag_name)" || true
if [[ -z "${RELEASE_VERSION}" ]]; then
  echo "error: could not find a 'tag_name' field in the release metadata from ${RELEASE_METADATA_URL}." >&2
  exit 1
fi

# ── Download + checksum verification ─────────────────────────────────────────
# release.yml publishes konductor-<version>-<triple> (a raw binary, not
# an archive) plus its .sha256 sidecar as individually named release
# assets.
ASSET_NAME="konductor-${RELEASE_VERSION}-${TARGET_TRIPLE}"
SIDECAR_NAME="${ASSET_NAME}.sha256"
DOWNLOAD_BASE_URL="https://github.com/${REPO}/releases/download/${RELEASE_VERSION}"

# Throwaway per-run scratch dir under ~/.konductor (grouped with this
# script's other output, rather than /tmp), removed on exit via the trap
# below regardless of how the run ends.
mkdir -p "${HOME}/.konductor/downloads"
WORKDIR="$(mktemp -d "${HOME}/.konductor/downloads/konductor-install.XXXXXX")"
cleanup() {
  rm -rf "${WORKDIR}"
}
trap cleanup EXIT

# Unauthenticated (the default): hits GitHub's public
# `browser_download_url`-shaped path directly. Authenticated
# (KONDUCTOR_USE_GITHUB_TOKEN): that same path 404s unauthenticated
# against a private repo by design (GitHub returns 404, not 401/403, to
# avoid confirming the asset's existence to an unauthorized caller -- see
# `install::github::download_asset_bytes`'s own doc comment), so this
# instead resolves the asset's authenticated REST API `url` field from
# the already-fetched release metadata and requests that URL with the
# bearer token -- the same header/endpoint pair the Rust
# `--use-github-token` path uses.
download_asset() {
  local asset_name="$1" out_path="$2"
  if [[ -n "${GITHUB_TOKEN_ACTIVE}" ]]; then
    local asset_url
    asset_url="$(printf '%s' "${RELEASE_METADATA}" | jq -r --arg name "${asset_name}" '.assets[] | select(.name == $name) | .url' | head -n 1)"
    if [[ -z "${asset_url}" || "${asset_url}" == "null" ]]; then
      echo "error: no release asset named '${asset_name}' was found in the release metadata for ${RELEASE_VERSION}." >&2
      return 1
    fi
    # Same `--config -` treatment as the metadata fetch above.
    printf 'header = "Authorization: Bearer %s"\n' "${GITHUB_TOKEN}" | curl -fsSL --config - -H "User-Agent: konductor-install" -H "Accept: application/octet-stream" -o "${out_path}" "${asset_url}"
  else
    curl -fsSL -o "${out_path}" "${DOWNLOAD_BASE_URL}/${asset_name}"
  fi
}

echo "=== [konductor-install] Downloading ${ASSET_NAME} (release ${RELEASE_VERSION}) ==="
if ! download_asset "${ASSET_NAME}" "${WORKDIR}/${ASSET_NAME}"; then
  echo "error: failed to download ${ASSET_NAME} -- release ${RELEASE_VERSION} may not publish a binary for ${TARGET_TRIPLE}." >&2
  exit 1
fi
if ! download_asset "${SIDECAR_NAME}" "${WORKDIR}/${SIDECAR_NAME}"; then
  echo "error: failed to download the checksum sidecar ${SIDECAR_NAME} for ${ASSET_NAME}." >&2
  exit 1
fi

echo "=== [konductor-install] Verifying checksum ==="
if ! (cd "${WORKDIR}" && verify_sha256_sidecar "${SIDECAR_NAME}"); then
  echo "error: checksum verification failed for ${ASSET_NAME} -- the download may be corrupted or tampered with. Not installing." >&2
  exit 1
fi

# ── Install onto PATH ─────────────────────────────────────────────────────────
# Symlink, not copy, mirroring `make link`'s design (see cli/Makefile's
# `link` target): a later re-run repoints the symlink with no separate
# unlink step, and re-running this script is always safe -- it
# re-downloads, re-verifies, and overwrites both the versioned copy and
# the symlink every time.
mkdir -p "${KONDUCTOR_RELEASES_DIR}"
chmod +x "${WORKDIR}/${ASSET_NAME}"
INSTALLED_BINARY="${KONDUCTOR_RELEASES_DIR}/${ASSET_NAME}"
mv "${WORKDIR}/${ASSET_NAME}" "${INSTALLED_BINARY}"

mkdir -p "${LOCAL_BIN}"
KONDUCTOR_BIN="${LOCAL_BIN}/konductor"
ln -sf "${INSTALLED_BINARY}" "${KONDUCTOR_BIN}"
if [[ ! -x "${KONDUCTOR_BIN}" ]]; then
  echo "error: linked ${KONDUCTOR_BIN} -> ${INSTALLED_BINARY}, but it is not executable." >&2
  exit 1
fi

# ── Remote install (no --from) ───────────────────────────────────────────────
# No `--from` means `install` fetches everything else itself -- the
# packaged dist/ tarball and the platform's skill-lookup-mcp binary
# (degrading gracefully, a warning not a failure, if no binary is
# published for this platform) -- via its own existing remote-install
# mechanism. When the token opt-in is active, `--use-github-token` is
# passed through too: without it, the dist-tarball fetch 404s against a
# private repo even though the CLI binary itself downloaded fine above.
install_args=(install --harness "${HARNESS}" --verbose)
if [[ -n "${GITHUB_TOKEN_ACTIVE}" ]]; then
  install_args+=(--use-github-token)
fi
echo "=== [konductor-install] Installing to \$HOME (${HOME:-<unset>}) with harness=${HARNESS} ==="
"${KONDUCTOR_BIN}" "${install_args[@]}"

echo ""
echo "=== [konductor-install] Done ==="
echo "Platform:  ${TARGET_TRIPLE}"
echo "Version:   ${RELEASE_VERSION}"
echo "Binary:    ${INSTALLED_BINARY}"
echo "Linked:    ${KONDUCTOR_BIN} -> $(readlink "${KONDUCTOR_BIN}")"
echo "Harness:   ${HARNESS}"
echo "Installed: see the 'konductor install' report above for what was written and where."

if ! echo "${PATH}" | tr ':' '\n' | grep -qx "${LOCAL_BIN}"; then
  echo ""
  echo "NOTE: ${LOCAL_BIN} is not on your \$PATH, so the 'konductor' command above"
  echo "      won't resolve yet. Add it to your shell profile (e.g. ~/.bashrc or"
  echo "      ~/.zshrc), then open a new shell:"
  echo "        export PATH=\"${LOCAL_BIN}:\$PATH\""
fi
