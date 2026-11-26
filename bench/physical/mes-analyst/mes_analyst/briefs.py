"""Analysis briefs: the question text, the answer fields and each field's tolerance, plus the answer shape check."""
import math

BRIEFS = {
    "B1": {
        "text": ("Find which machine's downtime drives a product's defects. "
                 "Report the machine with the most downtime minutes in total, and that total. "
                 "Report the product with the highest defect rate, where rate is defects divided by units inspected, "
                 "and that rate. For that product, report the machine whose work orders have the highest defect rate. "
                 "As a cross-check, report the total units produced over all work orders."),
        "fields": {
            "top_downtime_machine": {"type": "name"},
            "top_downtime_minutes": {"type": "number", "tol": 0},
            "worst_defect_product": {"type": "name"},
            "worst_defect_rate": {"type": "number", "tol": 0.0005},
            "cause_machine": {"type": "name"},
            "total_units_produced": {"type": "number", "tol": 0},
        },
    },
    "B2": {
        "text": ("Look only at work orders run on machines in line B. "
                 "Report the defect type found most often there, how many defects of that type there are, "
                 "and the total number of defects on line B."),
        "fields": {
            "top_defect_type": {"type": "name"},
            "top_defect_count": {"type": "number", "tol": 0},
            "line_b_defects_total": {"type": "number", "tol": 0},
        },
    },
    "B3": {
        "text": ("Find the downtime reason that costs the most minutes across all machines. "
                 "Report that reason and its total minutes."),
        "fields": {
            "top_downtime_reason": {"type": "name"},
            "top_downtime_reason_minutes": {"type": "number", "tol": 0},
        },
    },
    "B4": {
        "text": ("Count every defect found on each production line, across all work orders. "
                 "Report the line with the most defects and its defect count."),
        "fields": {
            "top_defect_line": {"type": "name"},
            "top_defect_line_defects": {"type": "number", "tol": 0},
        },
    },
    "B5": {
        "text": ("Count the machines on the floor, and count the product lines they belong to. "
                 "Report both counts."),
        "fields": {
            "machine_count": {"type": "number", "tol": 0},
            "line_count": {"type": "number", "tol": 0},
        },
    },
    "B6": {
        "text": ("Count every defect across all quality checks, on all lines. "
                 "Report that total and the number of distinct defect types."),
        "fields": {
            "all_defects_total": {"type": "number", "tol": 0},
            "distinct_defect_types": {"type": "number", "tol": 0},
        },
    },
}


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def shape_error(brief_id, answer):
    """Why `answer` is not in the fixed shape for `brief_id`, or None when it is.

    The shape is a dict with exactly the brief's fields; name fields hold strings and number fields hold finite numbers.
    """
    fields = BRIEFS[brief_id]["fields"]
    if not isinstance(answer, dict):
        return "answer must be an object"
    if set(answer) != set(fields):
        return "answer fields must be exactly: %s" % ", ".join(sorted(fields))
    for name, spec in fields.items():
        value = answer[name]
        if spec["type"] == "name" and not isinstance(value, str):
            return "%s must be a string" % name
        if spec["type"] == "number" and not _is_number(value):
            return "%s must be a finite number" % name
    return None
