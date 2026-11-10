"""Session state for the release-train SOP so a crashed run can pick up where it stopped."""
import os
import time
import yaml

SESSIONS_DIR = ".sop-state/sessions"
PHASE_STATUSES = ["PENDING", "SKIPPED", "IN_PROGRESS", "COMPLETED", "BLOCKED"]


def signature(description, path):
    return description.lower() + "::" + path


def mint(prefix, description, path, phases):
    os.makedirs(SESSIONS_DIR, exist_ok=True)
    stamp = time.strftime("%Y-%m-%dT%H-%M-%S")
    file_path = os.path.join(SESSIONS_DIR, f"{prefix}-{stamp}.yml")
    doc = {
        "run": {"project_signature": signature(description, path), "run_status": "in_progress", "counters": {}},
        "phases": {p: {"name": p, "status": "PENDING"} for p in phases},
        "features": {},
    }
    _write(file_path, doc)
    return file_path


def _write(file_path, doc):
    with open(file_path, "w") as fh:
        fh.write(yaml.dump(doc))


def discover(prefix, description, path):
    sig = signature(description, path)
    names = sorted(os.listdir(SESSIONS_DIR), reverse=True)
    for name in names:
        if not name.startswith(prefix):
            continue
        with open(os.path.join(SESSIONS_DIR, name)) as fh:
            doc = yaml.load(fh, Loader=yaml.Loader)
        if doc["run"]["project_signature"] == sig and doc["run"]["run_status"] != "completed":
            return name, doc
    return None, None


def set_phase(file_path, phase_id, status, summary=None, skip_reason=None):
    with open(file_path) as fh:
        doc = yaml.safe_load(fh)
    entry = doc["phases"][phase_id]
    entry["status"] = status
    if summary:
        entry["summary"] = summary
    if skip_reason:
        entry["skip_reason"] = skip_reason
    _write(file_path, doc)


def bump_counter(file_path, name):
    with open(file_path) as fh:
        doc = yaml.safe_load(fh)
    doc["run"]["counters"][name] = doc["run"]["counters"].get(name, 0) + 1
    _write(file_path, doc)
    return doc["run"]["counters"][name]
