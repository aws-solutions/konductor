# MES analyst (stub-only)

A Strands agent that answers factory briefs over a local, read-only SQLite MES database.
No AWS, no real model, no deploy. See `REQUIREMENTS.md` and `THREAT_MODEL.md`.

Run the tests (Python 3.12 with strands-agents 1.65.0; uses `unittest`, no pytest):

```
cd /local/home/nihitkas/.kiro/crew/workspace-member-mate/mes-analyst
TMPDIR=/tmp ../worktrees/standard/.venv/bin/python -m unittest discover -s tests -t .
```

A real-model run is not wired. It needs an approved credit cap and a model passed to `agent.run_brief`.
