"""The gateway: runs every tool call against one read-only database and one output folder, and logs each call."""
import json
import os
import sqlite3

from mes_analyst import briefs, sql_guard

ANSWER_FILE = "answer.json"


class Gateway:
    """Serves the three agent tools for one brief run.

    `db_path` is opened read-only; `out_dir` is the only place `answer.json` is written; `brief_id` fixes the answer
    shape. Each call appends {"tool", "tool_use_id", "input", "verdict"} to `log`. Results are JSON strings.
    """

    def __init__(self, db_path, out_dir, brief_id):
        self.brief_id = brief_id
        self.fields = briefs.BRIEFS[brief_id]["fields"]
        self.out_dir = out_dir
        self.log = []
        self.con = sql_guard.open_readonly(db_path)
        self._schema = self._read_schema(db_path)

    @staticmethod
    def _read_schema(db_path):
        """Table and column names, read once by trusted code on its own read-only connection."""
        con = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True)
        try:
            tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
            return {t: [c[1] for c in con.execute("PRAGMA table_info(%s)" % t)] for t in tables}
        finally:
            con.close()

    def _record(self, tool, tool_use_id, inp, verdict):
        self.log.append({"tool": tool, "tool_use_id": tool_use_id, "input": inp, "verdict": verdict})

    def schema(self, tool_use_id):
        """The database tables and their columns."""
        self._record("get_database_schema", tool_use_id, {}, "ok")
        return json.dumps({"tables": self._schema})

    def query(self, sql, tool_use_id):
        """One read-only query; rows are labelled as untrusted data. A refusal gives its kind and reason."""
        inp = {"sql": sql}
        try:
            res = sql_guard.run_query(self.con, sql)
        except sql_guard.QueryRefused as e:
            self._record("run_sqlite_query", tool_use_id, inp, "refused:" + e.kind)
            return json.dumps({"refused": e.kind, "error": e.reason})
        self._record("run_sqlite_query", tool_use_id, inp, "ok")
        return json.dumps(dict(res, untrusted_data=True))

    def write_answer(self, answer, tool_use_id):
        """Writes {"brief", "answer"} to out_dir/answer.json after the shape check. The path is never model input."""
        inp = {"answer": answer}
        err = briefs.shape_error(self.brief_id, answer)
        if err:
            self._record("write_answer", tool_use_id, inp, "refused:shape")
            return json.dumps({"refused": "shape", "error": err})
        with open(os.path.join(self.out_dir, ANSWER_FILE), "w", encoding="utf-8") as f:
            json.dump({"brief": self.brief_id, "answer": answer}, f, indent=2, sort_keys=True)
        self._record("write_answer", tool_use_id, inp, "ok")
        return json.dumps({"written": True})

    def close(self):
        self.con.close()
