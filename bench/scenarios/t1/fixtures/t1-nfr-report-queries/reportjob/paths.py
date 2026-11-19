"""Path helpers retained for small maintenance scripts."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "fixtures"
