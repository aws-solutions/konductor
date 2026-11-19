"""Print a compact view of the built-in rate table."""
from rates import table_rows

for row in table_rows():
    print(row["zone"], row["band"], row["limit"], row["charge"])
