# SPDX-License-Identifier: Apache-2.0
import importlib.util
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "rewrite-claude-plugin-readme-links.py"

spec = importlib.util.spec_from_file_location("rewrite_readme_links", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

BLOB = "https://github.com/aws-solutions/konductor/blob/v1.2.0/"
RAW = "https://raw.githubusercontent.com/aws-solutions/konductor/v1.2.0/"


def test_relative_doc_link_points_at_the_release_tag():
    out = module.rewrite("[Guide](docs/user-guide/agents.md)", "v1.2.0")
    assert out == f"[Guide]({BLOB}docs/user-guide/agents.md)"


def test_anchor_is_kept():
    out = module.rewrite("[CLI](cli/README.md#getting-started)", "v1.2.0")
    assert out == f"[CLI]({BLOB}cli/README.md#getting-started)"


def test_html_image_uses_raw_url():
    out = module.rewrite('<img src="docs/assets/konductor-logo.svg" />', "v1.2.0")
    assert out == f'<img src="{RAW}docs/assets/konductor-logo.svg" />'


def test_shipped_files_absolute_urls_and_anchors_are_unchanged():
    text = (
        "[License](LICENSE.txt) [Notice](NOTICE.txt) [Site](https://example.com/x.md) "
        "[Top](#quick-start) [Mail](mailto:a@example.com)"
    )
    assert module.rewrite(text, "v1.2.0") == text


def test_cli_rewrites_file_in_place(tmp_path):
    readme = tmp_path / "README.md"
    readme.write_text("[Contributing](CONTRIBUTING.md)\n", encoding="utf-8")
    version = tmp_path / "VERSION"
    version.write_text("1.2.0\n", encoding="utf-8")
    subprocess.run(
        [sys.executable, str(SCRIPT), "--readme", str(readme), "--version-file", str(version)],
        check=True,
    )
    assert readme.read_text(encoding="utf-8") == f"[Contributing]({BLOB}CONTRIBUTING.md)\n"


def test_html_href_and_reference_definitions_are_rewritten():
    text = '<a href="CONTRIBUTING.md">c</a>\n[guide]: docs/user-guide/agents.md\n[home]: https://example.com\n'
    out = module.rewrite(text, "v1.2.0")
    assert f'href="{BLOB}CONTRIBUTING.md"' in out
    assert f"[guide]: {BLOB}docs/user-guide/agents.md" in out
    assert "[home]: https://example.com" in out
