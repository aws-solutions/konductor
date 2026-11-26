"""R4, R6, R10, T6, T7: the gateway runs each tool, logs it, labels DB text as untrusted and writes one answer file."""
import json
import os
import unittest

from mes_analyst import briefs
from mes_analyst.gateway import Gateway
from tests.helpers import DbCase


class GatewayTest(DbCase):
    def setUp(self):
        super().setUp()
        self.gw = Gateway(self.db, self.out, "B2")

    def tearDown(self):
        self.gw.close()
        super().tearDown()

    def test_schema(self):
        res = json.loads(self.gw.schema("t1"))
        self.assertIn("defects", res["tables"])
        self.assertIn("note", res["tables"]["defects"])
        self.assertEqual(self.gw.log[-1]["tool"], "get_database_schema")
        self.assertEqual(self.gw.log[-1]["verdict"], "ok")

    def test_query_labels_untrusted(self):
        res = json.loads(self.gw.query("SELECT note FROM defects WHERE note LIKE '%DROP TABLE%'", "t2"))
        self.assertTrue(res["untrusted_data"])
        self.assertIn("DROP TABLE", res["rows"][0][0])
        entry = self.gw.log[-1]
        self.assertEqual(entry, {"tool": "run_sqlite_query", "tool_use_id": "t2",
                                 "input": {"sql": "SELECT note FROM defects WHERE note LIKE '%DROP TABLE%'"},
                                 "verdict": "ok"})

    def test_query_refusal_logged(self):
        res = json.loads(self.gw.query("DROP TABLE defects", "t3"))
        self.assertEqual(res["refused"], "write")
        self.assertEqual(self.gw.log[-1]["verdict"], "refused:write")
        self.assertDbUnchanged()

    def test_query_non_string(self):
        res = json.loads(self.gw.query(42, "t4"))
        self.assertEqual(res["refused"], "syntax")

    def good_answer(self):
        return {"top_defect_type": "weld_crack", "top_defect_count": 10, "line_b_defects_total": 20}

    def test_write_answer(self):
        res = json.loads(self.gw.write_answer(self.good_answer(), "t5"))
        self.assertTrue(res["written"])
        with open(os.path.join(self.out, "answer.json"), encoding="utf-8") as f:
            saved = json.load(f)
        self.assertEqual(saved, {"brief": "B2", "answer": self.good_answer()})
        self.assertEqual(os.listdir(self.out), ["answer.json"])
        self.assertEqual(self.gw.log[-1]["verdict"], "ok")

    def test_write_answer_shape_refused(self):
        bad = [
            "text",
            {"top_defect_type": "weld_crack"},
            dict(self.good_answer(), extra=1),
            dict(self.good_answer(), top_defect_count="ten"),
            dict(self.good_answer(), top_defect_count=True),
            dict(self.good_answer(), top_defect_type=3),
            dict(self.good_answer(), top_defect_count=float("nan")),
        ]
        for answer in bad:
            with self.subTest(answer=answer):
                res = json.loads(self.gw.write_answer(answer, "t6"))
                self.assertEqual(res["refused"], "shape")
                self.assertEqual(self.gw.log[-1]["verdict"], "refused:shape")
        self.assertEqual(os.listdir(self.out), [])

    def test_answer_path_is_fixed(self):
        """A path-like value is stored as text, never used as a path."""
        answer = dict(self.good_answer(), top_defect_type="../../etc/passwd")
        json.loads(self.gw.write_answer(answer, "t7"))
        self.assertEqual(os.listdir(self.out), ["answer.json"])

    def test_gateway_needs_known_brief(self):
        with self.assertRaises(KeyError):
            Gateway(self.db, self.out, "B9")

    def test_brief_fields_are_typed(self):
        for brief in briefs.BRIEFS.values():
            for spec in brief["fields"].values():
                self.assertIn(spec["type"], ("name", "number"))


class StrandsToolsTest(DbCase):
    def test_three_tools_no_path_inputs(self):
        from mes_analyst.tools import make_tools
        gw = Gateway(self.db, self.out, "B1")
        tools = make_tools(gw)
        names = sorted(t.tool_name for t in tools)
        self.assertEqual(names, ["get_database_schema", "run_sqlite_query", "write_answer"])
        for t in tools:
            props = t.tool_spec["inputSchema"]["json"].get("properties", {})
            for prop in props:
                self.assertNotIn("path", prop.lower())
        gw.close()


if __name__ == "__main__":
    unittest.main()
