#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-tag-version-validation.sh -- pins that a tag or bare version is
# validated BEFORE it is ever used in a path, a download URL, or a
# `git clone --branch` ref, at each of this Power's three places that
# accept one: resolve-version.sh's construct_tag (a bare version, from
# plugin.json, KONDUCTOR_POWER_VERSION, or a future caller), fetch-
# verify-binary.sh's fetch_verify_binary entry, and build-from-source.sh's
# build_from_source entry (both of the latter two take an already
# v-prefixed tag, from --tag, KONDUCTOR_POWER_VERSION via construct_tag,
# or plugin.json's own default).
#
# Every invalid-input case below also proves the dangerous operation
# itself (curl, git clone, or a path write) never ran at all -- a
# rejection message alone would not prove the validation happens BEFORE
# first use rather than, say, after a already-attempted and failed
# traversal.
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
source "${TEST_DIR}/helpers.sh"

SCRIPTS_DIR="${KONDUCTOR_SETUP_SCRIPTS_DIR:-${TEST_DIR}/../../powers/konductor/skills/konductor-setup/scripts}"

# ── construct_tag (resolve-version.sh): bare-version input ─────────────────
# shellcheck disable=SC1090,SC1091
source "${SCRIPTS_DIR}/resolve-version.sh"

t_run construct_tag "../../etc/passwd"
t_assert_status "construct_tag rejects a path-traversal payload" 1
t_assert_contains "the rejection names the expected bare-semver shape" "not a valid bare semver"

t_run construct_tag "garbage"
t_assert_status "construct_tag rejects non-semver garbage" 1
t_assert_contains "the rejection names the expected bare-semver shape" "not a valid bare semver"

t_run construct_tag ""
t_assert_status "construct_tag still rejects an empty version" 1

t_run construct_tag "1.0.2"
t_assert_status "construct_tag still accepts a real bare semver" 0
t_assert_equal "a valid version is still tagged correctly" "v1.0.2" "$T_OUTPUT"

# ── fetch_verify_binary (fetch-verify-binary.sh): tag input ─────────────────
SCRATCH_FVB="$(mktemp -d)"
FAKE_BIN_FVB="${SCRATCH_FVB}/fake-bin"
CURL_MARKER="${SCRATCH_FVB}/curl-was-invoked.marker"
mkdir -p "$FAKE_BIN_FVB"

