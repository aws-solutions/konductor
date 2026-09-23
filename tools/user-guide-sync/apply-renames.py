#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Rewrite retired names in the user guide -- Markdown and published HTML alike.

Reads the one authoritative map in ``naming.py`` and applies it, word-boundaried,
to ``docs/user-guide/**/*.md`` and to the page inside each published HTML bundle.
The HTML bundles are patched through ``htmlbundle``, which re-encodes the page
exactly as the original bundler did -- so an unchanged page is byte-identical and
the theme, fonts, colours and diagrams are untouched by construction.

Dry run by default; pass ``--apply`` to write.

    python3 tools/user-guide-sync/apply-renames.py            # preview
    python3 tools/user-guide-sync/apply-renames.py --apply    # write

Exit codes: 0 = done (or nothing to do), 1 = a preserved name would be corrupted,
64 = unexpected repo layout.
"""

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import htmlbundle  # noqa: E402
from naming import PRESERVE, RENAMES  # noqa: E402


def compiled():
    """(pattern, old, new) per rename, word-boundaried on both sides.

    ``[\\w-]`` boundaries stop `asdlc-code-critic` matching inside
    `asdlc-code-critic-v2`, and stop an already-renamed `k-plan` being
    re-prefixed on a second run -- the pass is idempotent.
    """
    return [
        (re.compile(r"(?<![\w-])" + re.escape(old) + r"(?![\w-])"), old, new)
        for old, new in RENAMES
    ]


def guard():
    """Refuse to run if any rename would corrupt a name that must survive."""
    for keep in PRESERVE:
        for pat, old, new in compiled():
            if pat.search(keep):
                print(
                    f"error: rename {old!r} -> {new!r} would corrupt the preserved "
                    f"name {keep!r}. Fix naming.py.",
                    file=sys.stderr,
                )
                return False
    return True


def rewrite(text):
    """Apply every rename to ``text``; return (new_text, {old: count})."""
    counts = {}
    for pat, old, new in compiled():
        text, n = pat.subn(new, text)
        if n:
            counts[old] = counts.get(old, 0) + n
    return text, counts


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo", default=".", type=Path)
    ap.add_argument("--apply", action="store_true", help="write changes (default: preview)")
    args = ap.parse_args()

    repo = args.repo.resolve()
    guide = repo / "docs" / "user-guide"
    if not guide.is_dir():
        print(f"error: no {guide} -- wrong --repo?", file=sys.stderr)
        return 64
    if not guard():
        return 1

    verb = "patched" if args.apply else "would patch"
    totals = {}
    touched = 0

    for md in sorted(guide.rglob("*.md")):
        new, counts = rewrite(md.read_text(encoding="utf-8"))
        if counts:
            touched += 1
            print(f"  {verb}: {md.relative_to(repo)}  ({sum(counts.values())})")
            if args.apply:
                md.write_text(new, encoding="utf-8")
            for k, v in counts.items():
                totals[k] = totals.get(k, 0) + v

    for bundle in htmlbundle.bundles(repo):
        try:
            page = htmlbundle.load(bundle)
        # json.JSONDecodeError too: htmlbundle.load ends in json.loads, so a
        # malformed template block used to abort the whole rename pass mid-run --
        # under --apply, potentially after Markdown files were already written.
        except (htmlbundle.NotABundle, OSError, json.JSONDecodeError) as exc:
            print(f"  skipped: {exc}")
            continue
        new, counts = rewrite(page)
        if counts:
            touched += 1
            print(f"  {verb}: {bundle.relative_to(repo)}  ({sum(counts.values())})")
            if args.apply:
                htmlbundle.save(bundle, new)
            for k, v in counts.items():
                totals[k] = totals.get(k, 0) + v

    if not totals:
        print("No retired names found -- nothing to do.")
        return 0

    print("\nreplacements:")
    for old, new in RENAMES:
        if totals.get(old):
            print(f"  {totals[old]:5d}  {old} -> {new}")
    print(f"\n{sum(totals.values())} replacement(s) across {touched} file(s).")
    if not args.apply:
        print("Preview only. Re-run with --apply to write.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
