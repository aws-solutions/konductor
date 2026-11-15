import os
import sys

PHYSICAL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for entry in (PHYSICAL, os.path.join(PHYSICAL, "gateway"), os.path.join(PHYSICAL, "controls")):
    if entry not in sys.path:
        sys.path.insert(0, entry)
