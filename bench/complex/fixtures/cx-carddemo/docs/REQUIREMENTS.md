# Requirements: card posting and interest (Python)

Version 1, 2026-11-25. These rules are ours. Where the CardDemo COBOL is
silent or odd, this file decides. Each rule has an id the tests cite.
A person must review rules marked REVIEW before any result is graded on them.

Scope: stub-only. Local files in, local files out. No AWS, no network, no model.

## Money and files

- M1. All money is `Decimal` with 2 places. Never `float`.
- M2. Input and output files use the CardDemo fixed-width layouts (see DESIGN.md).
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

## Non-goals

Online screens, VSAM, JCL, inactive-card checks, currency, and fees.
