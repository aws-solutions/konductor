# Calendar Workbench

Calendar Workbench schedules small jobs without external dependencies. It includes a cron-like calendar, retry delays, a priority queue, a sliding-window limiter, and JSON state storage.

The package targets Python 3.12 and is intentionally useful as an embeddable library. The command-line interface can inspect a schedule or initialize a state file.

## Quick start

```python
from datetime import datetime
from schedulerlib.scheduler import Schedule

run_at = Schedule("15 9 * * 1-5").next_run(datetime(2025, 3, 3, 8, 0))
print(run_at)
```

Run the checks with `python3 -m unittest discover -s tests`.
