import json


def render_summary(summary):
    return json.dumps(summary, indent=2, sort_keys=True) + "\n"
