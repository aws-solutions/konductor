import gzip
import tempfile
import unittest
from pathlib import Path

from logjob.reader import read_records, stream_records, _validate_and_create_record
from logjob.models import Record


class ValidationTests(unittest.TestCase):
    def test_valid_record(self):
        result = _validate_and_create_record({"endpoint": "/api", "latency_ms": 100, "status": 200})
        self.assertIsNotNone(result)
        self.assertEqual(result.endpoint, "/api")
    
    def test_empty_endpoint_rejected(self):
        result = _validate_and_create_record({"endpoint": "", "latency_ms": 100, "status": 200})
        self.assertIsNone(result)
    
    def test_latency_out_of_range_rejected(self):
        result = _validate_and_create_record({"endpoint": "/api", "latency_ms": -1, "status": 200})
        self.assertIsNone(result)
        result = _validate_and_create_record({"endpoint": "/api", "latency_ms": 60001, "status": 200})
        self.assertIsNone(result)
    
    def test_status_out_of_range_rejected(self):
        result = _validate_and_create_record({"endpoint": "/api", "latency_ms": 100, "status": 99})
        self.assertIsNone(result)
        result = _validate_and_create_record({"endpoint": "/api", "latency_ms": 100, "status": 600})
        self.assertIsNone(result)
    
    def test_boolean_latency_rejected(self):
        result = _validate_and_create_record({"endpoint": "/api", "latency_ms": True, "status": 200})
        self.assertIsNone(result)


class ReaderTests(unittest.TestCase):
    def test_skips_bad_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "records.ndjson"
            path.write_text('bad\n{"endpoint": "/ok", "latency_ms": 2, "status": 200}\n', encoding="utf-8")
            records = read_records(path)
            self.assertEqual(len(records), 1)
    
    def test_blank_lines_counted_as_malformed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "records.ndjson"
            path.write_text('\n\n{"endpoint": "/ok", "latency_ms": 2, "status": 200}\n\n', encoding="utf-8")
            records = read_records(path)
            self.assertEqual(len(records), 1)
            # Check that blank lines are counted as malformed
            results = list(stream_records(path))
            malformed_count = sum(1 for _, malformed in results if malformed)
            # 3 blank lines: 2 before, 1 after (the final \n doesn't create a blank line)
            self.assertEqual(malformed_count, 3)
    
    def test_reads_gzip_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "records.ndjson.gz"
            with gzip.open(path, "wt", encoding="utf-8") as f:
                f.write('{"endpoint": "/ok", "latency_ms": 2, "status": 200}\n')
            records = read_records(path)
            self.assertEqual(len(records), 1)
    
    def test_stream_records_counts_malformed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "records.ndjson"
            path.write_text('bad\n{"endpoint": "/ok", "latency_ms": 2, "status": 200}\nnot-json\n', encoding="utf-8")
            
            records = list(stream_records(path))
            valid = [r for r, malformed in records if not malformed]
            malformed_count = sum(1 for _, malformed in records if malformed)
            
            self.assertEqual(len(valid), 1)
            self.assertEqual(malformed_count, 2)


if __name__ == "__main__":
    unittest.main()
