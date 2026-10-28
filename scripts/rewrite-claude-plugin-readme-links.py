#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Rewrite the plugin README's repo-relative links to absolute URLs at the
release tag, since the plugin tree ships only a few of the files they point to.

Links to files the plugin ships (LICENSE.txt, NOTICE.txt) stay relative.

Usage: rewrite-claude-plugin-readme-links.py --readme FILE --version-file FILE
"""

import argparse
import re
from pathlib import Path

REPO = "aws-solutions/konductor"
SHIPPED = {"LICENSE.txt", "NOTICE.txt"}
# `](target)` for markdown links and images, `src="..."`/`href="..."` for inline
# HTML, and `[label]: target` reference definitions.
LINK = re.compile(r'(\]\(|src="|href="|^\[[^\]\n]+\]:[ \t]*)([^)"\s]+)', re.M)
ABSOLUTE = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|#|/)", re.I)
IMAGE_EXT = (".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp")


def rewrite(text, tag):
    def replace(match):
        prefix, target = match.groups()
        path = target.split("#", 1)[0]
        if ABSOLUTE.match(target) or path in SHIPPED:
            return match.group(0)
        if path.lower().endswith(IMAGE_EXT):
            url = f"https://raw.githubusercontent.com/{REPO}/{tag}/{target}"
        else:
            url = f"https://github.com/{REPO}/blob/{tag}/{target}"
        return prefix + url

    return LINK.sub(replace, text)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--readme", type=Path, required=True)
    parser.add_argument("--version-file", type=Path, required=True)
    args = parser.parse_args()

    tag = "v" + args.version_file.read_text(encoding="utf-8").strip()
    readme = args.readme.read_text(encoding="utf-8")
    args.readme.write_text(rewrite(readme, tag), encoding="utf-8")


if __name__ == "__main__":
    main()
