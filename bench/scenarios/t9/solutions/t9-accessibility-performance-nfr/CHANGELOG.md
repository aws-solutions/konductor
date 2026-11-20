# Changelog

## Unreleased
- Status filter is a real radio group: arrow keys move the selection and the label is read out.
- A polite status line reads "N orders shown" after every filter change (N is the full match count).
- Bad dates in From or To (To before From, or a day that does not exist) show a message under the field.
- Search waits 200 ms after the last keystroke before filtering, and Enter filters at once.
- The table shows 50 rows at a time with a "Show more" button.

## 0.4.2 - 2025-05-12
- Order data regenerated up to 20 June cut-off; ids are now continuous.
- Footer text updated (orders are kept for three years).

## 0.4.1 - 2025-04-02
- Customer names with accents are found without typing the accent (Søren, Łukasz).
- Day-first dates (14/03/2025 and 14.03.2025) are accepted in the From and To fields.

## 0.4.0 - 2025-03-04
- Date range filter added next to the status chips.
- Search now matches every word typed, in any order, instead of the exact phrase.

## 0.3.0 - 2025-01-21
- Orders table gets a city line under the customer name.
- Money is shown with a thousands separator.

## 0.2.0 - 2024-11-08
- Status chips added.

## 0.1.0 - 2024-10-15
- First version of the order history page.
