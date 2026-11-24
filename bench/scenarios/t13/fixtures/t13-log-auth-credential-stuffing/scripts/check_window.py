#!/usr/bin/env python3
import json
import sys
from pathlib import Path

for name in sys.argv[1:]:
    with Path(name).open() as stream:
        for line in stream:
            row = json.loads(line)
            if row.get('event') in {'login_ok', 'token_issued'}:
                print(row['ts'], row['node'], row['account'])
