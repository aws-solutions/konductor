# SPDX-License-Identifier: Apache-2.0
"""Read and write the readable page inside a published user-guide HTML bundle.

``docs/site/user-guide.html`` and ``docs/index.html`` are single-file bundles: an
outer loader, a manifest of gzipped JavaScript and woff2 font blobs, and the
actual page as a JSON-encoded string in::

    <script type="__bundler/template">"<!DOCTYPE html>..."</script>

Only that string carries prose. Everything else is fonts, the runtime, and React
-- which is why a content update never has to touch the design: patch the
template, leave the blobs alone, and the theme, fonts, colours, spacing and
diagrams come through byte-identical.

``load`` returns the decoded page; ``save`` re-encodes it in place.
``dc_script`` pulls the page's inline application script back out, and
``compile_dc_script`` asks Node whether that script actually parses.
"""

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

_TEMPLATE_RE = re.compile(
    r'(<script type="__bundler/template">)(.*?)(</script>)', re.DOTALL
)

_DC_SCRIPT_RE = re.compile(
    r'<script type="text/x-dc" data-dc-script="">(.*?)</script>', re.DOTALL
)


class NotABundle(Exception):
    """The file has no __bundler/template block."""


class NoDcScript(Exception):
    """The decoded page has no data-dc-script block."""


def load(path) -> str:
    """Return the decoded page HTML from a bundle."""
    m = _TEMPLATE_RE.search(Path(path).read_text(encoding="utf-8", errors="replace"))
    if not m:
        raise NotABundle(f"{path}: no __bundler/template block")
    return json.loads(m.group(2))


def save(path, page: str) -> None:
    """Write ``page`` back into the bundle at ``path``, leaving all blobs alone."""
    path = Path(path)
    raw = path.read_text(encoding="utf-8", errors="replace")
    m = _TEMPLATE_RE.search(raw)
    if not m:
        raise NotABundle(f"{path}: no __bundler/template block")

    # Match the original bundler byte-for-byte so an unchanged page re-encodes
    # identically and the diff shows only real edits:
    #   * ensure_ascii=False -- non-ASCII stays raw UTF-8, not \uXXXX
    #   * every closing tag's slash escaped, so no markup inside the string can
    #     terminate the <script> element early
    encoded = json.dumps(page, ensure_ascii=False).replace("</", "<\\u002F")

    # Preserve whatever whitespace surrounded the original JSON literal.
    body = m.group(2)
    lead = body[: len(body) - len(body.lstrip())]
    trail = body[len(body.rstrip()) :]

    path.write_text(
        raw[: m.start(2)] + lead + encoded + trail + raw[m.end(2) :],
        encoding="utf-8",
    )


def dc_script(page: str) -> str:
    """Return the page's inline ``data-dc-script`` JavaScript.

    The page is one big JSON-encoded string, so the script inside it cannot be
    checked against the bundle file directly -- every quote in it is escaped at
    that level. Decode the page first (``load``), then pull the block out here.
    """
    m = _DC_SCRIPT_RE.search(page)
    if not m:
        raise NoDcScript("no <script type=\"text/x-dc\" data-dc-script=\"\"> block")
    return m.group(1)


def compile_dc_script(page: str):
    """Return ``(ok, detail)`` for whether the page's dc script parses as JS.

    ``dc-runtime`` boots the page by handing this block to ``new Function()``, so
    a single unescaped ``"`` spliced in from prose closes a string literal early
    and takes the whole page down -- blank render, nothing but a SyntaxError in
    the console. Content checks cannot see that; only a parse can.

    ``node --check`` is the closest available stand-in for that ``new Function()``
    call. Node not being installed is reported as a failure rather than skipped:
    a gate that quietly passes when its checker is missing is how this class
    shipped in the first place.
    """
    node = shutil.which("node")
    if not node:
        return False, "node is not on PATH, so the bundle's JavaScript could not be parsed"

    try:
        script = dc_script(page)
    except NoDcScript as exc:
        return False, str(exc)

    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as fh:
        fh.write(script)
        tmp = fh.name
    try:
        proc = subprocess.run(
            [node, "--check", tmp], capture_output=True, text=True, check=False
        )
    finally:
        Path(tmp).unlink(missing_ok=True)

    if proc.returncode == 0:
        return True, f"{len(script):,} characters of JavaScript parse"
    detail = next(
        (ln.strip() for ln in proc.stderr.splitlines() if "Error" in ln),
        proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else "node --check failed",
    )
    return False, detail


def bundles(repo: Path):
    """Every published guide bundle that exists, newest surface first."""
    return [
        p
        for p in (repo / "docs" / "site" / "user-guide.html", repo / "docs" / "index.html")
        if p.exists()
    ]
