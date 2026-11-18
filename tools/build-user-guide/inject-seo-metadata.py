# SPDX-License-Identifier: Apache-2.0
"""Patch real SEO/social metadata into a published guide bundle's outer shell.

``docs/index.html`` and ``docs/site/user-guide.html`` are single-file bundles
(see ``tools/user-guide-sync/htmlbundle.py``): an outer loader shell that a
crawler actually sees, wrapping the real page as a JSON-encoded string in
``<script type="__bundler/template">``. The outer shell has no title, no
description, no Open Graph or Twitter Card tags, and no source in this repo.
It is compiled output from an external bundler, so it is patched after the
fact rather than fixed at a source that does not exist.

This script never touches the ``__bundler/template`` span. It decodes the
inner page with ``htmlbundle.load`` only to lift the real h1 and intro
paragraph out of it, then rewrites the outer ``<title>`` and ``<noscript>``
block with plain string surgery anchored on the span boundaries. It never
does a full HTML parse-and-reserialize, which could reformat the bundle's
base64/JSON payload elsewhere in the file.

What it writes into the outer shell:

- ``<title>`` and ``og:title``: ``Konductor: `` + the page's h1.
- ``description`` and ``og:description``: the first intro paragraph, trimmed
  to 160 characters on a word boundary.
- ``og:type``, ``og:url``, and ``<link rel="canonical">``: the site root URL.
  Both bundles carry the same value because ``docs/site/user-guide.html`` is
  the same page as a standalone artifact, not a second indexable page.
- ``og:image``: ``docs/social-preview.png``, a 1200x630 PNG render of the
  loading-screen mark (the SVG in ``#__bundler_thumbnail``).
- ``twitter:card`` set to ``summary_large_image``. The ``twitter:title``,
  ``twitter:description``, and ``twitter:image`` tags are omitted because
  Twitter/X falls back to the ``og:`` equivalents.
- A static ``<noscript>`` fallback with the plain h1 and the intro paragraph.

    python3 tools/build-user-guide/inject-seo-metadata.py docs/index.html
    python3 tools/build-user-guide/inject-seo-metadata.py docs/site/user-guide.html

Idempotent: every injected block is wrapped in an
``<!-- seo-metadata:v1 -->`` ... ``<!-- /seo-metadata:v1 -->`` marker pair,
and a block already present is replaced wholesale rather than skipped or
duplicated, so re-running after the source copy changes propagates the
update instead of accumulating stale tags.

Exit codes: 0 = patched, 64 = the file is not a recognized bundle (missing
outer shell markers). It fails loud rather than silently doing nothing.
"""

import html
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "user-guide-sync"))
import htmlbundle  # noqa: E402

# The published site root. A fork that wants its own URLs edits this one
# constant and rebuilds.
_SITE_URL = "https://aws-solutions.github.io/konductor/"
_SOCIAL_IMAGE_URL = _SITE_URL + "social-preview.png"
_TITLE_PREFIX = "Konductor: "

_MARKER = "seo-metadata:v1"
_MARKER_RE = re.compile(
    r"[ \t]*<!-- " + re.escape(_MARKER) + r" -->.*?<!-- /" + re.escape(_MARKER) + r" -->\n?",
    re.DOTALL,
)

_OUTER_TITLE_RE = re.compile(r"[ \t]*<title>Bundled Page</title>\n?")
_ANY_TITLE_RE = re.compile(r"<title>.*?</title>", re.DOTALL)
_CHARSET_RE = re.compile(r'<meta charset="utf-8">\n?')
_NOSCRIPT_RE = re.compile(r"[ \t]*<noscript>.*?</noscript>\n?", re.DOTALL)
_LOADING_STYLE = '<style>#__bundler_loading { display: none; }</style>'

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


class NotABundleShell(Exception):
    """The file is missing the outer shell markers this script patches."""


def _clean_text(fragment: str) -> str:
    """Strip tags/entities from an inner-page HTML fragment to plain text."""
    text = _TAG_RE.sub(" ", fragment)
    text = html.unescape(text)
    return _WS_RE.sub(" ", text).strip()


def _first_real_paragraph(page: str) -> str:
    """The first non-empty ``<p>`` text that reads as prose, or "" if none.

    Paragraphs that are empty after tag-stripping, or that start like a shell
    command or output block, are skipped: they read as source, not copy.
    """
    for m in re.finditer(r"<p[^>]*>(.*?)</p>", page, re.DOTALL | re.IGNORECASE):
        text = _clean_text(m.group(1))
        if text and not text.startswith(("git clone", "$", "make ", "cd ")):
            return text
    return ""


