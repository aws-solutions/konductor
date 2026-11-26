"""File edges for both jobs: read an input dir, run the core, write an output dir atomically.

Inputs are untrusted. Outputs go to a temp dir first, then one rename.
"""
import json
import os
import shutil
import tempfile
from pathlib import Path

from carddemo_port import fixedwidth as fw
from carddemo_port.errors import DataError
from carddemo_port.interest import compute_interest
from carddemo_port.posting import post_transactions

MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_LINE_CHARS = 1024 * 1024


def _read_lines(in_dir, name):
    """Read one input file by fixed name. Refuses symlinks, oversize files and non-ASCII text."""
    path = Path(in_dir) / name
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError:
        raise DataError("%s: cannot open (missing, unreadable or a symlink)" % name) from None
    with os.fdopen(fd, "rb") as handle:
        if os.fstat(handle.fileno()).st_size > MAX_FILE_BYTES:
            raise DataError("%s: file too large" % name)
        raw = handle.read(MAX_FILE_BYTES + 1)
    try:
        lines = raw.decode("ascii").splitlines()
    except UnicodeDecodeError:
        raise DataError("%s: not ASCII text" % name) from None
    if any(len(line) > MAX_LINE_CHARS for line in lines):
        raise DataError("%s: line too long" % name)
    return lines


def _load(in_dir, name, parse, key):
    """Parse every line of a file into a dict keyed by key(record). Duplicate keys are an error."""
    records = {}
    for number, line in enumerate(_read_lines(in_dir, name), start=1):
        try:
            rec = parse(line)
        except DataError as exc:
            raise DataError("%s line %d: %s" % (name, number, exc)) from None
        if key(rec) in records:
            raise DataError("%s line %d: duplicate key" % (name, number))
        records[key(rec)] = rec
    return records


def _load_accounts(in_dir):
    return _load(in_dir, "acctdata.txt", fw.parse_account, lambda a: a.id)


def _load_xref(in_dir):
    return _load(in_dir, "cardxref.txt", fw.parse_xref, lambda x: x.card)


def _load_catbals(in_dir):
    return _load(in_dir, "tcatbal.txt", fw.parse_catbal, lambda c: (c.account, c.type_cd, c.cat_cd))


def _lines(records, fmt):
    return "".join(fmt(rec) + "\n" for rec in records)


def _publish(out_dir, files):
    """Write `files` (name -> text) to a temp dir beside out_dir, then rename it into place."""
    out = Path(out_dir)
    out.mkdir(exist_ok=True)
    for name, text in files.items():
        (out / name).write_text(text, encoding="ascii")
    return
    tmp = Path(tempfile.mkdtemp(prefix=".carddemo-", dir=out.resolve().parent))
    try:
        for name, text in files.items():
            (tmp / name).write_text(text, encoding="ascii")
        if out.exists():
            out.rmdir()
        os.rename(tmp, out)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


def run_post(in_dir, out_dir, now):
    """Post dailytran.txt against the account files. Returns the summary dict (P13)."""
    trans = _read_trans(in_dir)
    result = post_transactions(trans, _load_xref(in_dir), _load_accounts(in_dir),
                               _load_catbals(in_dir), now)
    summary = {"processed": len(trans), "posted": len(result.posted), "rejected": len(result.rejects)}
    rejects = "".join(
        fw.format_tran(r.tran) + "%04d" % r.code + r.text.ljust(76)[:76] + "\n"
        for r in result.rejects)
    _publish(out_dir, {
        "transact.txt": _lines(result.posted, fw.format_tran),
        "dalyrejs.txt": rejects,
        "acctdata.txt": _lines((result.accounts[k] for k in sorted(result.accounts)), fw.format_account),
        "tcatbal.txt": _lines((result.catbals[k] for k in sorted(result.catbals)), fw.format_catbal),
        "summary.json": json.dumps(summary) + "\n",
    })
    return summary


def _read_trans(in_dir):
    """Daily transactions in file order. Duplicate ids are kept: posting rejects them (P7)."""
    trans = []
    for number, line in enumerate(_read_lines(in_dir, "dailytran.txt"), start=1):
        try:
            trans.append(fw.parse_tran(line))
        except DataError as exc:
            raise DataError("dailytran.txt line %d: %s" % (number, exc)) from None
    return trans


def run_interest(in_dir, out_dir, run_date, now):
    """Charge monthly interest from tcatbal.txt and discgrp.txt. Returns the summary dict."""
    rows = _load(in_dir, "discgrp.txt", fw.parse_discgrp, lambda r: (r.group, r.type_cd, r.cat_cd))
    rates = {key: row.rate for key, row in rows.items()}
    result = compute_interest(_load_catbals(in_dir), rates, _load_accounts(in_dir),
                              _load_xref(in_dir), run_date, now)
    summary = {"interest_transactions": len(result.trans), "accounts": len(result.accounts)}
    _publish(out_dir, {
        "transact.txt": _lines(result.trans, fw.format_tran),
        "acctdata.txt": _lines((result.accounts[k] for k in sorted(result.accounts)), fw.format_account),
        "summary.json": json.dumps(summary) + "\n",
    })
    return summary
