#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# install.sh - install fuse-konductor from this clone.
#
#   install.sh --project <dir>                     [--uninstall]
#   install.sh --global <file> [<file> ...] [--link] [--uninstall]
#
# --project <dir> copies every skill into <dir>/.agents/skills/, adds the
#   always-on block to <dir>/AGENTS.md, and links <dir>/.claude/skills and
#   <dir>/.kiro/skills to .agents/skills. The project commits the result.
#
# --global <file> ... adds the always-on block to each listed user-level
#   instruction file and copies every skill into skills/ next to it. A file in
#   a directory named "steering" (Kiro CLI) gets its skills in skills/ next to
#   that directory instead.
#
# --link, with --global, links each skill into this clone instead of copying
#   it, so edits in the clone are live at once. It is meant for machines where
#   someone develops the skills. Running with or without --link converts the
#   skills this script installed earlier to the requested form.
#
# --uninstall reverses an install for the same arguments.
#
# The always-on block is AGENTS.fuse.md from this clone, with every {{CLONE}}
# replaced: by the clone's path in a global instruction file, and by a pointer
# to ~/.konductor/fuse-konductor-clone in a project's AGENTS.md, which is shared.
# The block is written between
# markers inside a <GENERATED> wrapper that DCP and DCL share:
#
#   <GENERATED>
#   <FUSE-KONDUCTOR>
#   ...
#   </FUSE-KONDUCTOR>
#   </GENERATED>
#
# Rules the script keeps (the tests check each of them):
#
# 1. It changes only what it installed.
#    - Global: a skill entry is ours when it is a copy holding a
#      .fuse-konductor-copy file that names this clone, or a symlink to
#      <clone>/skills/<name> (from --link).
#    - Project: the skills listed in .agents/skills/.fuse-konductor, each with
#      a checksum of the copy it put there (a copy edited since is kept and
#      reported, on update and on uninstall), and the
#      harness entries listed there: ".claude" or ".kiro" for a .claude/skills
#      or .kiro/skills link this script created, ".claude/<name>" or
#      ".kiro/<name>" for a per-skill link or marked copy it created in a real
#      .claude/skills or .kiro/skills directory.
#    Anything else with the same name is reported and skipped.
# 2. It never works through a symlinked directory in a project (.agents,
#    .agents/skills, .claude, .kiro) or a symlinked manifest, and every name it
#    deletes is a single path component, checked before anything changes.
# 3. In an instruction file, everything outside the <FUSE-KONDUCTOR> section
#    stays byte for byte the same. A marker counts only when it is the whole line
#    after trimming spaces. Inside the wrapper, every section must be a closed
#    <NAME> ... </NAME> pair at the top level. A file that breaks this is
#    reported and left alone.
# 4. An instruction file, the manifest and a fallback copy are each put in place
#    with one rename, so an interrupted run leaves the old version. An
#    instruction file keeps its permissions and is not replaced if it changed
#    while the script was editing it.
#
# Design note (review of 2026-09-28). The review rounds kept finding defects in
# the same place: how the script replaces things on disk. Every replacement
# follows one pattern, which rule 4 above states:
#   - build the new version under a fresh mktemp name in the same directory,
#     registered for removal on exit, never at a fixed name that could belong
#     to someone else;
#   - move an old version aside, never delete it, until the new one is in
#     place; put it back if the move fails or the script is interrupted (the
#     exit handler restores it; review obligation E1-R4-F1). Every loop runs
#     in the main shell, not in a pipeline, so the exit handler sees that
#     state and the temporary files;
#   - sync before and after the rename, for instruction files and fallback
#     copies alike (review obligation E1-R5-F1); an old copy moved aside stays
#     known to the exit handler until it is deleted (E1-R5-F2).
# This covers review obligations E1-R3-F1 (sync) and E1-R3-F2 (staging and
# rollback of fallback copies).
#
# Design note: project skill ownership (review of 2026-09-28, epoch 2). Two
# rounds found gaps in how the script tells an edited project copy from its
# own. The invariants, all of which the code keeps:
#   1. A project skill directory is the script's only if the manifest records
#      it; anything else with the name is reported and skipped.
#   2. A record is written only after its copy is in place, by the loop or by
#      the exit handler; a name whose copy did not land is never recorded.
#   3. A record's checksum is skill_hash of the copy the script placed. It
#      covers every path, its type, the owner's execute bit, and its content
#      or link target. All comparisons use skill_hash; none uses diff.
#   4. An owned copy whose skill_hash differs from its record, or, for a record
#      without a checksum, from the clone's skill, is the user's edit. It is
#      checked before any comparison with the clone and is never replaced or
#      deleted; update and uninstall keep it and report it.
#   5. A replaced copy stays moved aside until the new one is in place.
# Decision: keep this design and route every edit check through skill_hash.
# Removing edit preservation (documenting that a rerun overwrites the project
# copy) was considered and rejected, because project installs are meant to
# be edited with the project. The findings were each a comparison that did not
# go through one complete checksum: a record without a checksum
# (E1-R3-F1) and the execute bit (E1-R4-F1). This covers obligations
# E1-R2-F2, E1-R3-F1 and E1-R4-F1.
#
# Limits: the script is meant to be run by hand, on a machine and a project you
# trust. It takes no locks, so another program that writes the same file in the
# instant between the script's last check and its rename can lose that write;
# the DCP installer accepts the same race. It checks for symlinked project
# directories before it starts and again before each deletion, not in between.
# A symlinked global skills directory, such as ~/.claude/skills pointing into a
# dotfiles checkout, is followed on purpose; only entries proven to be ours are
# changed there.
#
# The script keeps no record of what existed before an install, other than
# the project manifest. So uninstall treats these as its own and removes them:
# an instruction file or <GENERATED> wrapper that holds nothing but the
# fuse-konductor section, and a directory that is empty once the script's
# entries are gone (the skills directory, the directory of an instruction
# file and its parent, and in a project .claude, .kiro, .agents/skills and
# .agents). A file that was created through a dangling symlink is emptied, not
# removed, and the symlink is kept. An empty directory or empty wrapper that
# existed before the install is therefore removed too.
#
# Exit status: 0 success, 1 a target was refused, 64 usage error.

