# SPDX-License-Identifier: Apache-2.0
# Sourced by the unattended bench scripts. Resolves the state directory (pid, state and log files) and refuses one
# another user could have planted or can write to.
#
#   STATE_DIR=$(bench_state_dir "$OVERRIDE") || exit 1              resolve, create (mode 700) and verify
#   STATE_DIR=$(bench_state_dir "$OVERRIDE" --no-create) || exit 1  resolve, and verify only if it already exists
#
# Default: ${XDG_STATE_HOME:-$HOME/.local/state}/konductor-bench, else ${TMPDIR:-/tmp}/konductor-bench-<uid>.
# A non-empty OVERRIDE wins over the default and gets the same checks.

_bench_stat_field() {
  # $1 = GNU stat format, $2 = BSD stat format, $3 = path
  local v
  v=$(stat -c "$1" -- "$3" 2>/dev/null) || v=$(stat -f "$2" -- "$3" 2>/dev/null) || return 1
  printf '%s\n' "$v"
}

_bench_state_dir_verify() {
  local dir=$1 owner mode
  if [ -L "$dir" ]; then echo "bench: refusing state dir $dir: it is a symlink" >&2; return 1; fi
  if [ ! -d "$dir" ]; then echo "bench: refusing state dir $dir: not a directory" >&2; return 1; fi
  owner=$(_bench_stat_field %u %u "$dir") || { echo "bench: cannot stat state dir $dir" >&2; return 1; }
  if [ "$owner" != "$(id -u)" ]; then echo "bench: refusing state dir $dir: owned by uid $owner, not the current user" >&2; return 1; fi
  mode=$(_bench_stat_field %a %Lp "$dir") || { echo "bench: cannot stat state dir $dir" >&2; return 1; }
  case "$mode" in
    *[0-9]) : ;;
    *) echo "bench: cannot read the mode of state dir $dir" >&2; return 1 ;;
  esac
  if [ $((8#$mode & 8#022)) -ne 0 ]; then echo "bench: refusing state dir $dir: mode $mode is writable by group or others" >&2; return 1; fi
}

_bench_state_dir_make() {
  local dir=$1 parent
  [ -L "$dir" ] && return 0
  [ -e "$dir" ] && return 0
  parent=$(dirname -- "$dir")
  mkdir -p -- "$parent" 2>/dev/null || return 1
  mkdir -m 700 -- "$dir" 2>/dev/null || [ -d "$dir" ]
}

bench_state_dir() {
  local override=${1:-} mode=${2:-} dir fallback
  fallback="${TMPDIR:-/tmp}/konductor-bench-$(id -u)"
  if [ -n "$override" ]; then
    dir=$override
  elif [ -n "${XDG_STATE_HOME:-}" ]; then
    dir=$XDG_STATE_HOME/konductor-bench
  elif [ -n "${HOME:-}" ]; then
    dir=$HOME/.local/state/konductor-bench
  else
    dir=$fallback
  fi
  if [ "$mode" != --no-create ]; then
    if ! _bench_state_dir_make "$dir"; then
      if [ -n "$override" ] || [ "$dir" = "$fallback" ]; then echo "bench: cannot create state dir $dir" >&2; return 1; fi
      dir=$fallback
      _bench_state_dir_make "$dir" || { echo "bench: cannot create state dir $dir" >&2; return 1; }
    fi
  fi
  if [ -e "$dir" ] || [ -L "$dir" ]; then _bench_state_dir_verify "$dir" || return 1; fi
  printf '%s\n' "$dir"
}
