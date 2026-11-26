"""The answer key: our own SQL over the frozen database. Tools never import this module."""
import sqlite3

# Name fields return the machine or product NAME (the brief asks for names). Ordering stays on the code,
# so ties break the same way as before; only the returned value changes.
DOWNTIME_BY_MACHINE = ("SELECT mc.name, SUM(d.minutes) AS m FROM downtime d "
                       "JOIN machines mc ON mc.machine_id = d.machine_id "
                       "GROUP BY d.machine_id ORDER BY m DESC, d.machine_id")
# Returns (name, id, rate): the id drives the per-product machine query; the name is the answer.
RATE_BY_PRODUCT = ("SELECT p.name, w.product_id, 1.0 * SUM(q.defect_count) / SUM(q.inspected) AS r "
                   "FROM work_orders w JOIN quality_checks q ON q.wo_id = w.wo_id "
                   "JOIN products p ON p.product_id = w.product_id "
                   "GROUP BY w.product_id ORDER BY r DESC, w.product_id")
RATE_BY_MACHINE_FOR_PRODUCT = ("SELECT mc.name, 1.0 * SUM(q.defect_count) / SUM(q.inspected) AS r "
                               "FROM work_orders w JOIN quality_checks q ON q.wo_id = w.wo_id "
                               "JOIN machines mc ON mc.machine_id = w.machine_id "
                               "WHERE w.product_id = ? GROUP BY w.machine_id ORDER BY r DESC, w.machine_id")
TOTAL_PRODUCED = "SELECT SUM(qty_produced) FROM work_orders"
DOWNTIME_BY_REASON = ("SELECT reason, SUM(minutes) AS m FROM downtime "
                      "GROUP BY reason ORDER BY m DESC, reason")
MACHINE_AND_LINE_COUNTS = "SELECT COUNT(*), COUNT(DISTINCT line) FROM machines"
ALL_DEFECTS = "SELECT COUNT(*), COUNT(DISTINCT defect_type) FROM defects"
DEFECTS_BY_LINE = ("SELECT m.line, COUNT(d.defect_id) AS n FROM defects d "
                   "JOIN quality_checks q ON q.qc_id = d.qc_id "
                   "JOIN work_orders w ON w.wo_id = q.wo_id "
                   "JOIN machines m ON m.machine_id = w.machine_id "
                   "GROUP BY m.line ORDER BY n DESC, m.line")
LINE_B_TYPES = ("SELECT d.defect_type, COUNT(*) AS n FROM defects d "
                "JOIN quality_checks q ON q.qc_id = d.qc_id JOIN work_orders w ON w.wo_id = q.wo_id "
                "JOIN machines m ON m.machine_id = w.machine_id WHERE m.line = 'B' "
                "GROUP BY d.defect_type ORDER BY n DESC, d.defect_type")


def _ranked(path):
    """The ranked result lists every brief and margin check is computed from."""
    con = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    try:
        downtime = con.execute(DOWNTIME_BY_MACHINE).fetchall()
        products = con.execute(RATE_BY_PRODUCT).fetchall()
        machines = con.execute(RATE_BY_MACHINE_FOR_PRODUCT, (products[0][1],)).fetchall()
        total = con.execute(TOTAL_PRODUCED).fetchone()[0]
        types = con.execute(LINE_B_TYPES).fetchall()
    finally:
        con.close()
    return downtime, products, machines, total, types


def expected(brief_id, path):
    """The key answer for `brief_id` on the database at `path`. Raises KeyError for an unknown brief."""
    downtime, products, machines, total, types = _ranked(path)
    keys = {
        "B1": {"top_downtime_machine": downtime[0][0], "top_downtime_minutes": downtime[0][1],
               "worst_defect_product": products[0][0], "worst_defect_rate": products[0][2],
               "cause_machine": machines[0][0], "total_units_produced": total},
        "B2": {"top_defect_type": types[0][0], "top_defect_count": types[0][1],
               "line_b_defects_total": sum(n for _, n in types)},
    }
    if brief_id in ("B3", "B4", "B5", "B6"):
        keys.update(_later_briefs(path))
    return keys[brief_id]


def _later_briefs(path):
    """B3-B6 answers, each from its own query. Read-only, like the rest of this module."""
    con = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    try:
        reasons = con.execute(DOWNTIME_BY_REASON).fetchall()
        machines, lines = con.execute(MACHINE_AND_LINE_COUNTS).fetchone()
        total, distinct = con.execute(ALL_DEFECTS).fetchone()
        defect_lines = con.execute(DEFECTS_BY_LINE).fetchall()
    finally:
        con.close()
    return {
        "B3": {"top_downtime_reason": reasons[0][0], "top_downtime_reason_minutes": reasons[0][1]},
        "B4": {"top_defect_line": defect_lines[0][0], "top_defect_line_defects": defect_lines[0][1]},
        "B5": {"machine_count": machines, "line_count": lines},
        "B6": {"all_defects_total": total, "distinct_defect_types": distinct},
    }


def margins(path):
    """Leader over runner-up for each planted pattern. A small ratio means the key could flip on a data change."""
    downtime, products, machines, _, types = _ranked(path)
    return {"downtime_ratio": downtime[0][1] / downtime[1][1],
            "defect_rate_ratio": products[0][2] / products[1][2],
            "cause_rate_ratio": machines[0][1] / machines[1][1],
            "line_b_type_ratio": types[0][1] / types[1][1]}