set -eu
LC_ALL=C
export LC_ALL

USAGE='usage: install.sh --project <dir>                     [--uninstall]
       install.sh --global <file> [<file> ...] [--link] [--uninstall]'

GEN_OPEN='<GENERATED>'
GEN_CLOSE='</GENERATED>'
SEC_OPEN='<FUSE-KONDUCTOR>'
SEC_CLOSE='</FUSE-KONDUCTOR>'
COPY_MARK=.fuse-konductor-copy
# Where a project install records this clone's path, one line, for the agent
# block in the project's committed AGENTS.md to point at.
#
# Why in $HOME and not in the project (step-back note, review epoch 5, rounds
# 1 to 3). The clone's path is a fact about this machine, not about the
# project. The first design wrote it to <project>/.konductor/fuse-konductor-
# clone and had to keep these invariants: the committed tree never carries a
# machine path; the file is git-ignored by a rule the installer adds without
# disturbing other rules or a last line without a newline; the install changes
# nothing when the file cannot be written (symlinks, a .konductor that is not
# a directory, a .gitignore that is not a file, a foreign file at the path);
# only a pointer-shaped file is replaced, atomically; uninstall removes the
# pointer only when it names this clone and the ignore rule only when it is
# alone; any teammate's clone may re-point the project. Three review rounds
# patched that list one guard at a time. The invariant family is removed
# rather than patched: the pointer lives in the user's own $HOME/.konductor,
# where fuse-flow already looks for the user's workflows and skills. What is
# left: one line, "clone=<absolute path>", written by rename, refused when
# something that is not that file is in the way (the prefix is the mark). The project tree gets nothing but the
# committed block, which reads the same for every developer, and uninstalling
# one project leaves the pointer, because other projects on the machine use
# it too. Obligations E5-R2-F3, E5-R2-F5, E5-R2-F8 and E5-R3-F2 fell away with
# the code they were about; round 4 confirmed them fixed.
#
# Round 4 left one thread (E5-R2-F4, E5-R3-F1, E5-R4-F1): a one-line absolute
# path is the file's shape, not proof that this script wrote it, so a foreign
# file of that shape would be replaced. Decision: continue patching, once,
# with the smallest change that settles the question rather than a sidecar or
# a versioned format: the line is "clone=<path>", and the prefix is the mark.
# The invariant list is then complete: (1) the project tree carries no machine
# path; (2) the pointer is $HOME/.konductor/fuse-konductor-clone, one line,
# "clone=" followed by an absolute path, newline-terminated; (3) it is written
# before anything in the project changes and by rename; (4) a file of any other
# shape, a symlink, or a .konductor that is not a directory stops the install;
# (5) install from any clone replaces the pointer, and uninstall leaves it.
# That covers E5-R2-F4, E5-R3-F1 and E5-R4-F1.
CLONE_FILE=$HOME/.konductor/fuse-konductor-clone
LINK_HOP_LIMIT=64
NL='
'
CR=$(printf '\r')
OIFS=$IFS

usage_error() {
  printf 'install.sh: %s\n%s\n' "$1" "$USAGE" >&2
  exit 64
}

say() { printf '%s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
refuse() {
  warn "$*"
  FAILED=1
}
fatal() {
  printf 'install.sh: %s\n' "$*" >&2
  exit 1
}

# ── arguments ─────────────────────────────────────────────────────────────────

mode=
project=
files=
uninstall=0
link=0
[ "$#" -gt 0 ] || usage_error "give --project <dir> or --global <file> ..."
while [ "$#" -gt 0 ]; do
  case $1 in
    -h | --help)
      printf '%s\n' "$USAGE"
      exit 0
      ;;
    --uninstall)
      [ "$uninstall" -eq 0 ] || usage_error "--uninstall given twice"
      uninstall=1
      shift
      ;;
    --link)
      [ "$link" -eq 0 ] || usage_error "--link given twice"
      link=1
      shift
      ;;
    --project)
      [ -z "$mode" ] || usage_error "give exactly one of --project or --global"
      mode=project
      shift
      [ "$#" -gt 0 ] || usage_error "--project needs a directory"
      case $1 in '' | -*) usage_error "--project needs a directory" ;; esac
      case $1 in *"$NL"*) usage_error "the project path must not contain a newline" ;; esac
      project=$1
      shift
      ;;
    --global)
      [ -z "$mode" ] || usage_error "give exactly one of --project or --global"
      mode=global
      shift
      while [ "$#" -gt 0 ]; do
        case $1 in
          --*) break ;;
          '') usage_error "--global got an empty file name" ;;
        esac
        case $1 in *"$NL"*) usage_error "file names must not contain a newline" ;; esac
        files=$files$1$NL
        shift
      done
      [ -n "$files" ] || usage_error "--global needs at least one file"
      ;;
    *) usage_error "unknown argument: $1" ;;
  esac
done
[ -n "$mode" ] || usage_error "give --project <dir> or --global <file> ..."
if [ "$link" -eq 1 ]; then
  [ "$mode" = global ] || usage_error "--link works only with --global"
  [ "$uninstall" -eq 0 ] || usage_error "--link cannot be combined with --uninstall"
fi

# ── the clone ─────────────────────────────────────────────────────────────────

