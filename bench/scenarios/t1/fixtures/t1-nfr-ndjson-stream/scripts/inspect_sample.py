#!/usr/bin/env python3
import json
import sys


with open(sys.argv[1], encoding="utf-8") as stream:
    report = json.load(stream)
for name, values in report.get("endpoints", {}).items():
    print(f"{name}: {values['count']} requests")
