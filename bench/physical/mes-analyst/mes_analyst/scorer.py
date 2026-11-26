"""Compares an answer with the key, field by field. Numbers within the field's tolerance; names exactly."""
from mes_analyst import briefs


def score(brief_id, answer, expected):
    """{"pass": bool, "fields": {name: {"ok", "got", "want"}}}. A missing field fails."""
    fields = {}
    for name, spec in briefs.BRIEFS[brief_id]["fields"].items():
        want, got = expected[name], answer.get(name)
        if spec["type"] == "number":
            ok = (isinstance(got, (int, float)) and not isinstance(got, bool)
                  and abs(got - want) <= spec["tol"])
        else:
            ok = got == want
        fields[name] = {"ok": ok, "got": got, "want": want}
    return {"pass": all(f["ok"] for f in fields.values()), "fields": fields}