case $0 in */*) self_dir=${0%/*} ;; *) self_dir=. ;; esac
REPO=$(cd -P -- "$self_dir" && pwd -P)
SKILLS_SRC=$REPO/skills
FAILED=0

# A skill name is one path component: letters, digits, dots, hyphens and
# underscores, not starting with a dot.
valid_name() {
  case $1 in
    '' | .* | *[!A-Za-z0-9._-]*) return 1 ;;
  esac
  return 0
}

has_line() { # has_line <list> <name>
  case "$NL$1" in *"$NL$2$NL"*) return 0 ;; esac
  return 1
}

# Skill names in this clone: directories under skills/ that hold a SKILL.md.
SKILLS=
if [ -d "$SKILLS_SRC" ]; then
  for d in "$SKILLS_SRC"/*/; do
    [ -f "${d}SKILL.md" ] || continue
    name=${d%/}
    name=${name##*/}
    if ! valid_name "$name"; then
      warn "skills/$name has a name that is not a single safe path component - skipped"
      continue
    fi
    SKILLS=$SKILLS$name$NL
  done
fi

# Temporary files, removed on every exit.
TMPFILES=
# A fallback copy being replaced: while ROLLBACK_BACKUP is set, the old copy
# may sit there. cleanup puts it back if ROLLBACK_DEST is missing, and deletes
# it once ROLLBACK_DEST holds the new copy.
ROLLBACK_DEST=
ROLLBACK_BACKUP=
cleanup() {
  if [ -n "$ROLLBACK_BACKUP" ] && { [ -e "$ROLLBACK_BACKUP" ] || [ -L "$ROLLBACK_BACKUP" ]; }; then
    if [ ! -e "$ROLLBACK_DEST" ] && [ ! -L "$ROLLBACK_DEST" ]; then
      mv -- "$ROLLBACK_BACKUP" "$ROLLBACK_DEST" || :
    else
      rm -rf -- "$ROLLBACK_BACKUP"
    fi
  fi
  [ -z "${INSTALLING:-}" ] || save_progress
  _c=$TMPFILES
  while [ -n "$_c" ]; do
    rm -rf -- "${_c%%"$NL"*}"
    _c=${_c#*"$NL"}
  done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
tmpfile() { # tmpfile <variable> [dir] ; sets <variable> to a new temporary file
  if [ -n "${2:-}" ]; then _t=$(mktemp "$2/.fuse-konductor.XXXXXX"); else _t=$(mktemp); fi
  TMPFILES=$TMPFILES$_t$NL
  eval "$1=\$_t"
}
tmpdir() { # tmpdir <variable> <dir> ; sets <variable> to a new directory in <dir>
  _t=$(mktemp -d "$2/.fuse-konductor.XXXXXX")
  TMPFILES=$TMPFILES$_t$NL
  eval "$1=\$_t"
}

# The block: AGENTS.fuse.md with a guaranteed final newline, validated once
# before any target is touched.
BLOCK=
if [ "$uninstall" -eq 0 ]; then
  # The persistent-memory skill and fuse-flow run on Bun; refuse before any
  # change rather than install skills that cannot run.
  bun --version > /dev/null 2>&1 || fatal "Bun is required but was not found on PATH; install it from https://bun.sh and run again"
  [ -f "$REPO/AGENTS.fuse.md" ] || fatal "$REPO/AGENTS.fuse.md not found"
  # Any line the marker parser reads as a section tag, not only our four: a
  # <NAME> line inside our section would be refused as a nested section on
  # the next run.
  if ! awk '
    { t = $0; sub(/^[ \t\r]+/, "", t); sub(/[ \t\r]+$/, "", t)
      if (t ~ /^<\/?[A-Z][A-Z0-9-]*>$/) bad = 1 }
    END { exit bad }' "$REPO/AGENTS.fuse.md"; then
    fatal "$REPO/AGENTS.fuse.md contains a marker line; remove it and run again"
  fi
  tmpfile BLOCK
  # {{CLONE}} in AGENTS.fuse.md says where the fuse-konductor clone is. A
  # global instruction file belongs to one machine, so it gets this clone's
  # path. A project's AGENTS.md is committed and shared, so it gets a pointer
  # to the per-user file project_install writes (see CLONE_FILE), and stays
  # the same whoever runs the installer. awk reads the replacement from the
  # environment, so backslashes in a path stay literal, and builds each line
  # left to right, so a replacement that itself contains {{CLONE}} is not
  # replaced again.
  if [ "$mode" = project ]; then
    FUSE_CLONE="the path in \`~/.konductor/fuse-konductor-clone\`, whose one line reads \`clone=<path>\`"
  else
    FUSE_CLONE=$REPO
  fi
  FUSE_CLONE=$FUSE_CLONE awk '
    { out = ""; rest = $0
      while ((i = index(rest, "{{CLONE}}")) > 0) {
        out = out substr(rest, 1, i - 1) ENVIRON["FUSE_CLONE"]
        rest = substr(rest, i + 9)
      }
      print out rest }' "$REPO/AGENTS.fuse.md" > "$BLOCK"
  if [ -s "$BLOCK" ] && [ -n "$(tail -c1 "$BLOCK")" ]; then printf '\n' >> "$BLOCK"; fi
fi

# ── paths ─────────────────────────────────────────────────────────────────────

# The target of a symlink, made absolute against the link's own directory.
link_destination() {
  _t=$(readlink -- "$1")
  case $_t in
    /*) printf '%s\n' "$_t" ;;
    *) printf '%s/%s\n' "$(dirname -- "$1")" "$_t" ;;
  esac
}

# Follow a symlink chain to the file it names, so a linked config file is
# edited in place. Fails past the hop limit.
resolve_file() {
  _p=$1
  _hops=0
  while [ -L "$_p" ]; do
    _hops=$((_hops + 1))
    [ "$_hops" -le "$LINK_HOP_LIMIT" ] || return 1
    _p=$(link_destination "$_p")
  done
  printf '%s\n' "$_p"
}

# Remove <dir> and then its parent if they are empty. Never removes $HOME.
prune_dirs() {
  _d=$1
  for _ in 1 2; do
    [ "$_d" != "$HOME" ] && [ "$_d" != / ] || return 0
    rmdir -- "$_d" 2> /dev/null || return 0
    _d=$(dirname -- "$_d")
  done
}

# Put the skill <src> at <dest>, as a symlink to <link-target> when <form> is
# "link", or as a copy when <form> is "copy". A copy gets an ownership mark
# holding <mark>, unless <mark> is empty. An existing entry at <dest> must be
# ours; it is moved
# aside, never deleted, until the new entry is in place, and put back if that
# fails. A link that cannot be created becomes a copy.
place_skill() { # place_skill <src> <dest> <link-target> <mark> <link|copy>
  _pdir=$(dirname -- "$2")
  if [ "$5" = link ]; then
    if [ -L "$2" ] && [ "$(readlink -- "$2")" = "$3" ]; then return 0; fi
    if [ ! -e "$2" ] && [ ! -L "$2" ]; then
      if ln -s -- "$3" "$2" 2> /dev/null; then return 0; fi
    else
      _backup=$(mktemp -d "$_pdir/.fuse-konductor-old.XXXXXX")
      rmdir -- "$_backup"
      ROLLBACK_DEST=$2
      ROLLBACK_BACKUP=$_backup
      mv -- "$2" "$_backup"
      if ln -s -- "$3" "$2" 2> /dev/null; then
        sync
        rm -rf -- "$_backup"
        ROLLBACK_BACKUP=
        return 0
      fi
      mv -- "$_backup" "$2"
      ROLLBACK_BACKUP=
    fi
    warn "could not create a symlink at $2; copying instead (run the script again to update it)"
  fi
  # Copied inside a fresh temporary directory, so the copy gets the source
  # directory's permissions rather than mktemp's.
  tmpdir _box "$_pdir"
  _staged=$_box/skill
  cp -R -- "$1" "$_staged"
  [ -z "$4" ] || printf '%s\n' "$4" > "$_staged/$COPY_MARK"
  sync
  if [ -e "$2" ] || [ -L "$2" ]; then
    _backup=$(mktemp -d "$_pdir/.fuse-konductor-old.XXXXXX")
    rmdir -- "$_backup"
    ROLLBACK_DEST=$2
    ROLLBACK_BACKUP=$_backup
    mv -- "$2" "$_backup"
    if ! mv -- "$_staged" "$2"; then
      mv -- "$_backup" "$2"
      ROLLBACK_BACKUP=
      warn "could not update $2 - left as it was"
      return 0
    fi
    sync
    rm -rf -- "$_backup"
    ROLLBACK_BACKUP=
  else
    mv -- "$_staged" "$2"
    sync
  fi
}

is_marked_copy() { # is_marked_copy <dir> <mark>
  [ -d "$1" ] && [ ! -L "$1" ] && [ -f "$1/$COPY_MARK" ] && [ ! -L "$1/$COPY_MARK" ] || return 1
  _m=$(cat "$1/$COPY_MARK")
  [ "${_m%"$CR"}" = "$2" ]
}

remove_entry() { # remove_entry <path>: a symlink, or a real directory
  if [ -L "$1" ]; then rm -f -- "$1"; elif [ -d "$1" ]; then rm -rf -- "$1"; fi
}

# ── the managed block ─────────────────────────────────────────────────────────

# One awk program for both directions. It validates the markers, then either
# writes the section (upsert) or takes it out (remove). Exit 3 means the file
# was refused; the reason is on stderr. The verdict is the last stderr line.
BLOCK_AWK='
function trim(s) { sub(/^[ \t\r]+/, "", s); sub(/[ \t\r]+$/, "", s); return s }
function refuse(reason) { print "REFUSE " reason > "/dev/stderr"; exit 3 }
function emit(s) { out[++m] = s }
function section() { emit(so); while ((getline l < bf) > 0) emit(l); close(bf); emit(sc) }
{ line[NR] = $0; n = NR }
END {
  gopen = 0; gpairs = 0; gO = 0; gC = 0
  for (i = 1; i <= n; i++) {
    t = trim(line[i])
    if (t == go) {
      if (gopen) refuse(go " opened again before it was closed")
      gopen = i
    } else if (t == gc) {
      if (!gopen) refuse(gc " without a matching " go)
      gpairs++; gO = gopen; gC = i; gopen = 0
      if (gpairs > 1) refuse("more than one " go " block")
    }
  }
  if (gopen) refuse(go " is never closed")

  # Our own section, anywhere in the file: at most one, and inside the wrapper.
  spairs = 0; sO = 0; sC = 0; sopen = 0
  for (i = 1; i <= n; i++) {
    t = trim(line[i])
    if (t == so) {
      if (sopen) refuse(so " opened again before it was closed")
      sopen = i
    } else if (t == sc) {
      if (!sopen) refuse(sc " without a matching " so)
      spairs++; sO = sopen; sC = i; sopen = 0
      if (spairs > 1) refuse("more than one " so " section")
    }
  }
  if (sopen) refuse(so " is never closed")
  if (spairs && (!gpairs || sO < gO || sC > gC)) refuse(so " section outside the " go " wrapper")

  # Every section inside the wrapper, ours or one written by another tool, is
  # a closed pair at the top level.
  cur = ""
  for (i = gO + 1; gpairs && i < gC; i++) {
    t = trim(line[i])
    if (t ~ /^<[A-Z][A-Z0-9-]*>$/) {
      if (cur != "") refuse(t " opened inside " cur)
      cur = t
    } else if (t ~ /^<\/[A-Z][A-Z0-9-]*>$/) {
      if (cur == "") refuse(t " without a matching opening tag")
      if (substr(t, 3) != substr(cur, 2)) refuse(t " closes " cur)
      cur = ""
    }
  }
  if (cur != "") refuse(cur " is never closed inside the " go " wrapper")

  endnl = hadnl
  if (mode == "upsert") {
    if (gpairs) {
      for (i = 1; i <= n; i++) {
        if (sO && i == sO) { section(); i = sC; continue }
        if (!sO && i == gC) section()
        emit(line[i])
      }
      verdict = sO ? "REPLACED" : "INSERTED"
    } else {
      for (i = 1; i <= n; i++) emit(line[i])
      # A separator line when the file ends with a newline (or is empty); a file
      # without a final newline only gets its last line terminated. Uninstall
      # relies on this to restore the file exactly.
      if (n == 0 || hadnl) emit("")
      emit(go); section(); emit(gc)
      endnl = 1
      verdict = "APPENDED"
    }
  } else {
    if (!spairs) { verdict = "ABSENT" }
    else {
      empty = 1
      for (i = gO + 1; i < gC; i++) if (i < sO || i > sC) empty = 0
      for (i = 1; i <= n; i++) {
        if (i >= sO && i <= sC) continue
        if (empty && (i == gO || i == gC)) continue
        if (empty && gO > 1 && i == gO - 1 && trim(line[i]) == "") continue
        emit(line[i])
      }
      if (empty && gC == n && gO > 1 && trim(line[gO - 1]) != "") endnl = 0
      verdict = (empty && gO == 1 && gC == n) ? "DELETE" : "REMOVED"
    }
  }
  for (j = 1; j <= m; j++) printf "%s%s", out[j], (j < m || endnl) ? "\n" : ""
  print verdict > "/dev/stderr"
  exit 0
}
'

# Replace <file> with <content> in one rename, keeping its permissions, unless
# it no longer matches <snapshot>. A new file (empty snapshot argument) is
# created with the default permissions.
commit_file() { # commit_file <file> <content> <snapshot|"">
  _cdir=$(dirname -- "$1")
  tmpfile _new "$_cdir"
  if [ -n "$3" ]; then
    cp -p -- "$1" "$_new"
    cat "$2" > "$_new"
    if ! cmp -s "$3" "$1"; then return 1; fi
  else
    # Recreate the file so it gets the default permissions, not mktemp's.
    rm -f -- "$_new"
    cat "$2" > "$_new"
    if [ -e "$1" ] || [ -L "$1" ]; then return 1; fi
  fi
  # Write the new content to disk before the rename, and the rename after it,
  # so a crash leaves either the old file or the whole new one.
  sync
  mv -f -- "$_new" "$1"
  sync
}

# edit_block <upsert|remove> <file>
edit_block() {
  _mode=$1
  _target=$2
  if ! _file=$(resolve_file "$_target"); then
    refuse "$_target: symlink chain longer than $LINK_HOP_LIMIT links - left untouched"
    return 0
  fi
  case $_file in *"$NL"*)
    refuse "$_target: resolves to a path with a newline - left untouched"
    return 0
    ;;
  esac
  if [ ! -e "$_file" ] && [ ! -L "$_file" ]; then
    [ "$_mode" = upsert ] || return 0
    mkdir -p -- "$(dirname -- "$_file")"
    tmpfile _out
    { printf '%s\n%s\n' "$GEN_OPEN" "$SEC_OPEN"; cat "$BLOCK"; printf '%s\n%s\n' "$SEC_CLOSE" "$GEN_CLOSE"; } > "$_out"
    if commit_file "$_file" "$_out" ""; then
      say "  created $_target with the fuse-konductor block"
    else
      refuse "$_target appeared while the script was writing it - left untouched"
    fi
    return 0
  fi
  if [ ! -f "$_file" ]; then
    refuse "$_target: not a regular file - left untouched"
    return 0
  fi
  tmpfile _snap
  cat "$_file" > "$_snap"
  _hadnl=1
  if [ -s "$_snap" ] && [ -n "$(tail -c1 "$_snap")" ]; then _hadnl=0; fi
  tmpfile _out
  tmpfile _err
  _status=0
  awk -v mode="$_mode" -v go="$GEN_OPEN" -v gc="$GEN_CLOSE" -v so="$SEC_OPEN" -v sc="$SEC_CLOSE" \
    -v bf="${BLOCK:-/dev/null}" -v hadnl="$_hadnl" "$BLOCK_AWK" "$_snap" > "$_out" 2> "$_err" || _status=$?
  _verdict=$(tail -n 1 "$_err")
  if [ "$_status" -eq 3 ]; then
    refuse "$_target: ${_verdict#REFUSE } - left untouched; fix the markers and run again"
    return 0
  elif [ "$_status" -ne 0 ]; then
    refuse "$_target: could not be edited (awk exit $_status) - left untouched"
    return 0
  fi
  case $_verdict in
    ABSENT) return 0 ;;
    DELETE)
      if ! cmp -s "$_snap" "$_file"; then
        refuse "$_target changed while the script was editing it - left untouched"
      elif [ -L "$_target" ]; then
        : > "$_out"
        commit_file "$_file" "$_out" "$_snap" || refuse "$_target changed while the script was editing it - left untouched"
        say "  emptied $_target"
      else
        rm -f -- "$_file"
        say "  removed $_target"
      fi
      return 0
      ;;
  esac
  if cmp -s "$_out" "$_snap"; then
    say "  $_target is up to date"
    return 0
  fi
  if ! commit_file "$_file" "$_out" "$_snap"; then
    refuse "$_target changed while the script was editing it - left untouched"
    return 0
  fi
  case $_verdict in
    APPENDED | INSERTED) say "  added the fuse-konductor block to $_target" ;;
    REPLACED) say "  updated the fuse-konductor block in $_target" ;;
    REMOVED) say "  removed the fuse-konductor block from $_target" ;;
  esac
}

# ── global install ────────────────────────────────────────────────────────────

skills_dir_for() {
  _d=$(dirname -- "$1")
  case ${_d##*/} in steering) _d=$(dirname -- "$_d") ;; esac
  printf '%s/skills\n' "$_d"
}

# Prints the skill name when <entry> in a skills directory is ours: a copy
# marked with this clone, or a symlink to a skill directory of this clone.
our_global_entry() {
  _name=${1##*/}
  valid_name "$_name" || return 1
  if [ -L "$1" ]; then
    [ "$(readlink -- "$1")" = "$SKILLS_SRC/$_name" ] || return 1
  else
    is_marked_copy "$1" "$SKILLS_SRC" || return 1
  fi
  printf '%s\n' "$_name"
}

global_install() {
  _target=$1
  _sd=$(skills_dir_for "$_target")
  say "$_target"
  edit_block upsert "$_target"
  mkdir -p -- "$_sd"
  set -f; IFS=$NL
  for _name in $SKILLS; do
    IFS=$OIFS; set +f
    _src=$SKILLS_SRC/$_name
    _dest=$_sd/$_name
    if [ ! -e "$_dest" ] && [ ! -L "$_dest" ] || our_global_entry "$_dest" > /dev/null; then
      place_skill "$_src" "$_dest" "$_src" "$SKILLS_SRC" "$GLOBAL_FORM"
    else
      warn "$_dest already exists and was not installed by fuse-konductor - skipped"
    fi
  done
  IFS=$OIFS; set +f
  for _entry in "$_sd"/* "$_sd"/.[!.]*; do
    _name=$(our_global_entry "$_entry") || continue
    if ! has_line "$SKILLS" "$_name"; then
      remove_entry "$_entry"
      say "  removed $_entry (skill no longer in the clone)"
    fi
  done
  if [ "$GLOBAL_FORM" = link ]; then say "  skills linked in $_sd"; else say "  skills copied to $_sd"; fi
}

global_uninstall() {
  _target=$1
  _sd=$(skills_dir_for "$_target")
  say "$_target"
  if [ -d "$_sd" ]; then
    for _entry in "$_sd"/* "$_sd"/.[!.]*; do
      our_global_entry "$_entry" > /dev/null || continue
      remove_entry "$_entry"
    done
    say "  removed fuse-konductor skills from $_sd"
    prune_dirs "$_sd"
  fi
  edit_block remove "$_target"
  prune_dirs "$(dirname -- "$_target")"
}

# ── project install ───────────────────────────────────────────────────────────

HARNESS_DIRS='.claude
.kiro
'
PROJECT_MARK=fuse-konductor

# Refuses to go on when a directory on the way to the project's skills, or the
# manifest, is a symlink. Runs before anything changes and before each deletion.
check_project_paths() {
  for _p in "$P/.agents" "$A" "$LIST"; do
    [ ! -L "$_p" ] || fatal "$_p is a symlink; fuse-konductor will not install through it"
  done
}

# A manifest line that records a harness entry: ".claude", ".kiro",
# ".claude/<name>" or ".kiro/<name>".
harness_record() {
  case $1 in
    .claude | .kiro) return 0 ;;
    .claude/* | .kiro/*) valid_name "${1#*/}" ;;
    *) return 1 ;;
  esac
}

