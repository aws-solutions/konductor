#!/usr/bin/env python3
from pathlib import Path

text = Path('alerts/alert-rules.yml').read_text(encoding='utf-8')
print(f'{text.count("- name:")} alert entries found')
