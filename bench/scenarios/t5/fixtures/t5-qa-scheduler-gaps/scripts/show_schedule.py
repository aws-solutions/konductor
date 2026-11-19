from datetime import datetime
import sys

from schedulerlib.scheduler import Schedule

if __name__ == "__main__":
    expression = sys.argv[1] if len(sys.argv) > 1 else "0 * * * *"
    print(Schedule(expression).next_run(datetime.now()).isoformat())
