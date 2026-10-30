# SPDX-License-Identifier: Apache-2.0
"""Static skill quality gate over skills/*/SKILL.md, plus fixture tests pinning each rule.

The rules and the shrink-only baseline live in tests/skill_quality.py.
Run:  make test-py   (or: uvx --with pyyaml pytest -q tests/test_skill_quality.py)
"""
import copy
import importlib.util
import json
import subprocess
import sys
import warnings
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "skill_quality", Path(__file__).resolve().parent / "skill_quality.py"
)
sq = importlib.util.module_from_spec(_SPEC)
sys.modules["skill_quality"] = sq
_SPEC.loader.exec_module(sq)

try:
    BASELINE = sq.load_baseline()
    BASELINE_ERROR = None
except sq.BaselineError as error:
    BASELINE = None
    BASELINE_ERROR = str(error)

CORPUS = sq.skill_dirs(sq.SKILLS_DIR) if sq.SKILLS_DIR.is_dir() else []
GOOD_DESCRIPTION = "Use when designing a widget so the agent follows the widget rules in this repository."


def _errors(findings):
    return [f for f in findings if f.severity == "error"]


def _assert_clean(findings):
    errors = _errors(findings)
    assert not errors, "\n".join(f"{f.skill} [{f.rule}] {f.message}" for f in errors)


# ── Corpus ───────────────────────────────────────────────────────────────────


def test_skills_dir_exists():
    assert sq.SKILLS_DIR.is_dir(), f"skills/ not found at {sq.SKILLS_DIR}"


def test_baseline_is_well_formed():
    assert BASELINE_ERROR is None, f"baseline malformed: {BASELINE_ERROR}"


def test_baseline_is_canonically_formatted():
    if BASELINE is None:
        pytest.skip("baseline malformed")
    committed = sq.BASELINE_PATH.read_text(encoding="utf-8")
    assert committed == sq.render_baseline(BASELINE), (
        "tests/skill-quality-baseline.json is not in canonical form; "
        "regenerate with: python3 tests/skill_quality.py --print-baseline"
    )


def test_baseline_names_only_existing_skills():
    if BASELINE is None:
        pytest.skip("baseline malformed")
    missing = sq.missing_baseline_skills(BASELINE, sq.SKILLS_DIR)
    assert not missing, f"baseline names a missing skill: {missing}"


@pytest.mark.parametrize("skill_dir", CORPUS, ids=lambda p: p.name)
def test_skill_content(skill_dir):
    report = sq.check_skill_content(skill_dir)
    for finding in report.findings:
        if finding.severity == "warning":
            warnings.warn(f"{finding.skill} [{finding.rule}] {finding.message}")
    _assert_clean(report.findings)


@pytest.mark.parametrize("skill_dir", CORPUS, ids=lambda p: p.name)
def test_skill_size_within_baseline(skill_dir):
    if BASELINE is None:
        pytest.skip("baseline malformed")
    report = sq.check_skill_content(skill_dir)
    if report.metrics is None:
        pytest.skip("SKILL.md did not parse; see test_skill_content")
    _assert_clean(sq.check_sizes(skill_dir.name, report.metrics, BASELINE))


# ── Fixtures ─────────────────────────────────────────────────────────────────


def _skill(tmp_path, name="widget", description=GOOD_DESCRIPTION, body="# Widget\n", frontmatter_name=None):
    skill_dir = tmp_path / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    text = f"---\nname: {frontmatter_name or name}\ndescription: {description}\n---\n{body}"
    (skill_dir / "SKILL.md").write_text(text, encoding="utf-8")
    return skill_dir


def _reference(skill_dir, name="guide.md", content="# Guide\n"):
    references = skill_dir / "references"
    references.mkdir(exist_ok=True)
    (references / name).write_text(content, encoding="utf-8")


def _rules(skill_dir):
    return {f.rule for f in _errors(sq.check_skill_content(skill_dir).findings)}


def _messages(skill_dir):
    return " | ".join(f.message for f in _errors(sq.check_skill_content(skill_dir).findings))


