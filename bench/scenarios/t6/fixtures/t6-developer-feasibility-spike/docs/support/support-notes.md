# Import support notes (Ines, rolling, March-April 2025)

Informal. Not an official report. Counts come from the ticket export next to this file.

## Mar 3
Ticket 4417: customer "Halden Freight" uploaded a 60k-row file; import ended with 212 rows
rejected as "not a number". Customer thought the preview would have warned them. We have no
preview today, this is about the import screen. Customer asked for the rejected rows as a file.

## Mar 12
Ticket 4431: accents broken, Windows-1252 file. Not a type problem. Told them to re-save as UTF-8.

## Mar 19
Ticket 4440 and 4442 look alike: postcodes lost their leading zero. Both customers use the
same accounting package. Workaround: tell them to quote the column in the source.

## Mar 26
Ticket 4455: file with a thousand-row header block (title page from a report tool). Reader
sees one column. We told them to delete the lines above the header. Not in scope for preview v1.

## Apr 1
Ticket 4468: "Import said it failed but data is there". Partial import, customer re-uploaded,
duplicates. Not a type problem. Forwarded to the import-queue team.

## Counts, 1 Jan - 31 Mar (from the export, rough)
- total import tickets: 61
- leading zeros lost: 14
- encoding: 9
- rows rejected for the wrong type partway through: 11
- header problems: 8
- duplicates after re-upload: 7
- other / unclear: 12

Ines's own reading: "the 'wrong type partway through' ones are the ones that annoy people most, because
they had no warning at all". She has not checked whether the rejected rows were early or late in the file.