# A curl stub that marks every invocation (so an invalid-tag case can prove
# curl was NEVER reached) and otherwise serves a correct binary + matching
# checksum sidecar for the "valid tag still works" case.
cat > "${FAKE_BIN_FVB}/curl" <<STUB
#!/usr/bin/env bash
touch "${CURL_MARKER}"
set -euo pipefail
out=""
args=("\$@")
for ((i = 0; i < \${#args[@]}; i++)); do
  if [[ "\${args[\$i]}" == "-o" ]]; then
    out="\${args[\$((i + 1))]}"
  fi
done
url="\${args[-1]}"
name="\$(basename "\$url")"
case "\$name" in
  *.sha256)
    printf 'fake-binary-content\n' > "\${out%.sha256}.__reference"
    (cd "\$(dirname "\$out")" && sha256sum "\$(basename "\${out%.sha256}.__reference")" \
      | sed "s/\$(basename "\${out%.sha256}.__reference")/\$(basename "\${out%.sha256}")/") > "\$out"
    rm -f "\${out%.sha256}.__reference"
    ;;
  *)
    printf 'fake-binary-content\n' > "\$out"
    ;;
esac
exit 0
STUB
chmod +x "${FAKE_BIN_FVB}/curl"

# shellcheck disable=SC1090,SC1091
source "${SCRIPTS_DIR}/fetch-verify-binary.sh"

FVB_DEST_1="${SCRATCH_FVB}/dest-1"
t_run env PATH="${FAKE_BIN_FVB}:${PATH}" bash -c "source '${SCRIPTS_DIR}/fetch-verify-binary.sh'; fetch_verify_binary aws-solutions/konductor '../../../tmp/evil' x86_64-unknown-linux-musl '$FVB_DEST_1'"
t_assert_status "fetch_verify_binary rejects a path-traversal tag" 1
t_assert_contains "the rejection names the expected v-prefixed tag shape" "not a valid"
if [[ -f "$CURL_MARKER" ]]; then
  t_fail "curl must never run for an invalid tag -- validation must happen before any network call" "found marker at: $CURL_MARKER"
else
  t_pass "curl never ran for a path-traversal tag"
fi

rm -f "$CURL_MARKER"
FVB_DEST_2="${SCRATCH_FVB}/dest-2"
t_run env PATH="${FAKE_BIN_FVB}:${PATH}" bash -c "source '${SCRIPTS_DIR}/fetch-verify-binary.sh'; fetch_verify_binary aws-solutions/konductor '' x86_64-unknown-linux-musl '$FVB_DEST_2'"
t_assert_status "fetch_verify_binary rejects an empty tag" 1
if [[ -f "$CURL_MARKER" ]]; then
  t_fail "curl must never run for an empty tag" "found marker at: $CURL_MARKER"
else
  t_pass "curl never ran for an empty tag"
fi

rm -f "$CURL_MARKER"
FVB_DEST_3="${SCRATCH_FVB}/dest-3"
t_run env PATH="${FAKE_BIN_FVB}:${PATH}" bash -c "source '${SCRIPTS_DIR}/fetch-verify-binary.sh'; fetch_verify_binary aws-solutions/konductor 'garbage' x86_64-unknown-linux-musl '$FVB_DEST_3'"
t_assert_status "fetch_verify_binary rejects a garbage tag" 1
if [[ -f "$CURL_MARKER" ]]; then
  t_fail "curl must never run for a garbage tag" "found marker at: $CURL_MARKER"
else
  t_pass "curl never ran for a garbage tag"
fi

rm -f "$CURL_MARKER"
FVB_DEST_4="${SCRATCH_FVB}/dest-4"
t_run env HOME="$SCRATCH_FVB" PATH="${FAKE_BIN_FVB}:${PATH}" bash -c "source '${SCRIPTS_DIR}/fetch-verify-binary.sh'; fetch_verify_binary aws-solutions/konductor 'v1.0.2' x86_64-unknown-linux-musl '$FVB_DEST_4' && echo \"RESULT=\$FETCH_VERIFY_BINARY_RESULT\""
t_assert_status "fetch_verify_binary still succeeds for a valid v-prefixed tag" 0
t_assert_contains "a valid tag still resolves a verified binary" "RESULT=${SCRATCH_FVB}/.konductor/cli-releases/konductor-v1.0.2-x86_64-unknown-linux-musl"
if [[ -f "$CURL_MARKER" ]]; then
  t_pass "curl did run for a valid tag (proving validation does not block legitimate use)"
else
  t_fail "curl should have run for a valid tag" "no marker at: $CURL_MARKER"
fi

rm -rf "$SCRATCH_FVB"

# ── build_from_source (build-from-source.sh): tag input ─────────────────────
SCRATCH_BFS="$(mktemp -d)"
FAKE_BIN_BFS="${SCRATCH_BFS}/fake-bin"
FAKE_HOME_BFS="${SCRATCH_BFS}/fake-home"
GIT_MARKER="${SCRATCH_BFS}/git-was-invoked.marker"
mkdir -p "$FAKE_BIN_BFS" "$FAKE_HOME_BFS"

cat > "${FAKE_BIN_BFS}/cargo" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "${FAKE_BIN_BFS}/cargo"

cat > "${FAKE_BIN_BFS}/make" <<'STUB'
#!/usr/bin/env bash
mkdir -p build/cli
printf '#!/usr/bin/env bash\necho "fake built konductor"\n' > build/cli/konductor
chmod +x build/cli/konductor
exit 0
STUB
chmod +x "${FAKE_BIN_BFS}/make"

# Marks every invocation (so an invalid-tag case can prove git was never
# reached), then "clones" honestly -- HEAD always matches the requested
# tag, since this file is only pinning the tag-FORMAT validation, not the
# tag/HEAD mismatch behavior test-build-from-source-tag.sh already covers.
cat > "${FAKE_BIN_BFS}/git" <<STUB
#!/usr/bin/env bash
touch "${GIT_MARKER}"
case "\$1" in
  clone)
    args=("\$@")
    dir="\${args[-1]}"
    tag=""
    for ((i = 0; i < \${#args[@]}; i++)); do
      if [[ "\${args[\$i]}" == "--branch" ]]; then
        tag="\${args[\$((i + 1))]}"
      fi
    done
    mkdir -p "\$dir"
    echo "\$tag" > "\$dir/.stub-describe-result"
    exit 0
    ;;
  describe)
    cat ".stub-describe-result"
    exit 0
    ;;
  *)
    echo "stub-git: unsupported subcommand: \$1" >&2
    exit 1
    ;;
esac
STUB
chmod +x "${FAKE_BIN_BFS}/git"

BFS_CLONE_1="${SCRATCH_BFS}/clone-1"
t_run env HOME="$FAKE_HOME_BFS" PATH="${FAKE_BIN_BFS}:${PATH}" \
  bash "${SCRIPTS_DIR}/build-from-source.sh" "https://github.com/aws-solutions/konductor.git" "../../../tmp/evil" "$BFS_CLONE_1"
t_assert_status "build_from_source rejects a path-traversal tag" 1
t_assert_contains "the rejection names the expected v-prefixed tag shape" "not a valid"
if [[ -f "$GIT_MARKER" ]]; then
  t_fail "git must never run for an invalid tag -- validation must happen before any clone attempt" "found marker at: $GIT_MARKER"
else
  t_pass "git never ran for a path-traversal tag"
fi
if [[ -e "$BFS_CLONE_1" ]]; then
  t_fail "no clone directory should ever be created for an invalid tag" "found: $BFS_CLONE_1"
else
  t_pass "no clone directory was created for a path-traversal tag"
fi

rm -f "$GIT_MARKER"
BFS_CLONE_2="${SCRATCH_BFS}/clone-2"
t_run env HOME="$FAKE_HOME_BFS" PATH="${FAKE_BIN_BFS}:${PATH}" \
  bash "${SCRIPTS_DIR}/build-from-source.sh" "https://github.com/aws-solutions/konductor.git" "" "$BFS_CLONE_2"
t_assert_status "build_from_source rejects an empty tag" 1
if [[ -f "$GIT_MARKER" ]]; then
  t_fail "git must never run for an empty tag" "found marker at: $GIT_MARKER"
else
  t_pass "git never ran for an empty tag"
fi

rm -f "$GIT_MARKER"
BFS_CLONE_3="${SCRATCH_BFS}/clone-3"
t_run env HOME="$FAKE_HOME_BFS" PATH="${FAKE_BIN_BFS}:${PATH}" \
  bash "${SCRIPTS_DIR}/build-from-source.sh" "https://github.com/aws-solutions/konductor.git" "garbage" "$BFS_CLONE_3"
t_assert_status "build_from_source rejects a garbage tag" 1
if [[ -f "$GIT_MARKER" ]]; then
  t_fail "git must never run for a garbage tag" "found marker at: $GIT_MARKER"
else
  t_pass "git never ran for a garbage tag"
fi

rm -f "$GIT_MARKER"
BFS_CLONE_4="${SCRATCH_BFS}/clone-4"
t_run env HOME="$FAKE_HOME_BFS" PATH="${FAKE_BIN_BFS}:${PATH}" \
  bash "${SCRIPTS_DIR}/build-from-source.sh" "https://github.com/aws-solutions/konductor.git" "v1.0.2" "$BFS_CLONE_4"
t_assert_status "build_from_source still succeeds for a valid v-prefixed tag" 0
t_assert_contains "a valid tag still produces a cached, built binary" "${FAKE_HOME_BFS}/.konductor/cli-releases/konductor-v1.0.2-source-build"
if [[ -f "$GIT_MARKER" ]]; then
  t_pass "git did run for a valid tag (proving validation does not block legitimate use)"
else
  t_fail "git should have run for a valid tag" "no marker at: $GIT_MARKER"
fi

rm -rf "$SCRATCH_BFS"

# ── Integration via run-onboarding.sh: --tag and KONDUCTOR_POWER_VERSION ───
# Both sources end up validated: --tag reaches fetch_verify_binary's own
# check directly (it is passed through as an already v-prefixed tag, never
# itself run through construct_tag); KONDUCTOR_POWER_VERSION is a bare
# version run through construct_tag first, so it is caught there instead,
# with construct_tag's own "not a valid bare semver" message rather than
# fetch_verify_binary's "not a valid" tag message. Both must fail-stop
# before any network call -- exercised here with --allow-non-default-repo
# already passed, so the (unrelated) source-redirection gate itself is not
# what is being pinned by this section.
SCRATCH_INT="$(mktemp -d)"
FAKE_BIN_INT="${SCRATCH_INT}/fake-bin"
FAKE_HOME_INT="${SCRATCH_INT}/fake-home"
TARGET_INT="${SCRATCH_INT}/project"
CURL_MARKER_INT="${SCRATCH_INT}/curl-was-invoked.marker"
mkdir -p "$FAKE_BIN_INT" "$FAKE_HOME_INT" "$TARGET_INT"
cat > "${FAKE_BIN_INT}/curl" <<STUB
#!/usr/bin/env bash
touch "${CURL_MARKER_INT}"
exit 1
STUB
chmod +x "${FAKE_BIN_INT}/curl"
ORCHESTRATOR="${SCRIPTS_DIR}/run-onboarding.sh"

t_run env HOME="$FAKE_HOME_INT" PATH="${FAKE_BIN_INT}:${PATH}" \
  bash "$ORCHESTRATOR" --target "$TARGET_INT" --confirmed --allow-non-default-repo --tag "../../../tmp/evil"
t_assert_status "run-onboarding.sh --tag with a path-traversal payload fails closed" 1
t_assert_contains "the failure names the expected v-prefixed tag shape" "not a valid"
if [[ -f "$CURL_MARKER_INT" ]]; then
  t_fail "no network call should ever happen for a malicious --tag" "found marker at: $CURL_MARKER_INT"
else
  t_pass "run-onboarding.sh --tag path-traversal payload never reached curl"
fi

rm -f "$CURL_MARKER_INT"
t_run env HOME="$FAKE_HOME_INT" PATH="${FAKE_BIN_INT}:${PATH}" KONDUCTOR_POWER_VERSION="../../../tmp/evil" \
  bash "$ORCHESTRATOR" --target "$TARGET_INT" --confirmed --allow-non-default-repo
t_assert_status "run-onboarding.sh KONDUCTOR_POWER_VERSION with a path-traversal payload fails closed" 1
t_assert_contains "the failure names the expected bare-semver shape (caught in construct_tag)" "not a valid bare semver"
if [[ -f "$CURL_MARKER_INT" ]]; then
  t_fail "no network call should ever happen for a malicious KONDUCTOR_POWER_VERSION" "found marker at: $CURL_MARKER_INT"
else
  t_pass "run-onboarding.sh KONDUCTOR_POWER_VERSION path-traversal payload never reached curl"
fi

rm -rf "$SCRATCH_INT"

t_summary
