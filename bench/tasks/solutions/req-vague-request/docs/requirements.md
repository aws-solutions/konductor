# Requirements: stock count upload

Source: `docs/stakeholder-request.md`. Each requirement names the request sentence it comes from. Priorities use MUST, SHOULD and COULD.

## Functional requirements

| ID | Requirement | Acceptance check | Priority | Source |
|----|-------------|------------------|----------|--------|
| REQ-1 | WHEN a store submits a count file, the system SHALL apply each valid count to the stored quantity of that store and item. | Given a file with 3 valid rows, WHEN it is submitted, THEN 3 quantities equal the file values. | MUST | sentence 1 |
| REQ-2 | WHEN a file contains an invalid row, the system SHALL apply the valid rows and return a list of the rejected rows with the row number and the reason. | Given a file with 4 valid rows and 1 row with a negative count, THEN 4 counts are applied and 1 rejection names row and reason. | MUST | sentences 4 and 5, decision D1 below |
| REQ-3 | IF the file cannot be read as a count file, THEN the system SHALL reject the whole file and change no quantity. | Given a file that is not valid text with the agreed columns, THEN no quantity changes and the response says why. | MUST | sentence 4 |
| REQ-4 | WHEN two counts for the same store and item are received, the system SHALL keep the count with the later count time. | Given counts with times 06:00 and 06:05 for one item, THEN the stored quantity is the 06:05 count. | MUST | sentence 9, assumption A3 |
| REQ-5 | IF a count is negative or not a whole number, THEN the system SHALL reject that row. | Given a row with 1.5, THEN the row is listed as rejected. | MUST | README rules |
| REQ-6 | WHERE a count differs from the stored quantity by more than the review limit, the system SHALL apply the count and flag the difference for review. | Given a stored quantity of 100, a limit of 50% and a count of 20, THEN 20 is stored and the difference is flagged. | SHOULD | sentence 7, decision D3 below |
| REQ-7 | The system SHALL let only a signed-in store manager upload a file. | Given a staff sign-in without the manager role, WHEN it uploads, THEN the response is 403. | MUST | sentence 6, decision D2 below |
| REQ-8 | The system SHALL show a store only its own quantities. | Given store A signed in, WHEN it asks for counts, THEN no row of store B appears. | MUST | sentence 8 |
| REQ-9 | The system SHALL provide one report of all stores for head office users. | Given 40 stores with counts, THEN the report lists 40 stores. | SHOULD | sentence 8 |
| REQ-10 | The system SHALL keep the existing reorder report working. | The existing tests for the reorder report still pass. | MUST | sentence 10 |

## Non-functional requirements

| ID | Requirement | Acceptance check | Priority | Source |
|----|-------------|------------------|----------|--------|
| NFR-1 | The system SHALL return the upload result for a file of up to 5000 rows within 5 seconds at the 95th percentile. | A test uploads 5000 rows and measures 5 seconds or less in 95 of 100 runs. | MUST | sentence 3, ambiguity A1 |
| NFR-2 | The system SHALL accept uploads from 40 stores that all start within the same 15 minutes. | A load test sends 40 uploads in 15 minutes and every one succeeds. | MUST | sentence 2, gap N1 |
| NFR-3 | The system SHALL lose no count when two uploads name the same item at the same time. | A test sends 2 uploads for one item together and the stored value equals one of the two counts. | MUST | sentence 2, gap N1 |
| NFR-4 | The system SHALL reject a file larger than 5000 rows with an error that states the limit. | Given a file of 5001 rows, THEN the response is an error that names 5000. | SHOULD | gap N1 |
| NFR-5 | A store member who has not been trained SHALL be able to upload a file in 3 steps or fewer, and every error message SHALL name the row. | A usability check with 3 staff finds the upload in 3 steps and each error names a row. | SHOULD | sentence 3, ambiguity A2 |

## Conflicts and contradictions in the request

- C1, whole file against good rows. Sentence 4 says reject the whole file on a bad row, and sentence 5 says a bad row must not block the good rows. These conflict. Decision D1: apply the valid rows and report the rejected ones (REQ-2). A file that cannot be read at all is still rejected whole (REQ-3). Needs confirmation by Operations.
- C2, who may upload. Sentence 6 says only the store manager, and also that any staff member on shift can upload from the shared tablet. These contradict. Decision D2: the manager signs in on the shared tablet, and staff use that session. Needs confirmation.
- X1, applied as sent and rejected. Sentence 7 says every count is applied exactly as sent and that a count that differs from what the system expects is rejected. A differing count cannot be both applied and rejected. Decision D3: apply it and flag a large difference for review (REQ-6). Needs confirmation.

## Ambiguous terms

- A1, "quickly" has no number. Proposed: 5 seconds at the 95th percentile for 5000 rows (NFR-1). Needs confirmation.
- A2, "simple enough without training" cannot be tested as written. Proposed: 3 steps and row-level error messages (NFR-5).
- A3, "most recent" does not say which time. Assumed: the count time in the file, not the arrival time (REQ-4). A tie keeps the first received.

## Assumptions and open questions

| ID | Assumption or question | Effect if wrong |
|----|------------------------|-----------------|
| ASM-1 | The service keeps one quantity per item today, so per-store counts need a quantity for each store and item. | If stores overwrite one shared quantity, REQ-8 cannot be met and the data model changes. |
| ASM-2 | The file is text with one row per item and the columns item id, count and count time, and a count replaces the stored quantity. | If counts are changes instead, REQ-1 and REQ-4 change and a repeated upload would double count. |
| ASM-3 | An item is named by the id the service already uses. | If stores use their own codes, a mapping table is needed before launch. |
| OQ-1 | Who counts as head office, and how do they sign in? | REQ-9 cannot be built until this is known. |
