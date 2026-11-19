#!/usr/bin/env python3
import argparse

parser = argparse.ArgumentParser(description="Print the checks used for a catalogue read replica")
parser.add_argument("--host", default="read-1")
args = parser.parse_args()
print(f"replica={args.host} checks=health,cpu,connections,lag")
