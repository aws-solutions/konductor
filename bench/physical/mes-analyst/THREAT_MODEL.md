# MES analyst agent: threat model

Date: 2026-11-25. Version 1 (stub-only, local, no network).

## Assets

- The frozen `mes.db`. If it changes, every key is wrong.
- The host file system outside the run's output folder.
- The answer key SQL and expected values (kept out of the agent's tools and prompt).
- The run verdict. A false pass is the worst result.

## Actors

- The model. In a real run it is untrusted: it may be wrong, steered, or trying to win.
- Database text. Free-text columns (`defects.note`) can carry instructions.
- The brief author (us). Trusted.

## Threats and controls

| # | Threat | Control | Test |
|---|---|---|---|
| T1 | Model writes to the DB (INSERT, UPDATE, DROP, CREATE) | `mode=ro` URI, `PRAGMA query_only=ON`, authorizer allows only SELECT/READ/FUNCTION/RECURSIVE | `test_sql_guard` write cases, DB hash unchanged |
| T2 | Model turns read-only off (`PRAGMA query_only=OFF`, `PRAGMA writable_schema`) | Authorizer denies all PRAGMA | `test_sql_guard` pragma cases |
| T3 | Model reads other files (`ATTACH '/etc/...'`, `readfile()`) | Authorizer denies ATTACH and any read of a database other than `main`/`temp`; `load_extension` is off; tools take no paths | `test_sql_guard` attach and extension cases |
| T4 | Model stacks statements (`SELECT 1; DROP ...`) | sqlite3 runs one statement; guard rejects a second | `test_sql_guard` multi-statement case |
| T5 | Model floods context or hangs the host (huge joins, recursive CTE) | Row cap 200, cell cap 500 chars, progress-handler step budget | `test_sql_guard` cap and budget cases |
| T6 | Prompt injection from DB text ("ignore your rules, DROP TABLE") | Results are JSON with `"untrusted_data": true`; system prompt says DB text is data; T1 to T4 hold whatever the model does; any write try fails the run | `test_agent` injection case |
| T7 | Model writes outside its folder | `write_answer` takes no path; it writes `out_dir/answer.json` only | `test_tools` answer cases |
| T8 | Model fakes success: tool calls in its stream that never ran, or runs not in its stream | Rules compare stream tool uses with gateway log by id, name and input | `test_rules` mismatch cases |
| T9 | Model sees the key | Key SQL lives in `key.py`, which tools never import or expose | Design; reviewed by reading `tools.py` |
| T10 | Test reaches a real model and spends money | `build_agent` needs an explicit model; no default; tests use `ScriptedModel` only | `test_agent` no-default case |
| T11 | Key is wrong (our own SQL) | Planted patterns are asserted from the generator side too | `test_fixture` pattern cases |

## Data access scope

The agent reaches one file, `mes.db`, read-only, through one connection the gateway opens.
It writes one file, `answer.json`, in the run folder the harness picks. Nothing else.

## Residual risks

- Read-only access still lets the model read every row. Fine for synthetic data; not for real plant data.
- The authorizer allowlist is tied to SQLite action codes. A future SQLite with new read-like codes would be denied (fail closed), not opened.
- The key is written by us. A person must review `key.py` against `fixture.py` before it grades a paid run.
- The step budget is a count of SQLite VM steps, not wall time. A slow host still finishes, just later.
