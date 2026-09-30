#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-build-from-source-tag.sh -- pins build-from-source.sh's pinned-tag
# behavior: it must clone and verify HEAD is EXACTLY the tag
# resolve-version.sh built (never main/HEAD, and never a same-named branch
# shadowing the tag), and fail-stop -- never proceed to `make build` --
# when that verification doesn't hold. Uses stubbed `git`/`cargo`/`make` on
# a scratch PATH; no real network call, no real HOME touched.
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
source "${TEST_DIR}/helpers.sh"

# KONDUCTOR_SETUP_SCRIPTS_DIR (adversarial-review finding I4): defaults to
# this repo's own source tree, but a caller (make kiro-power-check, the CI
# publish job) can point it at the ASSEMBLED tree instead, so the test
# suite actually exercises what gets published rather than only the
# pre-assembly source layout.
SCRIPTS_DIR="${KONDUCTOR_SETUP_SCRIPTS_DIR:-${TEST_DIR}/../../powers/konductor/skills/konductor-setup/scripts}"
SCRIPT="${SCRIPTS_DIR}/build-from-source.sh"

SCRATCH="$(mktemp -d)"
FAKE_BIN="${SCRATCH}/fake-bin"
FAKE_HOME="${SCRATCH}/fake-home"
mkdir -p "$FAKE_BIN" "$FAKE_HOME"

# cargo only needs to exist and be executable -- build_from_source only
# ever does `command -v cargo` on the failure paths this file tests; it is
# never actually invoked.
cat > "${FAKE_BIN}/cargo" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "${FAKE_BIN}/cargo"

# make: only reached on the happy path (Test 3) -- creates the expected
# build/cli/konductor output `make build` would leave behind.
cat > "${FAKE_BIN}/make" <<'STUB'
#!/usr/bin/env bash
mkdir -p build/cli
printf '#!/usr/bin/env bash\necho "fake built konductor"\n' > build/cli/konductor
chmod +x build/cli/konductor
exit 0
STUB
chmod +x "${FAKE_BIN}/make"

# Stub git: `clone --branch <tag> --depth 1 <url> <dir>` fails closed for
# any tag containing "badtag" (mirrors the real, verified
# "fatal: Remote branch <tag> not found in upstream origin" / exit 128 a
# real nonexistent tag produces). Otherwise "clones" by creating <dir> and
# recording what `describe --tags --exact-match` should report back for
# it, via $STUB_DESCRIBE_RESULT (defaults to the tag actually requested,
# i.e. the honest, matching case) -- letting each test below control
# whether the simulated checkout matches the pinned tag or not, without
# touching the real network.
cat > "${FAKE_BIN}/git" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  clone)
    tag=""
    args=("$@")
    for ((i = 0; i < ${#args[@]}; i++)); do
      if [[ "${args[$i]}" == "--branch" ]]; then
        tag="${args[$((i + 1))]}"
      fi
    done
    dir="${args[-1]}"
    case "$tag" in
      *badtag*)
        echo "fatal: Remote branch $tag not found in upstream origin" >&2
        exit 128
        ;;
    esac
    mkdir -p "$dir"
    echo "${STUB_DESCRIBE_RESULT:-$tag}" > "$dir/.stub-describe-result"
    exit 0
    ;;
  describe)
    if [[ -f ".stub-describe-result" ]]; then
      cat ".stub-describe-result"
      exit 0
    fi
    echo "fatal: no tag exactly matches 'HEAD'" >&2
    exit 128
    ;;
  *)
    echo "stub-git: unsupported subcommand: $1" >&2
    exit 1
    ;;
esac
STUB
chmod +x "${FAKE_BIN}/git"

# shellcheck disable=SC1090,SC1091
source "$SCRIPT"

# ── Test 1: a nonexistent tag fails at clone, never reaches make build ──
CLONE_DIR_1="${SCRATCH}/clone-1"
t_run env HOME="$FAKE_HOME" PATH="${FAKE_BIN}:${PATH}" \
  bash "$SCRIPT" "https://github.com/aws-solutions/konductor.git" "v9999.0.0-badtag" "$CLONE_DIR_1"
t_assert_status "a nonexistent tag fails build-from-source.sh closed" 1
t_assert_contains "the failure names the specific tag that doesn't exist" "v9999.0.0-badtag"
t_assert_contains "the failure says it's refusing to build an unpinned checkout" "Not building an unpinned checkout"
if [[ -f "${CLONE_DIR_1}/build/cli/konductor" ]]; then
  t_fail "make build must never run when the clone itself failed" "found: ${CLONE_DIR_1}/build/cli/konductor"
else
  t_pass "make build never ran after a failed clone"
fi

# ── Test 2: clone succeeds, but HEAD does not match the pinned tag ──────
# (a same-named branch could shadow the tag upstream -- this is exactly
# the case a bare `--branch "$tag"` clone, with no follow-up verification,
# would silently build from.)
CLONE_DIR_2="${SCRATCH}/clone-2"
t_run env HOME="$FAKE_HOME" PATH="${FAKE_BIN}:${PATH}" STUB_DESCRIBE_RESULT="v0.9.0-not-the-pinned-tag" \
  bash "$SCRIPT" "https://github.com/aws-solutions/konductor.git" "v1.0.2" "$CLONE_DIR_2"
t_assert_status "a HEAD/tag mismatch after clone fails build-from-source.sh closed" 1
t_assert_contains "the failure names the pinned tag that was expected" "v1.0.2"
t_assert_contains "the failure names what HEAD actually resolved to" "v0.9.0-not-the-pinned-tag"
t_assert_contains "the failure says it refuses to build the wrong version" "refusing to build the wrong version"
if [[ -f "${CLONE_DIR_2}/build/cli/konductor" ]]; then
  t_fail "make build must never run when HEAD did not match the pinned tag" "found: ${CLONE_DIR_2}/build/cli/konductor"
else
  t_pass "make build never ran after a tag/HEAD mismatch"
fi

# ── Test 3: happy path -- clone matches the pinned tag exactly, build
# proceeds, and the result is relocated to the stable release cache (not
# left under the disposable clone dir -- see build-from-source.sh's own
# header for why that matters).
CLONE_DIR_3="${SCRATCH}/clone-3"
t_run env HOME="$FAKE_HOME" PATH="${FAKE_BIN}:${PATH}" \
  bash "$SCRIPT" "https://github.com/aws-solutions/konductor.git" "v1.0.2" "$CLONE_DIR_3"
t_assert_status "a verified, matching tag proceeds to a successful build" 0
t_assert_contains "the printed result path is under the stable release cache, not the clone dir" "${FAKE_HOME}/.konductor/cli-releases/"
if [[ -x "${FAKE_HOME}/.konductor/cli-releases/konductor-v1.0.2-source-build" ]]; then
  t_pass "the built binary was relocated to the stable release cache and is executable"
else
  t_fail "the built binary was not found at the expected stable release-cache path" "expected: ${FAKE_HOME}/.konductor/cli-releases/konductor-v1.0.2-source-build"
fi

rm -rf "$SCRATCH"

t_summary
