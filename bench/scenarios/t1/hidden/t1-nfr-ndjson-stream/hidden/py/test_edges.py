import gzip
import json
import subprocess
import sys
import tempfile
import tracemalloc
from pathlib import Path

from logjob import analyze
from timeouts import TimedCase

CEILING = 8 * 1024 * 1024


def _peak(path):
    tracemalloc.start()
    try:
        report = analyze(path)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    return report, peak


def _line(index, endpoint):
    return json.dumps({
        "endpoint": endpoint,
        "latency_ms": (index * 37) % 60001,
        "status": 500 if index % 17 == 0 else 200,
    }) + "\n"


class ReportEdgeTests(TimedCase):
    def _file(self, directory, name, text):
        path = Path(directory) / name
        path.write_text(text, encoding="utf-8")
        return path

    def _cli(self, source, target):
        completed = subprocess.run(
            [sys.executable, "-m", "logjob", "--input", str(source), "--output", str(target)],
            check=False, capture_output=True, text=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return json.loads(Path(target).read_text(encoding="utf-8"))

    def test_cli_reports_the_sample_malformed_count(self):
        with tempfile.TemporaryDirectory() as directory:
            report = self._cli("data/sample.ndjson", Path(directory) / "out" / "sample.json")
            self.assertEqual(report["total_records"], 7)
            self.assertEqual(report["malformed_lines"], 2)

    def test_cli_counts_every_kind_of_malformed_line(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self._file(directory, "mixed.ndjson", """oops
{"endpoint":"/ok","latency_ms":1,"status":200}

{"endpoint":"/ok","latency_ms":1}
""")
            report = self._cli(source, Path(directory) / "mixed.json")
            self.assertEqual(report["total_records"], 1)
            self.assertEqual(report["malformed_lines"], 3)

    def test_whitespace_only_lines_are_malformed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self._file(directory, "blank.ndjson", '   \n{"endpoint":"/b","latency_ms":1,"status":200}\n\n')
            report = analyze(path)
            self.assertEqual(report["total_records"], 1)
            self.assertEqual(report["malformed_lines"], 2)

    def test_json_values_that_are_not_objects_are_malformed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self._file(directory, "values.ndjson", 'null\n5\n"text"\n[1]\ntrue\n')
            report = analyze(path)
            self.assertEqual(report["malformed_lines"], 5)
            self.assertEqual(report["total_records"], 0)

    def test_field_bounds_are_inclusive(self):
        with tempfile.TemporaryDirectory() as directory:
            rows = [
                (0, 100), (60000, 599),
                (-1, 200), (60001, 200), (5, 99), (5, 600),
            ]
            text = "".join(json.dumps({"endpoint": "/edge", "latency_ms": ms, "status": status}) + "\n" for ms, status in rows)
            report = analyze(self._file(directory, "bounds.ndjson", text))
            self.assertEqual(report["total_records"], 2)
            self.assertEqual(report["malformed_lines"], 4)
            self.assertEqual(report["endpoints"]["/edge"]["error_count"], 1)
            self.assertEqual(report["endpoints"]["/edge"]["p95_ms"], 60000)

    def test_gzip_input_stays_under_the_memory_ceiling(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "large.ndjson.gz"
            with gzip.open(path, "wt", encoding="utf-8") as stream:
                for index in range(100_000):
                    stream.write(_line(index, f"/api/{index % 4}"))
            report, peak = _peak(path)
            self.assertEqual(report["total_records"], 100_000)
            self.assertLess(peak, CEILING)

    def test_one_busy_endpoint_stays_under_the_memory_ceiling(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "busy.ndjson"
            with path.open("w", encoding="utf-8") as stream:
                for index in range(200_000):
                    stream.write(_line(index, "/api/busy"))
            report, peak = _peak(path)
            self.assertEqual(report["endpoints"]["/api/busy"]["count"], 200_000)
            self.assertLess(peak, CEILING)

    def test_large_input_keeps_exact_percentiles(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "exact.ndjson"
            values = [(index * 7919) % 10_000 for index in range(10_000)]
            with path.open("w", encoding="utf-8") as stream:
                for value in values:
                    stream.write(json.dumps({"endpoint": "/exact", "latency_ms": value, "status": 200}) + "\n")
            stats = analyze(path)["endpoints"]["/exact"]
            self.assertEqual(stats["p50_ms"], 4999)
            self.assertEqual(stats["p95_ms"], 9499)
