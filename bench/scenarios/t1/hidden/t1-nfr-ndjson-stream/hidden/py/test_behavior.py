import gzip
import json
import subprocess
import sys
import tempfile
import tracemalloc
from pathlib import Path
from unittest import mock

from logjob import analyze
from timeouts import TimedCase


class ReportBehaviorTests(TimedCase):
    def _file(self, directory, name, text):
        path = Path(directory) / name
        path.write_text(text, encoding="utf-8")
        return path

    def test_sample_summary_is_stable(self):
        expected = {
            "total_records": 7,
            "malformed_lines": 2,
            "endpoints": {
                "/api/items": {"count": 3, "error_count": 1, "p50_ms": 20, "p95_ms": 30},
                "/api/search": {"count": 4, "error_count": 1, "p50_ms": 15, "p95_ms": 100},
            },
        }
        self.assertEqual(analyze(Path("data/sample.ndjson")), expected)

    def test_valid_records_keep_endpoint_counts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self._file(directory, "valid.ndjson", """{"endpoint":"/one","latency_ms":9,"status":200}
{"endpoint":"/one","latency_ms":11,"status":500}
{"endpoint":"/two","latency_ms":4,"status":404}
""")
            report = analyze(path)
            self.assertEqual(report["malformed_lines"], 0)
            self.assertEqual(report["endpoints"]["/one"]["count"], 2)
            self.assertEqual(report["endpoints"]["/one"]["error_count"], 1)
            self.assertEqual(report["endpoints"]["/two"]["p50_ms"], 4)

    def test_malformed_lines_are_counted_and_skipped(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self._file(directory, "mixed.ndjson", """
not json
[]
{"endpoint":"/ok","latency_ms":3,"status":200}
{"endpoint":"","latency_ms":4,"status":200}
{"endpoint":"/bad","latency_ms":-1,"status":200}
{"endpoint":"/bad","latency_ms":4,"status":700}
""")
            report = analyze(path)
            self.assertEqual(report["malformed_lines"], 6)
            self.assertEqual(report["total_records"], 1)
            self.assertEqual(set(report["endpoints"]), {"/ok"})

    def test_non_integer_fields_are_malformed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self._file(directory, "types.ndjson", """{"endpoint":"/x","latency_ms":true,"status":200}
{"endpoint":"/x","latency_ms":2.5,"status":200}
{"endpoint":"/x","latency_ms":2,"status":"200"}
""")
            report = analyze(path)
            self.assertEqual(report["malformed_lines"], 3)
            self.assertEqual(report["total_records"], 0)

    def test_percentiles_use_nearest_rank_without_interpolation(self):
        with tempfile.TemporaryDirectory() as directory:
            rows = [{"endpoint": "/rank", "latency_ms": value, "status": 200} for value in (1, 2)]
            path = self._file(directory, "rank.ndjson", "".join(json.dumps(row) + "\n" for row in rows))
            values = analyze(path)["endpoints"]["/rank"]
            self.assertEqual(values["p50_ms"], 1)
            self.assertEqual(values["p95_ms"], 2)

    def test_percentiles_are_exact_for_unsorted_values(self):
        with tempfile.TemporaryDirectory() as directory:
            rows = [{"endpoint": "/rank", "latency_ms": n, "status": 200} for n in (40, 1, 30, 20, 10)]
            path = self._file(directory, "unsorted.ndjson", "".join(json.dumps(row) + "\n" for row in rows))
            values = analyze(path)["endpoints"]["/rank"]
            self.assertEqual(values["p50_ms"], 20)
            self.assertEqual(values["p95_ms"], 40)

    def test_gzip_input_matches_plain_input(self):
        with tempfile.TemporaryDirectory() as directory:
            text = """{"endpoint":"/zip","latency_ms":8,"status":200}
{"endpoint":"/zip","latency_ms":12,"status":503}
"""
            plain = self._file(directory, "events.ndjson", text)
            zipped = Path(directory) / "events.ndjson.gz"
            with gzip.open(zipped, "wt", encoding="utf-8") as stream:
                stream.write(text)
            self.assertEqual(analyze(zipped), analyze(plain))

    def test_gzip_preserves_malformed_count(self):
        with tempfile.TemporaryDirectory() as directory:
            zipped = Path(directory) / "events.ndjson.gz"
            with gzip.open(zipped, "wt", encoding="utf-8") as stream:
                stream.write("bad\n{\"endpoint\":\"/zip\",\"latency_ms\":1,\"status\":200}\n")
            self.assertEqual(analyze(zipped)["malformed_lines"], 1)

    def test_path_objects_are_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self._file(directory, "one.ndjson", '{"endpoint":"/path","latency_ms":6,"status":200}\n')
            report = analyze(path)
            self.assertEqual(report["malformed_lines"], 0)
            self.assertEqual(report["total_records"], 1)

    def test_empty_input_has_zero_totals(self):
        with tempfile.TemporaryDirectory() as directory:
            report = analyze(self._file(directory, "empty.ndjson", ""))
            self.assertEqual(report, {"total_records": 0, "malformed_lines": 0, "endpoints": {}})

    def test_endpoints_do_not_share_statistics(self):
        with tempfile.TemporaryDirectory() as directory:
            text = """{"endpoint":"/a","latency_ms":2,"status":500}
{"endpoint":"/b","latency_ms":90,"status":200}
"""
            report = analyze(self._file(directory, "two.ndjson", text))
            self.assertEqual(report["endpoints"]["/a"]["p95_ms"], 2)
            self.assertEqual(report["endpoints"]["/b"]["error_count"], 0)

    def test_cli_writes_the_same_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self._file(directory, "cli.ndjson", '{"endpoint":"/cli","latency_ms":7,"status":200}\n')
            target = Path(directory) / "nested" / "summary.json"
            completed = subprocess.run(
                [sys.executable, "-m", "logjob", "--input", str(source), "--output", str(target)],
                check=False, capture_output=True, text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["total_records"], 1)
            self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["malformed_lines"], 0)

    def test_plain_input_is_opened_once(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self._file(directory, "once.ndjson", '{"endpoint":"/once","latency_ms":1,"status":200}\n')
            real_open = open
            with mock.patch("builtins.open", wraps=real_open) as opened:
                analyze(path)
            self.assertEqual(opened.call_count, 1)

    def test_memory_stays_below_streaming_ceiling(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "large.ndjson"
            with path.open("w", encoding="utf-8") as stream:
                for index in range(100_000):
                    stream.write(json.dumps({
                        "endpoint": f"/api/{index % 4}",
                        "latency_ms": (index * 37) % 60001,
                        "status": 500 if index % 17 == 0 else 200,
                    }) + "\n")
            tracemalloc.start()
            try:
                report = analyze(path)
                _, peak = tracemalloc.get_traced_memory()
            finally:
                tracemalloc.stop()
            self.assertEqual(report["total_records"], 100_000)
            self.assertLess(peak, 8 * 1024 * 1024)
