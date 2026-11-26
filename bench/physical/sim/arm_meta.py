# SPDX-License-Identifier: Apache-2.0
"""The arm plant's simulator version and its tool and rule metadata (bench/plants/arm-sim/meta.json), read once. Imports no MuJoCo."""
from .meta import ARM_META_PATH, load_meta

SIM_VERSION = "1"
ARM_META = load_meta(ARM_META_PATH)
