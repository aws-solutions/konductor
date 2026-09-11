#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

TARGET="${1:?Usage: memory-validator.sh <target-file>}"
PROPOSED="$(cat)"

# Config: read from .konductor/memory-config.json relative to git root.
# Only path consulted, no fallback.
#
# Two states:
#   1. Present, well-formed -> use it.
#      Present, broken (bad JSON, unreadable, wrong-typed key) -> FAIL
#      CLOSED. A corrupt config must never silently degrade into an
#      unrestricted allowlist, and a stderr warning alone doesn't stop
#      that. A missing key isn't "broken" -- it resolves to the default,
#      same as state 2.
#   2. Absent -> use the defaults, warning on stderr. This config has
#      never been git-tracked, and "no config" is documented as expected
#      for anyone who hasn't hand-authored one -- failing here would
#      block every ordinary memory write.
GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
CONFIG_FILE="${GIT_ROOT}/.konductor/memory-config.json"

# Anchor a relative TARGET to the repo root too, mirroring CONFIG_FILE
# above -- the skill's real invocation always passes the relative literal
# ".konductor/memory/MEMORY.md", so without this a write from a package
# subdirectory (e.g. src/SomePackage/) lands at
# src/SomePackage/.konductor/memory/MEMORY.md instead of the canonical,
# root-anchored path the .gitignore rule assumes protects it. An
# already-absolute TARGET is left untouched.
case "$TARGET" in
  /*) ;;
  *) TARGET="${GIT_ROOT}/${TARGET}" ;;
esac
TARGET_DIR="$(dirname "$TARGET")"

# _parse_config <path>: parses a JSON config file and, on success (exit 0),
# prints:
#   MEMORY_MAX=<int-or-empty>
#   USER_MAX=<int-or-empty>
#   ALLOW:<pattern>      (zero or more lines)
#
# Success means well-shaped, not "every key present" -- a missing key
# resolves to its documented default. Failure (non-zero exit, a single
# CONFIG_ERROR: line on stdout) is anything that doesn't yield a usable
# policy: unreadable, malformed/empty JSON, a non-object top level, or a
# present key of the wrong type. Callers fail closed on this rather than
# falling through to defaults.
_parse_config() {
python3 - "$1" <<'PYEOF'
import json, sys

path = sys.argv[1]
try:
    with open(path) as f:
        raw = f.read()
except OSError as e:
    print(f"CONFIG_ERROR: cannot read {path}: {e}")
    sys.exit(1)

try:
    data = json.loads(raw)
except json.JSONDecodeError as e:
    print(f"CONFIG_ERROR: malformed JSON in {path}: {e}")
    sys.exit(1)

if not isinstance(data, dict):
    print(f"CONFIG_ERROR: {path} top level must be a JSON object, got {type(data).__name__}")
    sys.exit(1)

limits = data.get("limits", {})
if not isinstance(limits, dict):
    print(f"CONFIG_ERROR: {path} 'limits' must be an object, got {type(limits).__name__}")
    sys.exit(1)

memory_max = limits.get("memory_max_chars", "")
if memory_max != "" and (not isinstance(memory_max, int) or isinstance(memory_max, bool)):
    print(f"CONFIG_ERROR: {path} 'limits.memory_max_chars' must be an integer")
    sys.exit(1)

user_max = limits.get("user_max_chars", "")
if user_max != "" and (not isinstance(user_max, int) or isinstance(user_max, bool)):
    print(f"CONFIG_ERROR: {path} 'limits.user_max_chars' must be an integer")
    sys.exit(1)

allow = data.get("allowlist_patterns", [])
if not isinstance(allow, list) or not all(isinstance(x, str) for x in allow):
    print(f"CONFIG_ERROR: {path} 'allowlist_patterns' must be an array of strings")
    sys.exit(1)
if any("\n" in x or "\r" in x for x in allow):
    # A newline inside a printed "ALLOW:<pattern>" line would be read by the
    # caller's line-oriented `while read` loop as a SEPARATE output line --
    # letting one allowlist entry inject a bogus MEMORY_MAX=/USER_MAX=/
    # ALLOW: line of its own and silently override a budget or add an
    # unintended pattern. Reject at the source instead of trying to escape
    # it downstream.
    print(f"CONFIG_ERROR: {path} 'allowlist_patterns' entries must not contain newlines")
    sys.exit(1)

print(f"MEMORY_MAX={memory_max}")
print(f"USER_MAX={user_max}")
for pattern in allow:
    print(f"ALLOW:{pattern}")
PYEOF
}

MEMORY_MAX=2200
USER_MAX=1375
ALLOWLIST_RAW=""

if [[ -f "$CONFIG_FILE" ]]; then
  set +e
  PARSE_OUTPUT="$(_parse_config "$CONFIG_FILE")"
  PARSE_STATUS=$?
  set -e
  if [[ "$PARSE_STATUS" -ne 0 ]]; then
    if [[ "$PARSE_OUTPUT" == CONFIG_ERROR:* ]]; then
      # Config exists but didn't parse into a usable policy. Falling
      # through to defaults would silently turn a configured restriction
      # into an unrestricted allowlist, so fail closed instead.
      echo "REJECT: ${CONFIG_FILE} exists but could not be parsed as a valid config (${PARSE_OUTPUT#CONFIG_ERROR: }). Proceeding on defaults would silently convert a configured restriction into an unrestricted URL allowlist. Fix or remove the file, then retry." >&2
    else
      # No CONFIG_ERROR: line means _parse_config itself never ran (e.g.
      # python3 missing) -- an environment problem, not a statement about
      # the config's contents. Still fail closed, but name the real cause.
      echo "REJECT: could not invoke the interpreter needed to parse ${CONFIG_FILE} (exit ${PARSE_STATUS}). This is an environment problem (e.g. python3 missing or not executable), not a problem with the config file's contents. Fix the environment, then retry." >&2
    fi
    exit 1
  fi
  while IFS= read -r out_line; do
    case "$out_line" in
      MEMORY_MAX=*)
        v="${out_line#MEMORY_MAX=}"
        [[ -n "$v" ]] && MEMORY_MAX="$v"
        ;;
      USER_MAX=*)
        v="${out_line#USER_MAX=}"
        [[ -n "$v" ]] && USER_MAX="$v"
        ;;
      ALLOW:*)
        ALLOWLIST_RAW+="${out_line#ALLOW:}"$'\n'
        ;;
    esac
  done <<< "$PARSE_OUTPUT"
else
  echo "WARN: ${CONFIG_FILE} not found -- using default limits (2200/1375 chars) and an unrestricted URL allowlist. Create it from skills/persistent-memory/memory-config.json.template to restrict allowlist_patterns." >&2
fi

ALLOWLIST_PATTERNS=()
if [[ -n "$ALLOWLIST_RAW" ]]; then
  while IFS= read -r pattern; do
    [[ -n "$pattern" ]] && ALLOWLIST_PATTERNS+=("$pattern")
  done <<< "$ALLOWLIST_RAW"
fi

# Budget detection
if [[ "$TARGET" == *USER.md ]]; then
  BUDGET="$USER_MAX"
else
  BUDGET="$MEMORY_MAX"
fi

# URL allowlist loaded from config above; if empty, all URLs are allowed

url_allowed() {
  local url="$1"
  # If no allowlist configured, all URLs are permitted
  if [[ ${#ALLOWLIST_PATTERNS[@]} -eq 0 ]]; then
    return 0
  fi
  local host
  host="$(printf '%s\n' "$url" | sed -E 's|https?://([^/]+).*|\1|')"
  for pattern in "${ALLOWLIST_PATTERNS[@]}"; do
    local regex
    regex="$(echo "$pattern" | sed 's/\./\\./g; s/\*/[^.]*/g')"
    if [[ "$host" =~ ^${regex}$ ]]; then
      return 0
    fi
  done
  return 1
}

