"""Print each table of the fixture database with its row count and columns (a read-only probe)."""
import os
import sqlite3
import sys

path = sys.argv[1]
con = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
for (table,) in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
    cols = [row[1] for row in con.execute("PRAGMA table_info(%s)" % table)]
    count = con.execute("SELECT COUNT(*) FROM %s" % table).fetchone()[0]
    print("%s (%d rows): %s" % (table, count, ", ".join(cols)))
con.close()