# Resolves the project paths and reads the manifest. Refuses, before anything
# changes, a symlinked directory on the way to the skills, or a manifest that
# is a symlink, not a regular file, or holds a line that is neither a skill name
# nor a harness record.
project_paths() {
  [ -d "$project" ] || fatal "$project is not a directory"
  P=$(cd -P -- "$project" && pwd -P)
  case $P in *"$NL"*) fatal "$P contains a newline; fuse-konductor will not install there" ;; esac
  A=$P/.agents/skills
  LIST=$A/.fuse-konductor
  check_project_paths
  if [ -e "$LIST" ] && [ ! -f "$LIST" ]; then fatal "$LIST is not a regular file"; fi
  OLD=
  OLD_LINKS=
  RECORDS=
  [ -f "$LIST" ] || return 0
  while IFS= read -r _line || [ -n "$_line" ]; do
    # A checkout that converts line endings turns the committed manifest into CRLF.
    _line=${_line%"$CR"}
    _hash=
    case $_line in *' '*) _hash=${_line#* }; _line=${_line%% *} ;; esac
    if [ -z "$_hash" ] && harness_record "$_line"; then
      OLD_LINKS=$OLD_LINKS$_line$NL
    elif valid_name "$_line" && case $_hash in *[!0-9]*) false ;; *) true ;; esac; then
      OLD=$OLD$_line$NL
      set_record "$_line" "$_hash"
    else
      fatal "$LIST has a line that is not a skill name: $_line${_hash:+ $_hash}"
    fi
  done < "$LIST"
}