def extract_source_material(path) -> dict:
    """Pull the real h1 and intro paragraph out of the bundle's inner page.

    The inner page's ``<title>`` is set client-side by React Helmet and is
    never present in this static dump, so the ``<h1>`` stands in for it.
    """
    page = htmlbundle.load(path)

    h1_match = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.DOTALL | re.IGNORECASE)
    if not h1_match:
        raise NotABundleShell(f"{path}: inner page has no <h1> to source metadata from")

    return {
        "h1": _clean_text(h1_match.group(1)),
        "intro": _first_real_paragraph(page),
    }


def _trim_description(text: str, limit: int = 160) -> str:
    """Trim to an SEO-reasonable length on a word boundary, never mid-word."""
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    if text[len(cut)] != " ":
        cut = cut.rsplit(" ", 1)[0]
    return cut.rstrip(".,;:—- ") + "…"


def build_metadata_block(source: dict) -> str:
    """The marker-wrapped ``<title>`` + meta tags this script owns."""
    title = html.escape(_TITLE_PREFIX + source["h1"], quote=True)
    description = html.escape(_trim_description(source["intro"] or source["h1"]), quote=True)
    url = html.escape(_SITE_URL, quote=True)
    image = html.escape(_SOCIAL_IMAGE_URL, quote=True)

    return (
        f"<!-- {_MARKER} -->\n"
        f"  <title>{title}</title>\n"
        f'  <meta name="description" content="{description}">\n'
        f'  <meta property="og:title" content="{title}">\n'
        f'  <meta property="og:description" content="{description}">\n'
        f'  <meta property="og:type" content="website">\n'
        f'  <meta property="og:url" content="{url}">\n'
        f'  <meta property="og:image" content="{image}">\n'
        f'  <meta name="twitter:card" content="summary_large_image">\n'
        f'  <link rel="canonical" href="{url}">\n'
        f"  <!-- /{_MARKER} -->"
    )


def build_noscript_block(source: dict) -> str:
    """A static fallback with the real h1 and intro paragraph, replacing the
    old "requires JavaScript" notice outright rather than showing both."""
    h1 = html.escape(source["h1"])
    intro = f"    <p>{html.escape(source['intro'])}</p>\n" if source["intro"] else ""
    return (
        "<noscript>\n"
        f"    {_LOADING_STYLE}\n"
        f"    <h1>{h1}</h1>\n"
        f"{intro}"
        "  </noscript>\n"
    )


def patch(path) -> None:
    path = Path(path)
    raw = path.read_text(encoding="utf-8")

    template_match = htmlbundle._TEMPLATE_RE.search(raw)
    if not template_match:
        raise NotABundleShell(f"{path}: no __bundler/template block")
    head_region = raw[: template_match.start()]
    if not _CHARSET_RE.search(head_region):
        raise NotABundleShell(f'{path}: no outer <meta charset="utf-8"> before the template span')
    if not _ANY_TITLE_RE.search(head_region):
        raise NotABundleShell(f"{path}: no outer <title> before the template span")
    if not _NOSCRIPT_RE.search(head_region):
        raise NotABundleShell(f"{path}: no outer <noscript> block before the template span")

    # Confine every edit to the slice before the template span. The outer
    # shell is small and comes first in document order in both bundles, so
    # this also guarantees the template span itself is never touched even if
    # a future shell revision moves things around.
    head, rest = raw[: template_match.start()], raw[template_match.start() :]

    source = extract_source_material(path)

    # Idempotency: drop whatever title currently occupies the slot -- the
    # pristine "Bundled Page" stub on a first run, or this script's own prior
    # marker block (which itself contains a <title>) on a re-run -- before
    # inserting the current one. Anchored on <meta charset>, which neither
    # state ever removes, rather than on <title> text that differs between
    # the two states.
    head = _MARKER_RE.sub("", head)
    head = _OUTER_TITLE_RE.sub("", head, count=1)
    head = _CHARSET_RE.sub(
        lambda m: m.group(0) + "  " + build_metadata_block(source) + "\n",
        head,
        count=1,
    )
    head = _NOSCRIPT_RE.sub(build_noscript_block(source), head, count=1)

    path.write_text(head + rest, encoding="utf-8")


def main(argv) -> int:
    if len(argv) != 1:
        print("usage: inject-seo-metadata.py <path-to-bundle.html>", file=sys.stderr)
        return 64

    target = Path(argv[0])
    if not target.is_file():
        print(f"error: {target}: no such file", file=sys.stderr)
        return 64

    try:
        patch(target)
    except (NotABundleShell, htmlbundle.NotABundle) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 64

    print(f"ok: injected SEO metadata into {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
