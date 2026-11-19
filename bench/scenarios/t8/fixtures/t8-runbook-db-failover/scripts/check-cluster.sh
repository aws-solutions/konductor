#!/bin/sh
# Read-only checks for a QuorumCtl operator.
set -eu
quorumctl status --cluster orders-prod
quorumctl verify --cluster orders-prod