def _baseline(skills=None, thresholds=None, tolerance=None):
    return {
        "_comment": "fixture",
        "skills": skills or {},
        "thresholds": thresholds or {"bytes": 1000, "description_chars": 512, "lines": 100},
        "tolerance": tolerance or {"bytes": 100, "description_chars": 50, "lines": 50},
    }


def _size_messages(metrics, baseline, skill="widget"):
    full = {"bytes": 10, "description_chars": 80, "lines": 10}
    full.update(metrics)
    return " | ".join(f.message for f in sq.check_sizes(skill, full, baseline))


def test_clean_fixture_passes(tmp_path):
    assert _rules(_skill(tmp_path)) == set()


def test_name_mismatch_fails(tmp_path):
    assert "name" in _rules(_skill(tmp_path, frontmatter_name="gadget"))


@pytest.mark.parametrize(
    "description",
    ["Use when short.", "Use when x " + "y" * 60],
    ids=["too-short", "too-few-words"],
)
def test_description_minimums_fail(tmp_path, description):
    assert "description" in _rules(_skill(tmp_path, description=description))


def test_description_over_max_fails_without_entry():
    assert "not in baseline" in _size_messages({"description_chars": 600}, _baseline())


def test_description_without_activation_condition_fails(tmp_path):
    skill = _skill(tmp_path, description="DynamoDB skill covering tables, keys, indexes and capacity planning.")
    assert "activation" in _rules(skill)


@pytest.mark.parametrize(
    "description",
    [
        "Reference to use for DynamoDB tables, keys and indexes in general.",
        "DynamoDB patterns, and what to do if you are unsure about keys.",
    ],
    ids=["verb-mid-clause", "bare-if"],
)
def test_loose_activation_wording_fails(tmp_path, description):
    assert "activation" in _rules(_skill(tmp_path, description=description))


def test_read_verb_is_not_a_trigger(tmp_path):
    skill = _skill(tmp_path, description="Notes on how to read DynamoDB tables to plan capacity units.")
    findings = sq.check_skill_content(skill).findings
    assert [f.rule for f in _errors(findings)] == ["activation"]


def test_trigger_verb_after_a_sentence_passes(tmp_path):
    skill = _skill(tmp_path, description="Widget estimates for agent teams. Use to re-baseline a widget plan here.")
    assert _rules(skill) == set()


def test_stoplist_first_word_is_not_a_behavior_summary(tmp_path):
    skill = _skill(tmp_path, description="This skill covers DynamoDB tables, keys, indexes and capacity planning.")
    assert "activation" in _rules(skill)


def test_verb_proxy_only_warns_and_passes(tmp_path):
    skill = _skill(tmp_path, description="Validates DynamoDB tables, keys, indexes and capacity planning choices.")
    findings = sq.check_skill_content(skill).findings
    assert not _errors(findings)
    assert [f.rule for f in findings if f.severity == "warning"] == ["activation"]


def test_scope_clause_passes(tmp_path):
    skill = _skill(tmp_path, description="Loaded only in Claude Code sessions to set teammate behavior rules for agents.")
    assert _rules(skill) == set()


def test_folded_description_parses(tmp_path):
    skill = _skill(tmp_path, description=">-\n  Use when designing a widget so the agent\n  follows the widget rules here.")
    report = sq.check_skill_content(skill)
    assert not _errors(report.findings)
    assert report.metrics["description_chars"] == len(
        "Use when designing a widget so the agent follows the widget rules here."
    )


def test_quoted_description_with_colon_parses(tmp_path):
    skill = _skill(tmp_path, description='"Use when: designing a widget so the agent follows the widget rules."')
    assert _rules(skill) == set()


def test_crlf_fails(tmp_path):
    skill = _skill(tmp_path)
    path = skill / "SKILL.md"
    path.write_bytes(path.read_bytes().replace(b"\n", b"\r\n"))
    assert "encoding" in _rules(skill)


def test_non_utf8_fails(tmp_path):
    skill = _skill(tmp_path)
    (skill / "SKILL.md").write_bytes(b"---\nname: widget\n\xff\n---\n")
    assert "encoding" in _rules(skill)


def test_missing_frontmatter_fails(tmp_path):
    skill = tmp_path / "widget"
    skill.mkdir()
    (skill / "SKILL.md").write_text("# Widget\n", encoding="utf-8")
    assert "frontmatter" in _rules(skill)


