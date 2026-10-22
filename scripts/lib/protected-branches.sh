#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Shared protected-ref list for the Claude Code plugin publish scripts.
# derive-plugin-candidate-branch.sh, build-plugin-candidate-commit.sh, and
# validate-plugin-publish-preconditions.sh each check a candidate branch
# name against this same list before trusting it; a single definition
# keeps the three checks from drifting out of agreement with each other.
#
# Meant to be sourced, not executed. Each caller keeps its own error
# message, exit code, and the point in its own flow where the check runs --
# this file only answers the yes/no question.

# is_protected_branch <name>
# Returns 0 if <name> is a protected ref (main, mainline, release/plugins),
# 1 otherwise.
is_protected_branch() {
  case "$1" in
    main|mainline|release/plugins)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}
