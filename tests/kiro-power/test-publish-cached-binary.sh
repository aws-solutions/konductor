#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Tests atomic publication into the shared CLI release cache.
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
source "${TEST_DIR}/helpers.sh"

SCRIPTS_DIR="${KONDUCTOR_SETUP_SCRIPTS_DIR:-${TEST_DIR}/../../powers/konductor/skills/konductor-setup/scripts}"
SCRATCH="$(mktemp -d)"
SOURCE="${SCRATCH}/source-konductor"
CACHE_DIR="${SCRATCH}/cache"
DESTINATION="${CACHE_DIR}/konductor-v1.1.0-test"

printf '#!/usr/bin/env bash\necho verified\n' > "$SOURCE"
chmod +x "$SOURCE"
mkdir -p "$CACHE_DIR"
printf 'old cache entry\n' > "$DESTINATION"

# shellcheck disable=SC1090,SC1091
t_run bash -c "source '${SCRIPTS_DIR}/lib.sh'; konductor_publish_cached_binary '${SOURCE}' '${DESTINATION}'"
t_assert_status "publishes a verified binary" 0
if [[ -x "$DESTINATION" && "$("$DESTINATION")" == "verified" ]]; then
  t_pass "replaces the cache entry with an executable binary"
else
  t_fail "publishes an executable binary" "destination: ${DESTINATION}"
fi
if compgen -G "${CACHE_DIR}/.konductor-v1.1.0-test.tmp.*" >/dev/null; then
  t_fail "removes temporary cache files after publication" "cache: ${CACHE_DIR}"
else
  t_pass "removes temporary cache files after publication"
fi

rm -f "$DESTINATION"
mkdir "$DESTINATION"
t_run bash -c "source '${SCRIPTS_DIR}/lib.sh'; konductor_publish_cached_binary '${SOURCE}' '${DESTINATION}'"
t_assert_status "refuses a cache destination that is a directory" 1
t_assert_contains "directory refusal names the destination" "$DESTINATION"
rm -rf "$DESTINATION"

printf 'foreign target\n' > "${SCRATCH}/foreign"
ln -s "${SCRATCH}/foreign" "$DESTINATION"
t_run bash -c "source '${SCRIPTS_DIR}/lib.sh'; konductor_publish_cached_binary '${SOURCE}' '${DESTINATION}'"
t_assert_status "refuses a cache destination that is a symlink" 1
t_assert_contains "symlink refusal names the destination" "$DESTINATION"
if [[ "$(cat "${SCRATCH}/foreign")" == "foreign target" ]]; then
  t_pass "does not overwrite a symlink target"
else
  t_fail "preserves a symlink target" "target: ${SCRATCH}/foreign"
fi

rm -rf "$SCRATCH"
t_summary