@pytest.mark.parametrize("text,expected", [("a\nb", 1), ("a\x0cb\n", 1), ("a\nb\n", 2)])
def test_line_count_matches_wc_l(text, expected):
    assert sq.count_lines(text) == expected


# Size ratchet: threshold 100 lines, tolerance 50.


def test_over_threshold_without_entry_fails():
    assert "not in baseline" in _size_messages({"lines": 101}, _baseline())


def test_entry_equal_to_measured_passes():
    assert _size_messages({"lines": 300}, _baseline({"widget": {"lines": 300}})) == ""


def test_shrink_within_tolerance_passes():
    assert _size_messages({"lines": 260}, _baseline({"widget": {"lines": 300}})) == ""


def test_growth_past_entry_fails():
    assert "grew past" in _size_messages({"lines": 301}, _baseline({"widget": {"lines": 300}}))


def test_shrink_past_tolerance_asks_to_lower():
    assert "lower to 250" in _size_messages({"lines": 250}, _baseline({"widget": {"lines": 300}}))


def test_under_threshold_with_entry_asks_to_delete():
    assert "delete the entry" in _size_messages({"lines": 90}, _baseline({"widget": {"lines": 300}}))


def test_delete_beats_within_tolerance():
    assert "delete the entry" in _size_messages({"lines": 95}, _baseline({"widget": {"lines": 110}}))


# Links and bare paths.


def test_relative_link_to_missing_file_fails(tmp_path):
    assert "link" in _rules(_skill(tmp_path, body="See [notes](notes.md).\n"))


def test_relative_link_to_existing_file_passes(tmp_path):
    skill = _skill(tmp_path, body="See [notes](notes.md#top).\n")
    (skill / "notes.md").write_text("x\n", encoding="utf-8")
    assert _rules(skill) == set()


@pytest.mark.parametrize("link", ['[n](notes.md "Notes")', "[n](<notes.md>)"], ids=["title", "angle"])
def test_link_title_and_angle_brackets_resolve_to_path(tmp_path, link):
    skill = _skill(tmp_path, body=f"See {link}.\n")
    (skill / "notes.md").write_text("x\n", encoding="utf-8")
    assert _rules(skill) == set()


def test_link_escaping_skill_dir_fails(tmp_path):
    (tmp_path / "outside.md").write_text("x\n", encoding="utf-8")
    assert "escapes" in _messages(_skill(tmp_path, body="See [o](../outside.md).\n"))


def test_symlinked_link_target_fails(tmp_path):
    skill = _skill(tmp_path, body="See [n](notes.md).\n")
    (tmp_path / "real.md").write_text("x\n", encoding="utf-8")
    (skill / "notes.md").symlink_to(tmp_path / "real.md")
    assert "link" in _rules(skill)


def test_url_and_anchor_links_skipped(tmp_path):
    assert _rules(_skill(tmp_path, body="[a](https://example.com/x) [b](#usage)\n")) == set()


@pytest.mark.parametrize("body", ["Run `[n](missing.md)` literally.\n", "Run ``a ` [n](missing.md)`` now.\n"])
def test_link_inside_inline_code_ignored(tmp_path, body):
    assert _rules(_skill(tmp_path, body=body)) == set()


def test_reference_definition_to_missing_file_fails(tmp_path):
    assert "link" in _rules(_skill(tmp_path, body="See [n].\n\n[n]: missing.md\n"))


def test_reference_definition_to_existing_file_passes(tmp_path):
    skill = _skill(tmp_path, body="See [n].\n\n[n]: <notes.md> \"Notes\"\n")
    (skill / "notes.md").write_text("x\n", encoding="utf-8")
    assert _rules(skill) == set()


def test_link_target_with_parentheses_is_read_whole(tmp_path):
    skill = _skill(tmp_path, body="See [n](notes(1).md).\n")
    assert "'notes(1).md'" in _messages(skill)
    (skill / "notes(1).md").write_text("x\n", encoding="utf-8")
    assert _rules(skill) == set()


def test_link_inside_fence_ignored(tmp_path):
    assert _rules(_skill(tmp_path, body="```markdown\n[n](missing.md)\n```\n")) == set()


