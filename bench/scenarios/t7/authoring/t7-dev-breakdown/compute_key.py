#!/usr/bin/env python3
"""Derive the plan key from the supplied fixture only."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "fixture"
OUT = ROOT / "hidden/key.json"

# The implementation slices are the changes a reference plan makes. Their point
# sizes are applied to the guide in the fixture rather than copied into the key.
migration = "db/migrations/005_add_product_prices.sql"
slices = [
    {
        "name": "storage migration and documentation",
        "points": 5,
        "files": [migration, "docs/data-dictionary.md"],
    },
    {
        "name": "catalog read path",
        "points": 5,
        "files": [
            "src/storage/product-repository.js",
            "src/services/catalog-service.js",
            "src/http/serializers/product.js",
            "src/services/money.js",
            "tests/unit/money.test.js",
            "src/config.js",
        ],
    },
    {
        "name": "currency-isolated cache",
        "points": 3,
        "files": ["src/cache/product-cache.js", "tests/unit/cache.test.js"],
    },
    {
        "name": "partner export",
        "points": 3,
        "files": ["src/export/products-csv.js", "tests/integration/export.test.js"],
    },
    {
        "name": "price notification",
        "points": 2,
        "files": [
            "src/notifications/price-email.js",
            "tests/integration/price-email.test.js",
        ],
    },
    {
        "name": "shared product fixtures",
        "points": 2,
        "files": ["tests/helpers/product-fixture.js", "tests/fixtures/products.json"],
    },
    {
        "name": "input and route behavior",
        "points": 3,
        "files": [
            "src/validation/currency.js",
            "src/http/products-route.js",
            "tests/integration/products-route.test.js",
        ],
    },
    {
        "name": "end-to-end catalog coverage",
        "points": 5,
        "files": ["tests/unit/catalog-service.test.js"],
    },
]

for item in slices:
    for rel in item["files"]:
        if rel == migration:
            continue
        if not (FIX / rel).is_file():
            raise SystemExit(f"reference file missing from fixture: {rel}")
if (FIX / migration).exists():
    raise SystemExit("planned migration unexpectedly exists in the snapshot")

# Parse the documented conversion table. This keeps the total coupled to the
# fixture's estimate convention and allows the reference to split work honestly.
guide = (FIX / "docs/estimate-guide.md").read_text(encoding="utf-8")
conversion = {
    int(points): float(days)
    for points, days in re.findall(r"\|\s*(\d+)\s*\|\s*([0-9.]+)\s*\|", guide)
}
total = sum(conversion[item["points"]] for item in slices)
files = []
for item in slices:
    for rel in item["files"]:
        if rel not in files:
            files.append(rel)

repo = "src/storage/product-repository.js"
service = "src/services/catalog-service.js"
route = "src/http/products-route.js"
cache = "src/cache/product-cache.js"
exporter = "src/export/products-csv.js"
email = "src/notifications/price-email.js"
helper = "tests/helpers/product-fixture.js"
legacy = "src/legacy/pricing-legacy.js"
for rel in [repo, service, route, cache, exporter, email, helper, legacy]:
    if not (FIX / rel).is_file():
        raise SystemExit(f"fixture file missing: {rel}")

assertions = [
    {
        "id": "migration-file",
        "desc": "plan names the new price-record migration",
        "op": "includes",
        "path": "files_to_change",
        "ids": [migration],
    },
    {
        "id": "read-files",
        "desc": "plan names the repository, service, and route read paths",
        "op": "includes",
        "path": "files_to_change",
        "ids": [repo, service, route],
    },
    {
        "id": "cache-file",
        "desc": "plan names the product cache",
        "op": "includes",
        "path": "files_to_change",
        "ids": [cache],
    },
    {
        "id": "all-renderers",
        "desc": "plan names both non-API price renderers",
        "op": "includes",
        "path": "files_to_change",
        "ids": [exporter, email],
    },
    {
        "id": "shared-helper",
        "desc": "plan names the shared product test helper",
        "op": "includes",
        "path": "files_to_change",
        "ids": [helper],
    },
    {
        "id": "legacy-excluded",
        "desc": "dead legacy pricing module is left alone",
        "op": "excludes",
        "path": "files_to_change",
        "ids": [legacy],
    },
    {
        "id": "migration-before-read",
        "desc": "storage migration precedes repository reads",
        "op": "order",
        "path": "change_order",
        "ids": [migration, repo],
    },
    {
        "id": "read-before-cache",
        "desc": "repository read work precedes cache isolation",
        "op": "order",
        "path": "change_order",
        "ids": [repo, cache],
    },
    {
        "id": "read-before-export",
        "desc": "repository read work precedes the partner export",
        "op": "order",
        "path": "change_order",
        "ids": [repo, exporter],
    },
    {
        "id": "read-before-email",
        "desc": "repository read work precedes the price notification",
        "op": "order",
        "path": "change_order",
        "ids": [repo, email],
    },
    {
        "id": "files-precise",
        "desc": "file list is focused on the implementation",
        "op": "precision",
        "path": "files_to_change",
        "ids": files,
        "min": 0.7,
        "maxCount": len(files) + 4,
    },
    {
        "id": "workday-total",
        "desc": "total estimate follows the team guide",
        "op": "number",
        "path": "total_estimate_days",
        "value": total,
        "tolPct": 20,
    },
]

key = {"output": "docs/multi-currency-plan.md", "block": "breakdown", "assertions": assertions}
OUT.write_text(json.dumps(key, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"files": files, "total": total, "assertions": len(assertions)}, indent=2))
