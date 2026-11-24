#!/bin/sh
set -eu
df -P . | tail -n 1