def test_link_inside_longer_tilde_fence_ignored(tmp_path):
    body = "~~~~\n```\n[n](missing.md)\n~~~\n~~~~\n"
    assert _rules(_skill(tmp_path, body=body)) == set()


def test_link_inside_list_nested_fence_ignored(tmp_path):
    body = "1. Step\n\n    ```bash\n    echo [n](missing.md)\n    ```\n\nafter\n"
    assert _rules(_skill(tmp_path, body=body)) == set()


def test_fence_closer_indented_past_the_opener_does_not_close(tmp_path):
    body = "```bash\necho hi\n    ```\n"
    assert "fence" in _rules(_skill(tmp_path, body=body))


def test_unclosed_fence_fails_closed(tmp_path):
    body = "Intro.\n\n```bash\necho hi\n\nSee [n](missing.md).\n"
    skill = _skill(tmp_path, body=body)
    assert "fence" in _rules(skill)
    assert "line 7: code fence opened here is never closed" in _messages(skill)


def test_bare_reference_path_without_directory_ignored(tmp_path):
    body = "Its `references/architecture.md` file explains it.\n"
    assert _rules(_skill(tmp_path, body=body)) == set()


def test_bare_path_to_missing_file_under_existing_dir_fails(tmp_path):
    skill = _skill(tmp_path, body="Run `scripts/missing.sh` first.\n")
    (skill / "scripts").mkdir()
    assert "path" in _rules(skill)


# references/ shape, orphans, and read cues.


def test_orphan_reference_fails(tmp_path):
    skill = _skill(tmp_path)
    _reference(skill)
    assert "orphan" in _messages(skill)


def test_reference_without_cue_fails(tmp_path):
    skill = _skill(tmp_path, body="The file `references/guide.md` exists.\n")
    _reference(skill)
    assert "no read cue" in _messages(skill)


def test_one_cued_line_and_one_uncued_mention_passes(tmp_path):
    body = "Read `references/guide.md` when scoring.\n\nAlso see `references/guide.md`.\n"
    skill = _skill(tmp_path, body=body)
    _reference(skill)
    assert _rules(skill) == set()


def test_reference_mentioned_only_in_fence_fails_cue_not_orphan(tmp_path):
    skill = _skill(tmp_path, body="```\nRead references/guide.md when scoring.\n```\n")
    _reference(skill)
    messages = _messages(skill)
    assert "no read cue" in messages and "orphan" not in messages


@pytest.mark.parametrize(
    "line",
    ["Read `references/guide.md` before Stage 3.", "Open `references/guide.md` and apply it when scoring."],
    ids=["read-before", "open-when"],
)
def test_cue_forms_pass(tmp_path, line):
    skill = _skill(tmp_path, body=f"{line}\n")
    _reference(skill)
    assert _rules(skill) == set()


def test_see_for_details_is_not_a_cue(tmp_path):
    skill = _skill(tmp_path, body="See `references/guide.md` for details.\n")
    _reference(skill)
    assert "no read cue" in _messages(skill)


def test_reference_subdirectory_fails(tmp_path):
    skill = _skill(tmp_path)
    (skill / "references" / "sub").mkdir(parents=True)
    assert "subdirectory" in _messages(skill)


@pytest.mark.parametrize("name,expected", [("notes.txt", "not Markdown"), ("SKILL.md", "second skill")])
def test_reference_bad_file_names_fail(tmp_path, name, expected):
    skill = _skill(tmp_path, body=f"Read `references/{name}` when needed.\n")
    _reference(skill, name=name)
    assert expected in _messages(skill)


# Baseline file and ratchet.


def test_malformed_baseline_raises_one_error():
    with pytest.raises(sq.BaselineError):
        sq.validate_baseline({"skills": {}})


def test_baseline_entry_under_threshold_is_malformed():
    with pytest.raises(sq.BaselineError, match="under threshold"):
        sq.validate_baseline(_baseline({"widget": {"lines": 90}}))


def test_baseline_comment_content_is_not_checked():
    sq.validate_baseline(_baseline({"widget": {"lines": 300}}))


def test_missing_baseline_skill_is_reported(tmp_path):
    _skill(tmp_path)
    baseline = _baseline({"widget": {"lines": 300}, "gone": {"lines": 300}})
    assert sq.missing_baseline_skills(baseline, tmp_path) == ["gone"]