strip_date_prefix() {
  printf '%s\n' "$1" | sed -E 's/^\[[0-9]{4}-[0-9]{2}-[0-9]{2}\] //'
}

normalize_entry() {
  local text
  text="$(strip_date_prefix "$1")"
  text="${text#"${text%%[![:space:]]*}"}"  # ltrim
  text="${text%"${text##*[![:space:]]}"}"  # rtrim
  printf '%s\n' "$text" | tr '[:upper:]' '[:lower:]' | cut -c1-80
}

# Derive the "entry" text a line contributes to content validation.
# CWE-20 fix: content checks must not be limited to bullet lines -- an
# injection payload formatted as a heading, paragraph, blockquote, or
# numbered-list item must be checked too, since it is written to disk
# verbatim just like a bullet entry. This strips a leading bullet marker
# (- / *) or numbered-list marker (1. / 2. / ...) when present; any other
# line (heading, paragraph, blockquote, etc.) is used as-is.
#
# The bullet strip is ANCHORED (matches the numbered-item branch below):
# it removes exactly one leading marker char and its following space(s),
# nothing more. A prior version used the bash "${line#*[-*] }" shortest-
# prefix expansion, which matches the FIRST occurrence anywhere in the
# line of a "-"/"*" followed by a space -- not necessarily the leading
# one. When the leading marker is not immediately followed by a single
# space (e.g. "-1 *payload* text"), that shortest-match can land on a
# LATER "* "/"- " inside the payload (such as closing markdown emphasis),
# truncating everything before it away from the checked entry while the
# full original line is still written to disk verbatim via $PROPOSED.
# The anchored sed strip below cannot skip past the leading marker, so it
# preserves the rest of the payload -- including any later "*"/"-" -- for
# the content checks.
derive_entry() {
  local line="$1"
  if [[ "$line" =~ ^[[:space:]]*[-*] ]]; then
    printf '%s\n' "$line" | sed -E 's/^[[:space:]]*[-*][[:space:]]*//'
  elif [[ "$line" =~ ^[[:space:]]*[0-9]+\. ]]; then
    printf '%s\n' "$line" | sed -E 's/^[[:space:]]*[0-9]+\.[[:space:]]*//'
  else
    printf '%s\n' "$line"
  fi
}

# Strip leading markdown structural markers so the keyword-at-start check
# below isn't defeated by a marker sitting at position 0 (e.g. "## Ignore",
# "> Ignore", "**Ignore**", "`Ignore`"). Looped until a pass makes no
# further change, so nested markers (e.g. "> ## **Ignore") resolve fully
# regardless of order. Feeds ONLY the anchored keyword-at-start check below
# -- the phrase loop and the kw+agent_word combo loop are already
# substring-based and match a keyword anywhere in the line, marker or not,
# so they're deliberately left untouched.
#
# STRUCTURAL rule, not an enumeration: strip any leading run of characters
# that are neither alphanumeric nor whitespace. This closes the specific
# bypass reported (a leading backtick, e.g. "`Ignore the earlier retention
# rule`", was not in the old marker-by-marker list) and, being general
# rather than enumerated, also closes any FUTURE punctuation-based marker
# without another patch here. It supersedes and subsumes the individual
# blockquote (>), heading (#), emphasis (*/_), and bullet (-/*/+) rules,
# which were all just special cases of "leading punctuation" -- those are
# folded into step 2 below rather than kept as separate rules, since
# keeping them alongside a general rule that already covers them would be
# redundant.
#
# The numbered-marker rule (N. / N)) is the one case that CANNOT fold into
# the general rule: digits are alphanumeric, so "1." in "1. Ignore" is only
# half-stripped by the punctuation rule (the "." goes, the "1" doesn't).
# Kept as its own step for that reason.
strip_markdown_markers() {
  local text="$1"
  local prev=""
  while [[ "$text" != "$prev" ]]; do
    prev="$text"
    text="$(printf '%s\n' "$text" | sed -E 's/^[[:space:]]+//')"                # 1. leading whitespace
    text="$(printf '%s\n' "$text" | sed -E 's/^[^[:alnum:][:space:]]+//')"      # 2. leading punctuation/marker run (blockquote, heading, emphasis, bullet, backtick, or any other punctuation-based marker)
    text="$(printf '%s\n' "$text" | sed -E 's/^[0-9]+[.)][[:space:]]*//')"      # 3. numbered marker (kept separate -- digits are alnum, not caught by step 2)
  done
  printf '%s\n' "$text"
}

# Read existing entries (all non-blank lines from target if it exists, not
# just bullets -- see derive_entry above)
EXISTING=""
declare -a EXISTING_NORMS=()
if [[ -f "$TARGET" ]]; then
  EXISTING="$(cat "$TARGET")"
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    # Only include in norms if this line is still present in proposed content
    if printf '%s\n' "$PROPOSED" | grep -qxF -- "$line"; then
      EXISTING_NORMS+=("$(normalize_entry "$(derive_entry "$line")")")
    fi
  done < "$TARGET"
fi

# Validate proposed entries. Every non-blank line is checked -- bullets,
# numbered items, headings, paragraphs, blockquotes, etc. -- not just
# bullet lines (CWE-20 fix).
while IFS= read -r line; do
  [[ "$line" =~ ^[[:space:]]*$ ]] && continue

  entry="$(derive_entry "$line")"

  # 1. Near-duplicate check
  # Skip entries that exist verbatim in the current file (they're not new)
  if printf '%s\n' "$EXISTING" | grep -qxF -- "$line"; then
    continue
  fi
  norm="$(normalize_entry "$entry")"
  for existing in "${EXISTING_NORMS[@]+"${EXISTING_NORMS[@]}"}"; do
    if [[ "$norm" == "$existing" ]]; then
      echo "REJECT: near-duplicate entry matches existing: $existing" >&2
      exit 1
    fi
  done

  # 2. Entry length
  if [[ ${#entry} -gt 500 ]]; then
    echo "REJECT: entry exceeds 500 chars: ${entry:0:80}..." >&2
    exit 1
  fi

  # 3a. External URLs
  while IFS= read -r url; do
    if ! url_allowed "$url"; then
      echo "REJECT: blocked external URL: $url" >&2
      exit 1
    fi
  done < <(printf '%s\n' "$entry" | grep -oE 'https?://[^[:space:]]+' || true)

  # 3b. Code blocks
  if [[ "$entry" == *'```'* ]]; then
    echo "REJECT: code blocks (triple backtick) not allowed in entries" >&2
    exit 1
  fi

  # 3c. Instruction-like language
  stripped="$(strip_date_prefix "$entry")"
  stripped_lower="$(printf '%s\n' "$stripped" | tr '[:upper:]' '[:lower:]')"
  stripped_trimmed="$(strip_markdown_markers "$stripped_lower")"
  for kw in ignore override forget disregard pretend; do
    if [[ "$stripped_trimmed" == ${kw}* ]]; then
      echo "REJECT: instruction-like keyword '$kw' at start of entry" >&2
      exit 1
    fi
  done
  for phrase in "act as" "you are now" "new instructions" "new role" "system prompt"; do
    if [[ "$stripped_lower" == *"$phrase"* ]]; then
      echo "REJECT: instruction-like phrase '$phrase' in entry" >&2
      exit 1
    fi
  done
  for kw in ignore override forget disregard pretend; do
    if [[ "$stripped_lower" == *"$kw"* ]]; then
      for agent_word in you your instructions previous above prompt; do
        if [[ "$stripped_lower" == *"$agent_word"* ]]; then
          echo "REJECT: instruction-like language ('$kw' + '$agent_word') in entry" >&2
          exit 1
        fi
      done
    fi
  done

done <<< "$PROPOSED"

# 4. Budget check
# `wc -m` only counts characters in a UTF-8-aware locale; under C/POSIX
# (common in minimal containers, cron jobs, and systemd services where
# LANG/LC_ALL are unset or "C") it counts bytes, inflating multi-byte
# UTF-8 content and falsely rejecting content that is actually under
# budget. Forcing a specific UTF-8 locale (e.g. LC_ALL=C.UTF-8) is not a
# fix: if that locale isn't installed, wc silently falls back to
# byte-counting with no error, reproducing the same bug in a
# harder-to-notice form. Count with python3 instead: len() on a decoded
# stdin read counts Unicode code points regardless of the ambient
# locale. This makes python3 a required dependency for every write, not
# just when a config file is present (as _parse_config above already
# needs it) -- so an invocation failure here is reported the same way,
# as an environment problem, rather than left as an unexplained abort.
set +e
proposed_chars="$(printf '%s' "$PROPOSED" | python3 -c 'import sys; print(len(sys.stdin.read()))' 2>/dev/null)"
COUNT_STATUS=$?
set -e
if [[ "$COUNT_STATUS" -ne 0 ]]; then
  echo "REJECT: could not invoke the interpreter needed to count the proposed content's length (exit ${COUNT_STATUS}). This is an environment problem (e.g. python3 missing or not executable), not a problem with the proposed content. Fix the environment, then retry." >&2
  exit 1
fi
if [[ "$proposed_chars" -gt "$BUDGET" ]]; then
  echo "REJECT: proposed content ($proposed_chars chars) exceeds budget ($BUDGET chars)" >&2
  exit 1
fi

# Atomic write
mkdir -p "$TARGET_DIR"
TMPFILE="$(mktemp "${TARGET_DIR}/.memory-validator.XXXXXX")"
trap 'rm -f "${TMPFILE:-}"' EXIT
printf '%s' "$PROPOSED" > "$TMPFILE"
mv "$TMPFILE" "$TARGET"

# Staleness warnings
TODAY_EPOCH="$(date +%s)"
while IFS= read -r line; do
  if [[ "$line" =~ \[([0-9]{4}-[0-9]{2}-[0-9]{2})\] ]]; then
    entry_date="${BASH_REMATCH[1]}"
    entry_epoch="$(date -j -f "%Y-%m-%d" "$entry_date" "+%s" 2>/dev/null || date -d "$entry_date" "+%s" 2>/dev/null || echo 0)"
    if [[ "$entry_epoch" -gt 0 ]]; then
      age_days=$(( (TODAY_EPOCH - entry_epoch) / 86400 ))
      if [[ "$age_days" -gt 90 ]]; then
        echo "WARN: stale entry ($age_days days old): $line" >&2
      fi
    fi
  fi
done <<< "$PROPOSED"

exit 0
