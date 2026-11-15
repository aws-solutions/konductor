# SPDX-License-Identifier: Apache-2.0
"""Starts the gateway under `python3 -I`, which puts neither the script dir nor the cwd on sys.path."""
import os
import runpy
import sys

GATEWAY_DIR = os.path.dirname(os.path.realpath(__file__))
sys.path[:0] = [GATEWAY_DIR, os.path.dirname(GATEWAY_DIR)]
runpy.run_module("plant_gateway", run_name="__main__", alter_sys=True)
