# Import preview: one-pager

Owner: Maren Dyce (product). Engineering contact: Tobias Ruiz. Status: draft 3, 2025-04-03.

## Problem

People upload a CSV, wait while we read all of it, and only then find out we read a column
the wrong way: an account number became a number, a date column became text. They fix the
file and upload again. Support sees about a quarter of import tickets on this.

## Idea

Show a preview as soon as the file lands: the first rows as a table, and above each column
the type we think it is (whole number, decimal, date, text) with a dropdown to override it.
The user confirms or corrects the types, and the full import runs once with those types.

## Premise

The import preview can show the inferred column types after reading only the first 500 rows,
because column types are stable across a file.

Everything in the design depends on this. If it holds, the preview is instant even for a
400 MB file and the user confirms once. If it does not, the preview can promise something
the import will not honour.

## What we want to be true for users

- The preview appears in under two seconds for any file up to 500 MB.
- A user who accepts the preview types should not meet a type error in the full import.
- Overrides made in the preview are kept for the next upload of the "same" file.

## Not in scope for the first version

- Locale-aware dates (`31/03/2025`) and decimal commas.
- Excel files and other delimiters.
- Anything that rewrites the user's data.

## Open points

- Where the 500 came from: Maren remembers it from the first prototype; nobody has measured it.
- Whether the override dropdown needs a "treat as identifier" choice (see support notes).

## Decision wanted

Go or no-go on building the preview as drawn, at the design review on Thursday 10 April.
