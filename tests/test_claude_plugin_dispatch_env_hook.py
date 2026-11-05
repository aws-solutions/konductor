# SPDX-License-Identifier: Apache-2.0
"""Tests for scripts/claude-plugin-dispatch-env-hook.sh, the plugin's
SessionStart hook that copies the dispatch_permission_mode option into the
session environment file.

Run:  cd tests && pytest test_claude_plugin_dispatch_env_hook.py -v
"""

import os
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
HOOK = REPO_ROOT / "scripts" / "claude-plugin-dispatch-env-hook.sh"


def run_hook(env, stdin='{"hook_event_name": "SessionStart"}'):
    base = {"PATH": os.environ.get("PATH", "/usr/bin:/bin")}
    base.update(env)
    return subprocess.run(
        ["bash", str(HOOK)], env=base, input=stdin, capture_output=True, text=True, check=False
    )


@pytest.mark.parametrize("mode", ["interactive", "headless", "bypass"])
def test_valid_option_is_appended_to_the_env_file(tmp_path, mode):
    env_file = tmp_path / "env"
    env_file.write_text("export EXISTING=1\n", encoding="utf-8")
    result = run_hook(
        {"CLAUDE_ENV_FILE": str(env_file), "CLAUDE_PLUGIN_OPTION_DISPATCH_PERMISSION_MODE": mode}
    )
    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""
    assert env_file.read_text(encoding="utf-8") == (
        f"export EXISTING=1\nexport KONDUCTOR_DISPATCH_PERMISSION_MODE={mode}\n"
    )


@pytest.mark.parametrize("value", ["", "yolo", "headless; touch pwned", "Bypass"])
def test_unknown_or_empty_option_writes_nothing(tmp_path, value):
    env_file = tmp_path / "env"
    result = run_hook(
        {"CLAUDE_ENV_FILE": str(env_file), "CLAUDE_PLUGIN_OPTION_DISPATCH_PERMISSION_MODE": value}
    )
    assert result.returncode == 0
    assert result.stdout == ""
    assert not env_file.exists()
    assert not (tmp_path / "pwned").exists()


def test_user_exported_mode_wins(tmp_path):
    env_file = tmp_path / "env"
    result = run_hook(
        {
            "CLAUDE_ENV_FILE": str(env_file),
            "KONDUCTOR_DISPATCH_PERMISSION_MODE": "headless",
            "CLAUDE_PLUGIN_OPTION_DISPATCH_PERMISSION_MODE": "bypass",
        }
    )
    assert result.returncode == 0
    assert not env_file.exists()


def test_no_env_file_is_a_no_op(tmp_path):
    result = run_hook({"CLAUDE_PLUGIN_OPTION_DISPATCH_PERMISSION_MODE": "headless"})
    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""


def test_unwritable_env_file_still_exits_zero_silently(tmp_path):
    env_file = tmp_path / "missing-dir" / "env"
    result = run_hook(
        {"CLAUDE_ENV_FILE": str(env_file), "CLAUDE_PLUGIN_OPTION_DISPATCH_PERMISSION_MODE": "headless"}
    )
    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""