# The manifest records each project skill with a checksum of the copy the
# script last put there, as "<name> <checksum>". A copy whose checksum no
# longer matches was edited in the project, and is kept.

# A checksum of every file, directory and symlink under <dir>: its path, its
# type, whether the owner may execute it, and its content or link target. Only
# the owner's execute bit counts, because a copy made under a umask differs
# from its source in the group and other bits.
skill_hash() {
  (
    cd -- "$1" && find . -print | LC_ALL=C sort |
      while IFS= read -r _f; do
        printf '%s %s\n' "$_f" "$(ls -ld -- "$_f" | cut -c 1,4)"
        if [ -d "$_f" ] && [ ! -L "$_f" ]; then continue; fi
        if [ -L "$_f" ]; then readlink -- "$_f"; else cksum < "$_f"; fi
      done
  ) | cksum | cut -d ' ' -f 1
}

# RECORDS holds the manifest's skill lines, one "<name> <checksum>" per line.
set_record() { # set_record <name> <checksum>
  drop_record "$1"
  RECORDS=$RECORDS$1${2:+ $2}$NL
}
drop_record() { # drop_record <name>
  _kept=
  while [ -n "$RECORDS" ]; do
    _r=${RECORDS%%"$NL"*}
    RECORDS=${RECORDS#*"$NL"}
    [ "${_r%% *}" = "$1" ] || _kept=$_kept$_r$NL
  done
  RECORDS=$_kept
}
recorded_hash() { # recorded_hash <name> ; prints the checksum, if any
  _all=$RECORDS
  while [ -n "$_all" ]; do
    _r=${_all%%"$NL"*}
    _all=${_all#*"$NL"}
    case $_r in "$1 "*) printf '%s\n' "${_r#* }"; return 0 ;; esac
  done
  return 1
}

# Whether the project copy of <name> was edited since the script put it there.
# A record without a checksum cannot tell, so any difference from the clone
# counts as an edit and the copy is kept.
locally_edited() { # locally_edited <name>
  if _rh=$(recorded_hash "$1"); then
    [ "$(skill_hash "$A/$1")" != "$_rh" ]
  else
    [ "$(skill_hash "$A/$1")" != "$(skill_hash "$SKILLS_SRC/$1")" ]
  fi
}

# Deletes the project entry <path> after checking the project paths again.
remove_project_entry() {
  check_project_paths
  remove_entry "$1"
}

# Whether the harness directory <hd> may be used: it must not be a symlink.
harness_usable() {
  if [ -L "$P/$1" ]; then
    warn "$P/$1 is a symlink - skipped"
    return 1
  fi
  return 0
}

# Removes the harness entry <hd>/skills/<name> if it is what this script puts
# there: a link to the project's copy, or a copy with the project mark.
unlink_harness_skill() { # unlink_harness_skill <hd> <name>
  _l=$P/$1/skills/$2
  if [ -L "$_l" ] && [ "$(readlink -- "$_l")" = "../../.agents/skills/$2" ]; then
    rm -f -- "$_l"
  elif is_marked_copy "$_l" "$PROJECT_MARK"; then
    rm -rf -- "$_l"
  fi
}

# Points <hd>/skills at .agents/skills. Prints the manifest records of the
# harness entries this script owns after the run.
link_harness() {
  _hd=$1
  _h=$P/$_hd/skills
  harness_usable "$_hd" || return 0
  if [ -L "$_h" ]; then
    if [ "$(readlink -- "$_h")" != ../.agents/skills ]; then
      warn "$_h is a symlink to somewhere else - skipped"
    elif has_line "$OLD_LINKS" "$_hd"; then
      printf '%s\n' "$_hd"
    fi
    return 0
  fi
  if [ ! -e "$_h" ]; then
    mkdir -p -- "$P/$_hd"
    if ln -s ../.agents/skills "$_h" 2> /dev/null; then
      printf '%s\n' "$_hd"
      return 0
    fi
    mkdir -- "$_h"
  elif [ ! -d "$_h" ]; then
    warn "$_h exists and is not a directory - skipped"
    return 0
  fi
  # A real directory: one entry per skill.
  set -f; IFS=$NL
  for _name in $NEW; do
    IFS=$OIFS; set +f
    _l=$_h/$_name
    _want=../../.agents/skills/$_name
    if has_line "$OLD_LINKS" "$_hd/$_name" && [ -L "$_l" ] && [ "$(readlink -- "$_l")" = "$_want" ]; then
      printf '%s\n' "$_hd/$_name"
    elif has_line "$OLD_LINKS" "$_hd/$_name" && is_marked_copy "$_l" "$PROJECT_MARK"; then
      place_skill "$A/$_name" "$_l" "$_want" "$PROJECT_MARK" link
      printf '%s\n' "$_hd/$_name"
    elif [ -e "$_l" ] || [ -L "$_l" ]; then
      warn "$_l already exists and was not installed by fuse-konductor - skipped"
    else
      place_skill "$A/$_name" "$_l" "$_want" "$PROJECT_MARK" link
      printf '%s\n' "$_hd/$_name"
    fi
  done
  IFS=$OIFS; set +f
  set -f; IFS=$NL
  for _rec in $OLD_LINKS; do
    IFS=$OIFS; set +f
    case $_rec in "$_hd"/*) ;; *) continue ;; esac
    if has_line "$NEW" "${_rec#*/}"; then continue; fi
    unlink_harness_skill "$_hd" "${_rec#*/}"
  done
  IFS=$OIFS; set +f
}

