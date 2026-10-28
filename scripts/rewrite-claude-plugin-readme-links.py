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
# `](target)` and `](<target>)` for markdown links and images, and `[label]: target`
# reference definitions.
MD_LINK = re.compile(r"(\]\(<)([^>\n]+)(?=>)|(\]\()([^)<\s]+)|^(\[[^\]\n]+\]:[ \t]*)(\S+)", re.M)
# src, href and srcset attributes of inline HTML, in either quote style.
HTML_ATTR = re.compile(r"""(\b(?:src|href|srcset)=)(["'])(.*?)\2""", re.S)
ABSOLUTE = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|#|/)", re.I)
IMAGE_EXT = (".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp")


def absolute_url(target, tag):
    path = target.split("#", 1)[0]
    if not target or ABSOLUTE.match(target) or path in SHIPPED:
        return target
    if path.lower().endswith(IMAGE_EXT):
        return f"https://raw.githubusercontent.com/{REPO}/{tag}/{target}"
    return f"https://github.com/{REPO}/blob/{tag}/{target}"


def rewrite_srcset(value, tag):
    # Each candidate is "URL [descriptor]", comma-separated.
    candidates = []
    for candidate in value.split(","):
        if not candidate.strip():
            continue
        url, *descriptor = candidate.split()
        candidates.append(" ".join([absolute_url(url, tag), *descriptor]))
    return ", ".join(candidates)


def rewrite(text, tag):
    def replace_md(match):
        groups = [g for g in match.groups() if g is not None]
        prefix, target = groups
        return prefix + absolute_url(target, tag)

    def replace_attr(match):
        name, quote, value = match.groups()
        value = rewrite_srcset(value, tag) if name.startswith("srcset") else absolute_url(value, tag)
        return f"{name}{quote}{value}{quote}"

    return HTML_ATTR.sub(replace_attr, MD_LINK.sub(replace_md, text))


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
