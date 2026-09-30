#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-link-binary-directory.sh -- reproduction test for adversarial-review
# finding I1: `ln -sf <target> <existing-dir>` silently creates
# <existing-dir>/<basename of target> INSTEAD of replacing <existing-dir>
# -- a real "writes somewhere else" bug, reproduced here directly against
# this host's own `ln`, that link_binary's I1 fix must refuse rather than
# fall into. Also pins the foreign-regular-file case and the atomic
# happy-path replace (temp symlink + rename), so this file covers every
# branch link-binary.sh's own header comment claims.
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
source "${TEST_DIR}/helpers.sh"

# KONDUCTOR_SETUP_SCRIPTS_DIR (adversarial-review finding I4): see
# test-fail-stop.sh's identical header comment for the full rationale.
SCRIPTS_DIR="${KONDUCTOR_SETUP_SCRIPTS_DIR:-${TEST_DIR}/../../powers/konductor/skills/konductor-setup/scripts}"
SCRIPT="${SCRIPTS_DIR}/link-binary.sh"

SCRATCH="$(mktemp -d)"
LOCAL_BIN="${SCRATCH}/local-bin"
mkdir -p "$LOCAL_BIN"

BINARY="${SCRATCH}/konductor-binary"
printf '#!/usr/bin/env bash\necho fake konductor\n' > "$BINARY"
chmod +x "$BINARY"

# shellcheck disable=SC1090,SC1091
source "$SCRIPT"

# ── Reproduction, first, independent of this Power's own code: confirm
# the underlying `ln -sf`-into-a-directory gotcha is real on THIS host's
# own `ln`, not an assumption -- if this ever stopped reproducing (a
# different `ln` implementation), the rest of this file's assertions
# would need re-examining, so it is asserted directly and separately.
REPRO_DIR="${SCRATCH}/repro-dir"
mkdir -p "$REPRO_DIR"
ln -sf "$BINARY" "$REPRO_DIR" 2>/dev/null || true
if [[ -e "${REPRO_DIR}/$(basename "$BINARY")" ]]; then
  t_pass "(reproduction) ln -sf into an existing directory writes INSIDE it, confirming the gotcha this fix guards against is real"
else
  t_fail "(reproduction) expected ln -sf's own directory-clobbering gotcha to reproduce on this host; it did not -- re-examine whether the I1 fix is still needed" "checked for: ${REPRO_DIR}/$(basename "$BINARY")"
fi
rm -rf "$REPRO_DIR"

# ── Test 1: link_binary refuses when the link path is an existing
# DIRECTORY -- must fail closed and must NOT write anything inside it
# (the actual I1 bug this file is named for).
DIR_AT_LINK_PATH="${LOCAL_BIN}/konductor"
mkdir -p "$DIR_AT_LINK_PATH"
touch "${DIR_AT_LINK_PATH}/pre-existing-unrelated-file"

t_run link_binary "$BINARY" "$LOCAL_BIN"
t_assert_status "link_binary refuses when the link path is a directory" 1
t_assert_contains "the refusal names it as a directory, not a generic failure" "already exists as a DIRECTORY"

if [[ -e "${DIR_AT_LINK_PATH}/$(basename "$BINARY")" ]]; then
  t_fail "link_binary must NEVER write the binary's basename inside the pre-existing directory (the exact I1 bug)" "found: ${DIR_AT_LINK_PATH}/$(basename "$BINARY")"
else
  t_pass "link_binary wrote nothing inside the pre-existing directory"
fi
if [[ -f "${DIR_AT_LINK_PATH}/pre-existing-unrelated-file" ]]; then
  t_pass "the directory's own pre-existing, unrelated content is untouched"
else
  t_fail "the directory's own pre-existing content was disturbed" "expected: ${DIR_AT_LINK_PATH}/pre-existing-unrelated-file"
fi
if [[ -d "$DIR_AT_LINK_PATH" && ! -L "$DIR_AT_LINK_PATH" ]]; then
  t_pass "the link path is still exactly the same real directory, not replaced"
else
  t_fail "the link path is no longer the same real directory it was before" "type: $(stat -c '%F' "$DIR_AT_LINK_PATH" 2>/dev/null || echo unknown)"
fi
rm -rf "$DIR_AT_LINK_PATH"

# ── Test 1b: link_binary refuses when the link path is a PRE-EXISTING
# SYMLINK that itself RESOLVES to a directory (adversarial-review finding
# I1, residual gap) -- must fail closed the same way Test 1's real
# directory does, must NOT write anything inside the directory the
# symlink points at, and must leave no stray temp-symlink file behind. A
# symlink-to-a-directory has `-L` true (it IS a symlink) but ALSO `-d`
# true (it RESOLVES to a directory) -- Test 1's own check (`-d && !-L`)
# and Test 2's foreign-file check (`-e && !-L`) both require `!-L` and so
# both skip this exact case; left unguarded, the atomic-replace step's
# `mv -f "$tmp_link" "$link_path"` would hit the identical "moves INSIDE
# the directory instead of replacing it" footgun `ln -sf` has, just one
# syscall later in the function.
REAL_DIR_ELSEWHERE="${SCRATCH}/real-dir-elsewhere"
mkdir -p "$REAL_DIR_ELSEWHERE"
touch "${REAL_DIR_ELSEWHERE}/pre-existing-unrelated-file"
SYMLINK_TO_DIR="${LOCAL_BIN}/konductor"
ln -s "$REAL_DIR_ELSEWHERE" "$SYMLINK_TO_DIR"