def test_print_baseline_round_trips():
    result = subprocess.run(
        [sys.executable, str(Path(sq.__file__)), "--print-baseline"],
        capture_output=True,
        text=True,
        check=True,
    )
    parsed = json.loads(result.stdout)
    assert sq.render_baseline(parsed) == result.stdout
    assert parsed["_comment"] == sq.BASELINE_COMMENT


def _grown_tree(tmp_path, monkeypatch):
    """A tree whose 'big' skill is over the committed ceiling of 110 lines."""
    skills = tmp_path / "skills"
    _skill(skills, name="big", body="x\n" * 120)
    baseline_path = tmp_path / "baseline.json"
    baseline_path.write_text(sq.render_baseline(_baseline({"big": {"lines": 110}})), encoding="utf-8")
    monkeypatch.setattr(sq, "SKILLS_DIR", skills)
    monkeypatch.setattr(sq, "BASELINE_PATH", baseline_path)
    return baseline_path


def test_print_baseline_refuses_growth(tmp_path, monkeypatch, capsys):
    _grown_tree(tmp_path, monkeypatch)
    assert sq.main(["--print-baseline"]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "skills.big.lines raised from 110 to 124" in captured.err


def test_print_baseline_allow_growth_prints(tmp_path, monkeypatch, capsys):
    _grown_tree(tmp_path, monkeypatch)
    assert sq.main(["--print-baseline", "--allow-growth"]) == 0
    assert json.loads(capsys.readouterr().out)["skills"] == {"big": {"lines": 124}}


def test_print_baseline_refuses_a_truncated_baseline(tmp_path, monkeypatch, capsys):
    _grown_tree(tmp_path, monkeypatch).write_text("", encoding="utf-8")
    assert sq.main(["--print-baseline"]) == 1
    assert "temp file" in capsys.readouterr().err


def test_print_baseline_allow_growth_refuses_a_truncated_baseline(tmp_path, monkeypatch, capsys):
    _grown_tree(tmp_path, monkeypatch).write_text("", encoding="utf-8")
    assert sq.main(["--print-baseline", "--allow-growth"]) == 1
    captured = capsys.readouterr()
    assert "temp file" in captured.err
    assert captured.out == ""


def test_build_baseline_records_exact_over_threshold_values(tmp_path):
    _skill(tmp_path, name="big", body="x\n" * 120)
    _skill(tmp_path, name="small")
    built = sq.build_baseline(tmp_path, _baseline()["thresholds"], _baseline()["tolerance"])
    assert built["skills"] == {"big": {"lines": 124}}


def _ratchet(old_skills, new_skills, new_thresholds=None, new_tolerance=None):
    old = _baseline(old_skills)
    new = _baseline(copy.deepcopy(new_skills), new_thresholds, new_tolerance)
    return sq.check_ratchet(old, new)


def test_ratchet_rejects_raised_entry():
    assert _ratchet({"widget": {"lines": 300}}, {"widget": {"lines": 301}})


def test_ratchet_rejects_added_entry():
    assert _ratchet({}, {"widget": {"lines": 300}})


def test_ratchet_accepts_lowered_and_deleted_entries():
    old = {"widget": {"lines": 300, "bytes": 2000}, "gadget": {"lines": 200}}
    assert _ratchet(old, {"widget": {"lines": 250}}) == []


def test_ratchet_accepts_entry_created_by_lowered_threshold():
    thresholds = {"bytes": 1000, "description_chars": 512, "lines": 80}
    assert _ratchet({}, {"widget": {"lines": 90}}, new_thresholds=thresholds) == []


def test_ratchet_rejects_raised_threshold_or_tolerance():
    assert _ratchet({}, {}, new_thresholds={"bytes": 2000, "description_chars": 512, "lines": 100})
    assert _ratchet({}, {}, new_tolerance={"bytes": 100, "description_chars": 50, "lines": 60})


def test_check_ratchet_cli_passes_against_itself():
    result = subprocess.run(
        [sys.executable, str(Path(sq.__file__)), "--check-ratchet", str(sq.BASELINE_PATH)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
