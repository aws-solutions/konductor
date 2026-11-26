"""Independent check of the six MES briefs: derives each answer from the raw rows in plain Python.

Deliberately does NOT import mes_analyst.key. Its answers must match the key's; a mismatch means the key's SQL
or the data disagrees with a second, separately written route, so one of them is wrong.
"""
import sqlite3
import sys


def rows(con, table):
    cur = con.execute("SELECT * FROM %s" % table)
    names = [d[0] for d in cur.description]
    return [dict(zip(names, r)) for r in cur.fetchall()]


def derive(path):
    con = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    try:
        machines = rows(con, "machines")
        work = rows(con, "work_orders")
        qc = rows(con, "quality_checks")
        defects = rows(con, "defects")
        downtime = rows(con, "downtime")
    finally:
        con.close()

    line_of = {m["machine_id"]: m["line"] for m in machines}
    wo_by_id = {w["wo_id"]: w for w in work}
    qc_by_id = {q["qc_id"]: q for q in qc}

    # B1: machine with the most downtime minutes; product with the highest defect rate; its worst machine.
    down_by_machine = {}
    for d in downtime:
        down_by_machine[d["machine_id"]] = down_by_machine.get(d["machine_id"], 0) + d["minutes"]
    top_machine = sorted(down_by_machine.items(), key=lambda kv: (-kv[1], kv[0]))[0]

    insp, dfx = {}, {}
    for q in qc:
        wo = wo_by_id[q["wo_id"]]
        p = wo["product_id"]
        insp[p] = insp.get(p, 0) + q["inspected"]
        dfx[p] = dfx.get(p, 0) + q["defect_count"]
    rate = {p: dfx[p] / insp[p] for p in insp}
    worst_product = sorted(rate.items(), key=lambda kv: (-kv[1], kv[0]))[0]

    insp_m, dfx_m = {}, {}
    for q in qc:
        wo = wo_by_id[q["wo_id"]]
        if wo["product_id"] != worst_product[0]:
            continue
        m = wo["machine_id"]
        insp_m[m] = insp_m.get(m, 0) + q["inspected"]
        dfx_m[m] = dfx_m.get(m, 0) + q["defect_count"]
    cause = sorted(((dfx_m[m] / insp_m[m]), m) for m in insp_m)
    cause_machine = sorted(insp_m, key=lambda m: (-(dfx_m[m] / insp_m[m]), m))[0]

    total_produced = sum(w["qty_produced"] for w in work)

    # B2: line B defects by type; the top type and its count; the line B total.
    qc_line_b = [q for q in qc if line_of[wo_by_id[q["wo_id"]]["machine_id"]] == "B"]
    line_b_ids = {q["qc_id"] for q in qc_line_b}
    by_type = {}
    for d in defects:
        if d["qc_id"] in line_b_ids:
            by_type[d["defect_type"]] = by_type.get(d["defect_type"], 0) + 1
    top_type = sorted(by_type.items(), key=lambda kv: (-kv[1], kv[0]))[0]

    # B3: downtime reason with the most minutes.
    by_reason = {}
    for d in downtime:
        by_reason[d["reason"]] = by_reason.get(d["reason"], 0) + d["minutes"]
    top_reason = sorted(by_reason.items(), key=lambda kv: (-kv[1], kv[0]))[0]

    # B4: production line with the most defects, counted over every defect row.
    defects_by_line = {}
    for d in defects:
        qc_row = qc_by_id[d["qc_id"]]
        ln = line_of[wo_by_id[qc_row["wo_id"]]["machine_id"]]
        defects_by_line[ln] = defects_by_line.get(ln, 0) + 1
    top_line = sorted(defects_by_line.items(), key=lambda kv: (-kv[1], kv[0]))[0]

    # B5: count of machines and of distinct lines.
    machine_count = len(machines)
    line_count = len({m["line"] for m in machines})

    # B6: all defects, and distinct defect types.
    all_defects = len(defects)
    distinct_types = len({d["defect_type"] for d in defects})

    return {
        "B1": {"top_downtime_machine": top_machine[0], "top_downtime_minutes": top_machine[1],
               "worst_defect_product": worst_product[0], "worst_defect_rate": worst_product[1],
               "cause_machine": cause_machine, "total_units_produced": total_produced},
        "B2": {"top_defect_type": top_type[0], "top_defect_count": top_type[1],
               "line_b_defects_total": sum(by_type.values())},
        "B3": {"top_downtime_reason": top_reason[0], "top_downtime_reason_minutes": top_reason[1]},
        "B4": {"top_defect_line": top_line[0], "top_defect_line_defects": top_line[1]},
        "B5": {"machine_count": machine_count, "line_count": line_count},
        "B6": {"all_defects_total": all_defects, "distinct_defect_types": distinct_types},
    }


def main(path):
    from mes_analyst import key  # imported only to compare; the derivation above never uses it
    mine = derive(path)
    bad = 0
    for brief_id, answer in mine.items():
        theirs = key.expected(brief_id, path)
        for field, value in answer.items():
            other = theirs[field]
            same = (abs(float(value) - float(other)) < 1e-9) if isinstance(value, (int, float)) else value == other
            if not same:
                bad += 1
                print("MISMATCH %s.%s: raw=%r key=%r" % (brief_id, field, value, other))
    print("checked %d briefs, %d field mismatches" % (len(mine), bad))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
