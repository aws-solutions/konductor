import json
from pathlib import Path


def write_lines(directory, name, rows):
    path = Path(directory) / name
    path.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
    return path
