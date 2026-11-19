#!/bin/sh
set -eu
region=${1:-eu-west-1}
curl --fail --silent --show-error "https://login.${region}.atlas.example/health" >/dev/null
printf '%s healthy\n' "$region"
