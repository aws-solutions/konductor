#!/bin/sh
# Dry-run list for the weekly log rotation review.
find logs -type f -name '*.log' -printf '%p\n' | sort