unlink_harness() {
  _hd=$1
  _h=$P/$_hd/skills
  harness_usable "$_hd" || return 0
  if [ -L "$_h" ]; then
    if has_line "$OLD_LINKS" "$_hd" && [ "$(readlink -- "$_h")" = ../.agents/skills ]; then
      rm -f -- "$_h"
    fi
  elif [ -d "$_h" ]; then
    set -f; IFS=$NL
    for _rec in $OLD_LINKS; do
      IFS=$OIFS; set +f
      case $_rec in "$_hd"/*) unlink_harness_skill "$_hd" "${_rec#*/}" ;; esac
    done
    IFS=$OIFS; set +f
    rmdir -- "$_h" 2> /dev/null || :
  fi
  rmdir -- "$P/$_hd" 2> /dev/null || :
}

# Replaces the manifest with the sorted lines of <file>, in one rename, after
# checking the project paths again. An empty list removes the manifest.
write_manifest() { # write_manifest <file>
  tmpfile _record "$A"
  sort -u "$1" > "$_record"
  check_project_paths
  if [ ! -s "$_record" ]; then
    rm -f -- "$LIST"
  elif [ ! -f "$LIST" ] || ! cmp -s "$_record" "$LIST"; then
    chmod 644 "$_record"
    mv -f -- "$_record" "$LIST"
  fi
}

