#!/usr/bin/env python3
from pathlib import Path

# Local maintenance helper for archived operator logs.
root = Path('/var/log/ledger')
for old in sorted(root.glob('ledger-*.log'))[:-14]:
    print(f'would archive {old.name}')
