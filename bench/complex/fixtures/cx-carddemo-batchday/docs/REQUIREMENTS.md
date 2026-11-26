# Requirements: the card batch day, four jobs (Python)

Version 2, 2026-11-26. These rules are ours. Where the CardDemo COBOL is
silent or odd, this file decides. Each rule has an id the tests cite.
A person must review rules marked REVIEW or DRAFT before any result is graded on them.
The rules of jobs 1 and 2 are signed off. The rules of jobs 3 and 4 marked DRAFT are not: they fill a gap in
the COBOL or depart from it, and they stay in force for the work, not for the grading, until a person signs them.
For jobs 3 and 4 the COBOL decides everything these rules do not mention.

Scope: stub-only. Local files in, local files out. No AWS, no network, no model.

## Money and files

- M1. All money is `Decimal` with 2 places. Never `float`.
- M2. Input and output files use the CardDemo fixed-width layouts (see INTERFACE.md).
  Signed numbers use the zoned form: the last character holds the sign
  (`{`=+0, `A`-`I`=+1..+9, `}`=-0, `J`-`R`=-1..-9).
- M3. A malformed record (wrong length, bad digit, bad sign) stops the run.
  Nothing is written. The error names the file and line.

## Job 1: post the daily transactions

Input: daily transactions, card-to-account cross reference, accounts,
category balances. Output: posted transactions, rejects, updated accounts,
updated category balances, a run summary.
A positive amount is a charge. A negative amount is a payment or return.

- P1. Process transactions in file order, one at a time.
- P2. Reject 100 "INVALID CARD NUMBER FOUND" if the card is not in the cross reference.
- P3. Reject 101 "ACCOUNT RECORD NOT FOUND" if the account is not in the account file.
- P4. Reject 103 "TRANSACTION RECEIVED AFTER ACCT EXPIRATION" if the date part
  of the original timestamp is later than the account expiry date. Same day is allowed.
- P5. Reject 102 "OVERLIMIT TRANSACTION" if
  `cycle_credit + cycle_debit + amount` is greater than the credit limit.
  `cycle_debit` is kept as zero or a negative number, so it nets against charges.
  Exactly equal to the limit is allowed. Approved as written (differs from the COBOL:
  which subtracts the negative debit and so counts payments as charges.
- P6. Checks run in this order and the first failure wins: P7 (duplicate), P2, P3, P4, P5.
  So an expired account that is also over its limit reports 103.
- P7. (Checked first, see P6.) Reject 104 "DUPLICATE TRANSACTION ID" if the id was already seen in this run
  (posted or rejected). The first one stands.
- P8. A posted transaction adds its amount to the account balance.
  Amount >= 0 adds to `cycle_credit`. Amount < 0 adds to `cycle_debit`.
- P9. A posted transaction adds its amount to the category balance for
  (account, type, category). A missing row is created at zero first.
- P10. A rejected transaction changes no balance. Rejects are kept in order.
- P11. The posted record copies the daily record and sets the processed timestamp
  from the run clock.
- P12. A reject record is the 350-character daily record, then a 4-digit code
  and a 76-character description.
- P13. The summary has processed, posted and rejected counts. Exit code is 4 if any
  were rejected, else 0.

## Job 2: monthly interest

Input: category balances, disclosure groups (rates), accounts, cross reference.
Output: interest transactions, updated accounts.

- I1. Group category balance rows by account. Accounts are handled in key order.
- I2. The rate is looked up by (account group, type, category). If not found, use the
  same key with group `DEFAULT`. If that is also missing, stop the run (M3 rule: write nothing).
- I3. Rate is a yearly percent. Interest = `balance * rate / 1200`, rounded to
  2 places, truncated toward zero, as the COBOL does (approved: matches COBOL).
- I4. A row with a zero rate or a balance of zero or below makes no interest.
  approved as written; the COBOL would make negative interest on a credit balance).
- I5. Each row with interest writes one transaction: type `01`, category `05`,
  source `System`, description `Int. for a/c <11-digit account>`, merchant fields blank,
  card number from the cross reference for that account (the lowest card number if there are several), both timestamps from the run clock.
- I6. Id is the 10-character run date, then a 6-digit counter starting at 000001
  and counting over the whole run.
- I7. After an account's rows are done, its balance rises by the interest total and
  `cycle_credit` and `cycle_debit` become zero. This happens even if interest is zero.
  Accounts with no category rows are untouched.
- I8. An account missing from the account file, or with no card in the cross reference
  when interest is due, stops the run.
- I9. Fees are out of scope. No fee is charged.

## Job 3: the daily transaction report (CBTRN03C)

Input: transactions, card-to-account cross reference, transaction types, transaction categories.
Output: one report. `--start` and `--end` choose the dates. Everything these rules do not say is as `CBTRN03C` does.

- R1. DRAFT - NEEDS OWNER SIGN-OFF. Both dates are included. A transaction whose processed date is outside the range is
  skipped and the run goes on with the next one. (The COBOL's `NEXT SENTENCE` jumps past the end of the loop at the first
  such record, so it stops the report there without totals.)
- R2. DRAFT - NEEDS OWNER SIGN-OFF. After the last transaction, the account total of the last account is written first,
  then the page total, then the grand total. The grand total is the sum of every amount reported. The last amount is not
  added a second time. (The COBOL writes no total for the last account and adds the last amount to the page and account
  totals again.)
- R3. DRAFT - NEEDS OWNER SIGN-OFF. If no transaction is in the range, the report is one set of headings, a page total of
  zero and a grand total of zero, and no account total. (The COBOL writes no headings.)
- R4. DRAFT - NEEDS OWNER SIGN-OFF. A card missing from the cross reference, or a type or category missing from its file,
  is a failed run: exit 2, nothing written, the error names the file. (The COBOL abends.)
- R5. DRAFT - NEEDS OWNER SIGN-OFF. Edited amount fields keep the width and the sign position of their COBOL picture
  (`-ZZZ,ZZZ,ZZZ.ZZ` for a line, `+ZZZ,ZZZ,ZZZ.ZZ` for a total, `Z(9).99-` and `9(9).99-` on a statement). The integer part
  is blank-filled on the left, with commas only between printed digits, but its last digit always prints: zero is `0.00`,
  and `0.05` is `0.05`. A number too wide for its field is bad input. (Applies to jobs 3 and 4.)

## Job 4: customer statements (CBSTM03A and CBSTM03B)

Input: transactions, cross reference, customers, accounts. Output: a text file and an HTML file, one statement per card.

- R6. DRAFT - NEEDS OWNER SIGN-OFF. Cards are taken in card number order and the transactions of a card in transaction id
  order, as a keyed file would give them, whatever the order in the input files. There is no limit of 51 cards or 10
  transactions per card. A card and transaction id that appear twice in `transact.txt` are bad input. A card with no
  transaction still gets a statement, with no lines and a total of `0.00`. (The COBOL tables hold 51 cards and 10 lines and
  overrun without a message.)
- R7. DRAFT - NEEDS OWNER SIGN-OFF. A fixed HTML line that the COBOL source continues on a second line is the two parts
  joined with nothing between. Every text record is 80 characters and every HTML record 100, padded on the right with
  blanks. (A literal continued in fixed format may be read as padded to column 72.)
- R8. DRAFT - NEEDS OWNER SIGN-OFF. A card whose customer or account record is missing gets no statement, and the run goes
  on; `skipped` in the summary counts these cards. (The COBOL abends.)

## Non-goals

Online screens, VSAM, JCL, inactive-card checks, currency, and fees.