# The skill lines to write if the run stops early: every old record, with the
# skills copied so far, and the one being copied if its copy is in place.
# Written by the exit handler while INSTALLING is set, so a skill that landed
# is never left unrecorded, and a skill that did not land is never claimed.
INSTALLING=
PLACING=
save_progress() {
  [ -n "$INSTALLING" ] || return 0
  INSTALLING=
  if [ -n "$PLACING" ] && [ -d "$A/$PLACING" ] && [ ! -L "$A/$PLACING" ]; then
    set_record "$PLACING" "$(skill_hash "$A/$PLACING")"
  fi
  [ ! -L "$P/.agents" ] && [ ! -L "$A" ] && [ ! -L "$LIST" ] || return 0
  _f=$(mktemp "$A/.fuse-konductor.XXXXXX") || return 0
  printf '%s%s' "$OLD_LINKS" "$RECORDS" | sort -u > "$_f"
  chmod 644 "$_f"
  mv -f -- "$_f" "$LIST" || rm -f -- "$_f"
}

project_install() {
  project_paths
  say "$P"
  # First, so the project is left as it was when the pointer cannot be written.
  write_clone_file
  mkdir -p -- "$A"
  INSTALLING=1
  NEW=
  set -f; IFS=$NL
  for _name in $SKILLS; do
    IFS=$OIFS; set +f
    _src=$SKILLS_SRC/$_name
    _dest=$A/$_name
    if [ ! -e "$_dest" ] && [ ! -L "$_dest" ]; then
      check_project_paths
      PLACING=$_name
      place_skill "$_src" "$_dest" "" "" copy
      set_record "$_name" "$(skill_hash "$_dest")"
      PLACING=
    elif ! has_line "$OLD" "$_name"; then
      warn "$_dest already exists and was not installed by fuse-konductor - skipped"
      continue
    elif [ -d "$_dest" ] && [ ! -L "$_dest" ] && locally_edited "$_name"; then
      warn "$_dest was edited in the project - left as it is; delete it to get the clone's version"
    elif [ -d "$_dest" ] && [ ! -L "$_dest" ] && [ "$(skill_hash "$_dest")" = "$(skill_hash "$_src")" ]; then
      set_record "$_name" "$(skill_hash "$_dest")"
    else
      # Built beside the destination and renamed into place; the old copy is
      # moved aside until the new one is there.
      check_project_paths
      place_skill "$_src" "$_dest" "" "" copy
      set_record "$_name" "$(skill_hash "$_dest")"
    fi
    NEW=$NEW$_name$NL
  done
  IFS=$OIFS; set +f
  set -f; IFS=$NL
  for _name in $OLD; do
    IFS=$OIFS; set +f
    if has_line "$NEW" "$_name"; then continue; fi
    if [ -d "$A/$_name" ] && [ ! -L "$A/$_name" ] && locally_edited "$_name"; then
      warn "$A/$_name was edited in the project - kept, and no longer managed by fuse-konductor"
    else
      remove_project_entry "$A/$_name"
      say "  removed $A/$_name (skill no longer in the clone)"
    fi
    drop_record "$_name"
  done
  IFS=$OIFS; set +f
  say "  skills copied to $A"
  tmpfile _links
  set -f; IFS=$NL
  for _hd in $HARNESS_DIRS; do IFS=$OIFS; set +f; link_harness "$_hd"; done > "$_links"
  IFS=$OIFS; set +f
  tmpfile _final
  { cat "$_links"; printf '%s' "$RECORDS"; } > "$_final"
  write_manifest "$_final"
  INSTALLING=
  say "  .claude/skills and .kiro/skills point at .agents/skills"
  edit_block upsert "$P/AGENTS.md"
}

