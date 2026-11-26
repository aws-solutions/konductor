"""The read-only gate: a mode=ro connection, query_only, an allowlist authorizer, and caps on rows, cells and steps.

The text check only gives the model a clear refusal reason. The authorizer is the real gate: it holds even if the
text check is wrong.
"""
import re
import sqlite3

MAX_ROWS = 200
MAX_CELL_CHARS = 500
PROGRESS_EVERY = 1000
MAX_PROGRESS_CALLS = 5000  # 5M SQLite VM steps per query

ALLOWED_ACTIONS = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION,
                   getattr(sqlite3, "SQLITE_RECURSIVE", 33)}
SCOPE_ACTIONS = {sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH}
DENIED_FUNCTIONS = {"load_extension", "readfile", "writefile", "edit", "fts3_tokenizer"}

READ_KEYWORDS = {"select", "with", "values"}
SCOPE_KEYWORDS = {"attach", "detach"}
WRITE_KEYWORDS = {"insert", "update", "delete", "replace", "drop", "create", "alter", "pragma", "vacuum",
                  "reindex", "analyze", "begin", "commit", "end", "rollback", "savepoint", "release"}

# Comments and quoted text, so a ';' or keyword inside them is not read as SQL.
_TOKEN_NOISE = re.compile(r"--[^\n]*|/\*.*?(\*/|$)|'(?:[^']|'')*'?|\"(?:[^\"]|\"\")*\"?|`[^`]*`?|\[[^\]]*\]?", re.S)


class QueryRefused(Exception):
    """A query the gate would not run. `kind` is one of write, scope, syntax, limit."""

    def __init__(self, kind, reason):
        super().__init__(reason)
        self.kind = kind
        self.reason = reason


def _authorizer(state):
    """An SQLite authorizer that allows only read actions on `main`. It records the kind of its last denial in `state`."""

    def check(action, arg1, arg2, dbname, _source):
        if action in SCOPE_ACTIONS:
            state["denied"] = "scope"
            return sqlite3.SQLITE_DENY
        # dbname is None for a read of a CTE or subquery; any named database other than main is out of scope.
        if action == sqlite3.SQLITE_READ and dbname not in ("main", None):
            state["denied"] = "scope"
            return sqlite3.SQLITE_DENY
        if action == sqlite3.SQLITE_FUNCTION and (arg2 or "").lower() in DENIED_FUNCTIONS:
            state["denied"] = "scope"
            return sqlite3.SQLITE_DENY
        if action in ALLOWED_ACTIONS:
            return sqlite3.SQLITE_OK
        state["denied"] = "write"
        return sqlite3.SQLITE_DENY

    return check


class _GuardedConnection(sqlite3.Connection):
    """A connection that carries the authorizer's and progress handler's shared state."""
    mes_state = None


def open_readonly(path):
    """A connection to the existing database at `path` that cannot write, attach or load extensions.

    Raises sqlite3.OperationalError when `path` does not exist; it never creates a file.
    """
    con = sqlite3.connect("file:%s?mode=ro" % path, uri=True, check_same_thread=False, factory=_GuardedConnection)
    con.execute("PRAGMA query_only = ON")
    if hasattr(con, "enable_load_extension"):
        con.enable_load_extension(False)
    state = {"denied": None, "steps": 0}
    con.set_authorizer(_authorizer(state))
    con.set_progress_handler(_progress(state), PROGRESS_EVERY)
    con.mes_state = state
    return con


def _progress(state):
    def tick():
        state["steps"] += 1
        return 1 if state["steps"] > MAX_PROGRESS_CALLS else 0
    return tick


def _statements(sql):
    """The non-empty statements in `sql`, with comments and quoted text blanked out."""
    plain = _TOKEN_NOISE.sub(lambda m: " " if m.group(0).startswith(("--", "/*")) else "''", sql)
    return [s.strip() for s in plain.split(";") if s.strip()]


def text_check(sql):
    """Raises QueryRefused unless `sql` is one statement that starts with SELECT, WITH or VALUES."""
    if not isinstance(sql, str):
        raise QueryRefused("syntax", "sql must be a string")
    statements = _statements(sql)
    if not statements:
        raise QueryRefused("syntax", "empty query")
    firsts = [re.match(r"[A-Za-z]*", s).group(0).lower() for s in statements]
    if any(f in WRITE_KEYWORDS for f in firsts):
        raise QueryRefused("write", "the database is read-only; only SELECT is allowed")
    if any(f in SCOPE_KEYWORDS for f in firsts):
        raise QueryRefused("scope", "only the one MES database can be read")
    if len(statements) > 1:
        raise QueryRefused("syntax", "send one statement at a time")
    if firsts[0] not in READ_KEYWORDS:
        raise QueryRefused("syntax", "a query must start with SELECT or WITH")


def _cell(value, flags):
    if isinstance(value, bytes):
        value = value.hex()
    if isinstance(value, str) and len(value) > MAX_CELL_CHARS:
        flags["truncated"] = True
        return value[:MAX_CELL_CHARS]
    return value


def run_query(con, sql):
    """Runs one read-only query on a connection from open_readonly.

    Returns {"columns", "rows", "truncated"}, with at most MAX_ROWS rows and MAX_CELL_CHARS characters per text cell.
    Raises QueryRefused with kind write, scope, syntax or limit.
    """
    text_check(sql)
    state = con.mes_state
    state["denied"], state["steps"] = None, 0
    try:
        cur = con.execute(sql)
        raw = cur.fetchmany(MAX_ROWS + 1)
    except sqlite3.DatabaseError as e:
        msg = str(e)
        if state["denied"]:
            raise QueryRefused(state["denied"], "not allowed: " + msg) from None
        if "interrupted" in msg:
            raise QueryRefused("limit", "query ran too long") from None
        if "readonly" in msg:
            raise QueryRefused("write", "the database is read-only") from None
        raise QueryRefused("syntax", msg) from None
    flags = {"truncated": len(raw) > MAX_ROWS}
    rows = [[_cell(v, flags) for v in row] for row in raw[:MAX_ROWS]]
    return {"columns": [d[0] for d in cur.description or []], "rows": rows, "truncated": flags["truncated"]}