t_run link_binary "$BINARY" "$LOCAL_BIN"
t_assert_status "link_binary refuses when the link path is a symlink resolving to a directory" 1
t_assert_contains "the refusal names it as a directory, same message as the real-directory case" "already exists as a DIRECTORY"

if [[ -e "${REAL_DIR_ELSEWHERE}/$(basename "$BINARY")" ]]; then
  t_fail "link_binary must NEVER write the binary's basename inside the directory a pre-existing symlink resolves to" "found: ${REAL_DIR_ELSEWHERE}/$(basename "$BINARY")"
else
  t_pass "link_binary wrote nothing inside the directory the symlink resolves to"
fi
if [[ -f "${REAL_DIR_ELSEWHERE}/pre-existing-unrelated-file" ]]; then
  t_pass "the target directory's own pre-existing, unrelated content is untouched"
else
  t_fail "the target directory's own pre-existing content was disturbed" "expected: ${REAL_DIR_ELSEWHERE}/pre-existing-unrelated-file"
fi
if [[ -L "$SYMLINK_TO_DIR" && "$(readlink "$SYMLINK_TO_DIR")" == "$REAL_DIR_ELSEWHERE" ]]; then
  t_pass "the pre-existing symlink-to-a-directory is still exactly as it was, not replaced"
else
  t_fail "the pre-existing symlink-to-a-directory was disturbed" "readlink: $(readlink "$SYMLINK_TO_DIR" 2>/dev/null || echo '<not a symlink>')"
fi
LEFTOVER_TMP_1B=("${LOCAL_BIN}"/konductor.tmp.*)
if [[ -e "${LEFTOVER_TMP_1B[0]:-}" ]]; then
  t_fail "a temp symlink was left behind by the refused attempt" "found: ${LEFTOVER_TMP_1B[0]}"
else
  t_pass "no leftover temp symlink from the refused symlink-to-directory attempt"
fi
rm -f "$SYMLINK_TO_DIR"
rm -rf "$REAL_DIR_ELSEWHERE"

# ── Test 2: link_binary refuses a foreign regular file (not a symlink
# this Power created) at the link path -- never silently overwrites it.
FOREIGN_FILE="${LOCAL_BIN}/konductor"
printf 'not a symlink this Power created\n' > "$FOREIGN_FILE"

t_run link_binary "$BINARY" "$LOCAL_BIN"
t_assert_status "link_binary refuses a foreign regular file at the link path" 1
t_assert_contains "the refusal names it as something other than a symlink" "something other than a symlink this Power created"
t_assert_equal "the foreign file's own content is untouched" "not a symlink this Power created" "$(cat "$FOREIGN_FILE")"
rm -f "$FOREIGN_FILE"

# ── Test 3: happy path -- no pre-existing link path at all. Creates a
# real symlink, passing the -L/-f/-x post-check.
#
# NOT run via t_run for this one: t_run captures output through a
# `$(...)` command substitution, which runs link_binary in a SUBSHELL --
# any global it sets (LINK_BINARY_RESULT) would be set in that subshell
# and lost the instant it returns, never visible to this script's own
# shell afterward. Calling it directly, guarded by a manual set +e/set -e
# pair (link-binary.sh's own `set -euo pipefail`, still in effect in this
# sourcing shell, would otherwise abort this whole test file on the first
# refusal case above if it had been called this same direct way there),
# keeps the call in the CURRENT shell so LINK_BINARY_RESULT survives.
set +e
link_binary "$BINARY" "$LOCAL_BIN"
LINK_STATUS=$?
set -e
t_assert_equal "link_binary succeeds when nothing exists at the link path yet" "0" "$LINK_STATUS"
LINK_PATH="${LOCAL_BIN}/konductor"
if [[ -L "$LINK_PATH" && -f "$LINK_PATH" && -x "$LINK_PATH" ]]; then
  t_pass "the created path is a symlink resolving to an executable regular file"
else
  t_fail "the created path failed the symlink/executable-file post-check" "path: $LINK_PATH"
fi
t_assert_equal "LINK_BINARY_RESULT reports the link path" "$LINK_PATH" "$LINK_BINARY_RESULT"

# ── Test 4: re-linking over an EXISTING symlink (this Power's own,
# e.g. after a rebuild) replaces it atomically -- never refused, since
# this is exactly the idempotent re-run case link-binary.sh's own header
# documents, and the temp-symlink+rename approach must still work when a
# real symlink (not a directory, not a foreign file) is already there.
NEW_BINARY="${SCRATCH}/konductor-binary-v2"
printf '#!/usr/bin/env bash\necho fake konductor v2\n' > "$NEW_BINARY"
chmod +x "$NEW_BINARY"

t_run link_binary "$NEW_BINARY" "$LOCAL_BIN"
t_assert_status "re-linking over an existing symlink (this Power's own) succeeds" 0
RESOLVED_TARGET="$(readlink "$LINK_PATH")"
t_assert_equal "the symlink now points at the NEW binary, repointed atomically" "$NEW_BINARY" "$RESOLVED_TARGET"
if [[ -L "$LINK_PATH" ]]; then
  t_pass "after repointing, the link path is still a symlink (never left as a stray regular file)"
else
  t_fail "after repointing, the link path is no longer a symlink" "path: $LINK_PATH"
fi

# No leftover .tmp.<pid> file from the atomic-rename step should remain.
LEFTOVER_TMP=("${LOCAL_BIN}"/konductor.tmp.*)
if [[ -e "${LEFTOVER_TMP[0]:-}" ]]; then
  t_fail "a temp symlink from the atomic rename step was left behind" "found: ${LEFTOVER_TMP[0]}"
else
  t_pass "no leftover temp symlink from the atomic rename step"
fi

rm -rf "$SCRATCH"

t_summary
