# Accessibility review, order history page

Notes from the March review of the page. Status column is as of the last release.

| # | What the reviewer saw | Status |
| --- | --- | --- |
| 1 | The status chips cannot be reached or changed with the keyboard | fixed: the filter is a radio group (Tab to reach it, arrow keys to change) |
| 2 | Nothing tells a screen reader user how many orders are in the list after a change | fixed: a polite status line reads "N orders shown" |
| 3 | A bad date in From or To gives an empty table with no explanation | fixed: a message sits under the field and the field is marked invalid |
| 4 | Delivered badge text is light grey on a pale green background | open |
| 5 | No "skip to results" link before the controls | open |
| 6 | The orders table has no caption | open |
| 7 | Buttons lose their focus outline (`outline: none` in base.css) | open |
| 8 | On a mid-range phone the list stutters while typing in the search box | fixed (ticket 4417): search waits 200 ms after the last key, the table shows 50 rows at a time |

Items 1 to 3 and 8 are the ones the support team has had complaints about. Items 4 to 7 are still open.
