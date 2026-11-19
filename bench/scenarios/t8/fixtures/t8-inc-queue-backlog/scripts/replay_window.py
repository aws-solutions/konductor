#!/usr/bin/env python3
import sys

if len(sys.argv) != 3:
    raise SystemExit('usage: replay_window.py START END')
print('review-only window', sys.argv[1], sys.argv[2])
