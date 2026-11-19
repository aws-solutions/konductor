#!/bin/sh
# Print the fields an operator should compare during a drain.
printf '%s
' 'drain_remaining close_rate new_assignments upstream_pool_wait_ms'
