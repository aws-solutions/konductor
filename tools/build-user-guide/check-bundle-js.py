#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Fail if a published guide bundle's inline JavaScript does not parse.

The bundle boots by handing its ``data-dc-script`` block to ``new Function()``.
A stray unescaped ``"`` spliced in from prose closes a string literal early, the
eval aborts, and the page renders blank -- while every content-level check still
passes, because the characters are all present and correct.

    python3 tools/build-user-guide/check-bundle-js.py docs/site/user-guide.html

With no arguments, checks every bundle under ``docs/``. Exit codes: 0 = parses,
1 = does not parse (or Node is unavailable), 64 = the file is not a bundle.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "user-guide-sync"))
import htmlbundle  # noqa: E402


def main(argv) -> int:
    repo = Path(__file__).resolve().parents[2]
    targets = [Path(a) for a in argv] or htmlbundle.bundles(repo)
    if not targets:
        print("error: no published guide bundle found under docs/", file=sys.stderr)
        return 64

    failed = False
    for path in targets:
        try:
            page = htmlbundle.load(path)
        # json.JSONDecodeError too: htmlbundle.load ends in json.loads, so a
        # malformed template block raised straight through as a traceback instead
        # of this command's own exit 64.
        except (htmlbundle.NotABundle, OSError, json.JSONDecodeError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 64
        ok, detail = htmlbundle.compile_dc_script(page)
        print(f"{'ok  ' if ok else 'FAIL'}  {path}: {detail}", file=sys.stderr if not ok else sys.stdout)
        failed |= not ok

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