# Records this clone's path in $HOME/.konductor/fuse-konductor-clone, as one
# line "clone=<path>", for the block in the project's AGENTS.md to point at.
# The "clone=" prefix marks the file as this script's; any other content there
# is someone else's file, and the install stops before the project changes.
write_clone_file() {
  _dir=${CLONE_FILE%/*}
  [ ! -L "$CLONE_FILE" ] || fatal "$CLONE_FILE is a symlink; move it away and run again"
  if [ -e "$_dir" ] && [ ! -d "$_dir" ]; then fatal "$_dir is not a directory; fuse-konductor cannot write $CLONE_FILE"; fi
  if [ -e "$CLONE_FILE" ]; then
    [ -f "$CLONE_FILE" ] && [ "$(wc -l < "$CLONE_FILE")" -le 1 ] &&
      case $(cat "$CLONE_FILE") in clone=/*) true ;; *) false ;; esac ||
      fatal "$CLONE_FILE is not a file fuse-konductor wrote; move it away and run again"
  fi
  mkdir -p -- "$_dir"
  tmpfile _pointer "$_dir"
  printf 'clone=%s\n' "$REPO" > "$_pointer"
  mv -f -- "$_pointer" "$CLONE_FILE"
  say "  $CLONE_FILE names this clone"
}

project_uninstall() {
  project_paths
  say "$P"
  set -f; IFS=$NL
  for _hd in $HARNESS_DIRS; do IFS=$OIFS; set +f; unlink_harness "$_hd"; done
  IFS=$OIFS; set +f
  set -f; IFS=$NL
  for _name in $OLD; do
    IFS=$OIFS; set +f
    if [ -d "$A/$_name" ] && [ ! -L "$A/$_name" ] && locally_edited "$_name"; then
      warn "$A/$_name was edited in the project - kept"
    else
      remove_project_entry "$A/$_name"
    fi
  done
  IFS=$OIFS; set +f
  check_project_paths
  rm -f -- "$LIST"
  say "  removed fuse-konductor skills from $A"
  if rmdir -- "$A" 2> /dev/null; then rmdir -- "$P/.agents" 2> /dev/null || :; fi
  edit_block remove "$P/AGENTS.md"
}

# ── main ──────────────────────────────────────────────────────────────────────

# Skills that cannot be placed are warnings; the refusals that set the exit
# status (an instruction file left untouched) happen in this shell.
if [ "$mode" = project ]; then
  if [ "$uninstall" -eq 1 ]; then project_uninstall; else project_install; fi
else
  GLOBAL_FORM=copy
  [ "$link" -eq 0 ] || GLOBAL_FORM=link
  _all=$files
  while [ -n "$_all" ]; do
    _f=${_all%%"$NL"*}
    _all=${_all#*"$NL"}
    if [ "$uninstall" -eq 1 ]; then global_uninstall "$_f"; else global_install "$_f"; fi
  done
fi

if [ "$FAILED" -ne 0 ]; then
  say "Some targets were left untouched; see the messages above."
  exit 1
fi
if [ "$uninstall" -eq 0 ]; then
  say "Custom Kiro agents load skills and steering only when their resources field lists them."
fi
exit 0
