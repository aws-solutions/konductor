#!/usr/bin/env python3
# Local operator helper; it prints the command and does not call a control plane.
import sys
region = sys.argv[1] if len(sys.argv) > 1 else 'eu-west-1'
print(f'prepare rotation for {region}')
