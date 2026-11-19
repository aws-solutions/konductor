from pathlib import Path
import sys

from schedulerlib.persistence import StateStore

if __name__ == "__main__":
    path = Path(sys.argv[1])
    print(StateStore(path).load())
