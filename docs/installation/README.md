# Why fuse-konductor installs with a shell script

konductor installs from a compiled binary. fuse-konductor installs from a shell script that runs
in a clone of the repository. This document explains why, and states when the decision should be
revisited.

## Requirement

The Fuse team works on customer sites. We install fuse-konductor in one of two ways:

1. We install it on customer development machines from the public repository.
2. We help the customer fork the repository, change it to fit their conventions, and install
   their fork.

The second case is common, and it is where most of the value comes from. The customer replaces
our coding standards, review rules and workflow constraints with their own, and their engineers
keep changing them after we leave. Customers also use different harnesses, so the installer must
work for Claude Code, Codex, Cursor, Kiro and others without a separate build per harness.

## Main reason

With a binary installer, a change to a skill reaches the engineer only after the fork publishes
a release. For that, the fork needs:

- a Rust toolchain at the pinned minimum version,
- a continuous integration workflow that the customer maintains,
- a tagged release,
- binaries for every operating system and architecture the engineers use,
- a checksum file next to each binary,
- a bootstrap script that points at the fork instead of our repository.

Most customers will not run this pipeline. If they try and it breaks, we have to fix it during
the engagement, on machines we do not control.

With a clone and a script, a change needs no release. A team can install fuse-konductor in one of
two ways:

- Into a project repository. The skills and the always-on block are committed with the project,
  and the team edits them there like any other project file. Teammates get changes with
  `git pull` on the project.
- Standalone, for one user. The script copies the skills from the fuse-konductor clone into the
  user's harness config. To take a change, the user runs `git pull` in the clone and runs the
  script again. Someone who develops the skills adds `--link`, and the script links the skills
  into the clone instead, so every harness reads the edited file directly.

Improving the command line tool does not fix this. The binary installs content from a published
release, so every change must go through a release. That model fits a product that users do not
modify. fuse-konductor is meant to be modified by the people who install it.

## When to revisit

The decision should change if either of these becomes true:

- Customers use fuse-konductor without changing it, and forks are rare. Then a versioned binary
  with checksums, update and uninstall is the better choice.
- The binary installs from the local working tree instead of from a release. Then the release
  problem goes away, but the binary does little that the script does not.

## What we lose

The command line tool does three things that the script must replace or drop.

- Per-harness synthesis. The tool converted one source into a separate output for each harness.
  fuse-konductor uses only skills and `AGENTS.md`, which every harness reads directly, so this
  step is no longer needed.
- A manifest and a prune step. The tool recorded what it installed, so it could remove files
  later. The script marks what it installed instead: a list file in a project, a small marker
  file in each copied skill in a user's config, or, with `--link`, a link that points into the
  clone. This covers the same cases without a central record.
- A checksummed download. Verifying a binary against a published checksum is a real security
  feature, and we lose it. In its place, the customer clones a public Git repository over an
  authenticated connection and can read the whole script before running it. On customer machines,
  a short script that an engineer can read is often easier to get approved than a downloaded
  binary.

The tool also sent telemetry. We do not want to collect data from customer machines, so dropping
it is an advantage.

## What replaces the tool

One POSIX shell script at the repository root, run from a clone. The script finds the repository
from its own location, so a customer fork installs the fork's content without any edits. It needs
only a shell, Git and coreutils. It does not need Node, a package registry, a downloaded binary or
network access beyond the clone.

The full design, including the files each harness reads and how the always-on block is
installed, is in
[docs/specs/2026-09-27-fuse-konductor-distribution.md](../specs/2026-09-27-fuse-konductor-distribution.md).
