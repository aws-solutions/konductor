#!/bin/sh
# Print the replica lag query used during a release.
set -eu
printf '%s\n' 'select application_name, replay_lag_seconds from replica_health order by application_name;'
