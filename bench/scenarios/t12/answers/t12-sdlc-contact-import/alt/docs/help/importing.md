# Bring your contacts in from a spreadsheet

**Before you start:** export the sheet as a CSV file. Keep a header row with a `name` column and an `email` column
(a `phone` column is optional). The columns can be in any order. One file can hold up to 5,000 contacts; split a
bigger sheet into several files, because a file with more is turned away whole and nothing from it is added.

**Import:** open the address book, choose **Import**, and select the file.

**Read the summary:** you see how many contacts were added and a list of the rows that were left out. Each entry
gives the row's line number as your spreadsheet shows it (the header is line 1) and the reason:

- the name is empty,
- the email address is not valid,
- the email address is already in your address book, or appears twice in the file.

**Fix and retry:** correct those lines in the sheet and import the same file again. Contacts that already made it
in are recognised and left out, so nothing is doubled.
