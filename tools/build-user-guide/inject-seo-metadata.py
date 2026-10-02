# SPDX-License-Identifier: Apache-2.0
"""Patch real SEO/social metadata into a published guide bundle's outer shell.

``docs/index.html`` and ``docs/site/user-guide.html`` are single-file bundles
(see ``tools/user-guide-sync/htmlbundle.py``): an outer loader shell that a
crawler actually sees, wrapping the real page as a JSON-encoded string in
``<script type="__bundler/template">``. The outer shell has no title, no
description, no Open Graph or Twitter Card tags, and no source anywhere in
this repo -- it is compiled output from an external bundler, so it is patched
after the fact rather than fixed at a source that does not exist.

This script never touches the ``__bundler/template`` span. It decodes the
inner page with ``htmlbundle.load`` only to lift real title/heading/paragraph
text out of it, then rewrites the outer ``<title>`` and ``<noscript>`` block
with plain string surgery anchored on the span boundaries -- never a full
HTML parse-and-reserialize, which would risk reformatting the bundle's
base64/JSON payload elsewhere in the file.

``og:image`` points at ``docs/social-preview.png``, a static render of the
bundler shell's own loading-screen mark (the SVG in ``#__bundler_thumbnail``,
identical in both bundles). ``twitter:image``, ``twitter:title``, and
``twitter:description`` are all deliberately omitted: Twitter/X falls back
to ``og:image``/``og:title``/``og:description`` when they are absent, so
duplicating that content under the ``twitter:`` prefix adds nothing.

    python3 tools/build-user-guide/inject-seo-metadata.py docs/index.html
    python3 tools/build-user-guide/inject-seo-metadata.py docs/site/user-guide.html

Idempotent: every injected block is wrapped in an
``<!-- seo-metadata:v1 -->`` ... ``<!-- /seo-metadata:v1 -->`` marker pair,
and a block already present is replaced wholesale rather than skipped or
duplicated, so re-running after the source copy changes propagates the
update instead of accumulating stale tags.

Exit codes: 0 = patched, 64 = the file is not a recognized bundle (missing
outer shell markers) -- fail loud rather than silently no-op.
"""

import html
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "user-guide-sync"))
import htmlbundle  # noqa: E402

# https://aws-solutions.github.io/konductor/ serves docs/index.html and
# docs/site/user-guide.html verbatim (deploy-from-branch + docs/.nojekyll, no
# CNAME) -- confirmed against docs/sitemap.xml, which already carries both
# exact URLs below. Keyed by the path's trailing "docs/..." segment rather
# than requiring literal containment under this checkout's repo root, so a
# copy under a different parent directory (e.g. a test fixture) still
# resolves.
_CANONICAL_URLS = {
    "docs/index.html": "https://aws-solutions.github.io/konductor/",
    "docs/site/user-guide.html": "https://aws-solutions.github.io/konductor/site/user-guide.html",
}

# Shared by both bundles -- same site, same logo. Rendered once from the
# bundler shell's own loading-screen SVG (the K mark in #__bundler_thumbnail,
# identical in both files) via @resvg/resvg-js, since neither OG unfurlers
# nor X/Twitter's card renderer support SVG for og:image.
_SOCIAL_IMAGE_URL = "https://aws-solutions.github.io/konductor/social-preview.png"


def _canonical_url(path: Path) -> str | None:
    parts = path.resolve().parts
    for i in range(len(parts)):
        if parts[i] == "docs":
            key = "/".join(parts[i:])
            if key in _CANONICAL_URLS:
                return _CANONICAL_URLS[key]
    return None

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


def _first_real_paragraphs(page: str, limit: int = 2) -> list[str]:
    """The first ``limit`` non-empty ``<p>`` texts, skipping boilerplate.

    "Boilerplate" here means empty after tag-stripping, or made of nothing
    but a shell command / output block that reads as source, not prose --
    those are plentiful in this guide (see the 3,629-char code-block ``<p>``
    in the real bundle) and make poor SEO copy.
    """
    paragraphs = []
    for m in re.finditer(r"<p[^>]*>(.*?)</p>", page, re.DOTALL | re.IGNORECASE):
        text = _clean_text(m.group(1))
        if not text or text.startswith(("git clone", "$", "make ", "cd ")):
            continue
        paragraphs.append(text)
        if len(paragraphs) == limit:
            break
    return paragraphs


def extract_source_material(path) -> dict:
    """Pull real title/h1/intro text out of the bundle's inner page.

    The inner page's ``<title>`` is set client-side by React Helmet and is
    never present in this static dump, so the ``<h1>`` -- real headline
    copy, not a fabrication -- stands in for it.
    """
    page = htmlbundle.load(path)

    h1_match = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.DOTALL | re.IGNORECASE)
    if not h1_match:
        raise NotABundleShell(f"{path}: inner page has no <h1> to source metadata from")
    h1_text = _clean_text(h1_match.group(1))

    title_match = re.search(r"<title[^>]*>(.*?)</title>", page, re.DOTALL | re.IGNORECASE)
    title_text = _clean_text(title_match.group(1)) if title_match else ""

    paragraphs = _first_real_paragraphs(page)

    return {
        "title": title_text or h1_text,
        "h1": h1_text,
        "paragraphs": paragraphs,
    }


def _trim_description(text: str, limit: int = 160) -> str:
    """Trim to an SEO-reasonable length on a word boundary, never mid-word."""
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    if text[len(cut)] != " ":
        cut = cut.rsplit(" ", 1)[0]
    return cut.rstrip(".,;:—- ") + "…"


def build_metadata_block(source: dict, canonical_url: str) -> str:
    """The marker-wrapped ``<title>`` + meta tags this script owns."""
    title = html.escape(source["title"], quote=True)
    description = html.escape(
        _trim_description(" ".join(source["paragraphs"]) or source["h1"]), quote=True
    )
    url = html.escape(canonical_url, quote=True)
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
    """A static fallback with the real h1 + paragraphs, replacing the old
    "requires JavaScript" notice outright rather than showing both."""
    h1 = html.escape(source["h1"])
    paras = "\n".join(f"    <p>{html.escape(p)}</p>" for p in source["paragraphs"])
    return (
        "<noscript>\n"
        f"    {_LOADING_STYLE}\n"
        f"    <h1>{h1}</h1>\n"
        f"{paras}\n"
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
    canonical_url = _canonical_url(path)
    if canonical_url is None:
        raise NotABundleShell(f"{path}: no canonical URL registered for this bundle")

    # Idempotency: drop whatever title currently occupies the slot -- the
    # pristine "Bundled Page" stub on a first run, or this script's own prior
    # marker block (which itself contains a <title>) on a re-run -- before
    # inserting the current one. Anchored on <meta charset>, which neither
    # state ever removes, rather than on <title> text that differs between
    # the two states.
    head = _MARKER_RE.sub("", head)
    head = _OUTER_TITLE_RE.sub("", head, count=1)
    head = _CHARSET_RE.sub(
        lambda m: m.group(0) + "  " + build_metadata_block(source, canonical_url) + "\n",
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
