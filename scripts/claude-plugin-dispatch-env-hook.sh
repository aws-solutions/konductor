#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Claude Code plugin SessionStart hook, copied to hooks/konductor-dispatch-env.sh
# in the published plugin tree. It copies the plugin's dispatch_permission_mode
# option into the session environment as KONDUCTOR_DISPATCH_PERMISSION_MODE,
# which the mux and cmux dispatch scripts read. A value the user exported
# themselves wins, and an unknown option value is ignored, so the dispatch
# scripts fall back to their default.
#
# It runs synchronously, so its stdout would become model context: it prints
# nothing and always exits 0.

[ -n "${CLAUDE_ENV_FILE:-}" ] || exit 0
[ -z "${KONDUCTOR_DISPATCH_PERMISSION_MODE:-}" ] || exit 0

MODE="${CLAUDE_PLUGIN_OPTION_DISPATCH_PERMISSION_MODE:-}"
case "$MODE" in
  interactive|headless|bypass)
    { printf 'export KONDUCTOR_DISPATCH_PERMISSION_MODE=%s\n' "$MODE"; } 2>/dev/null >>"$CLAUDE_ENV_FILE"
    ;;
esac
exit 0
