# Changelog

## Unreleased

- Resolve the conflicting rules between the requirements and the integration guide (see docs/DECISIONS.md): trial 7 days (R1), refund window 30 days inclusive (R2), half-up proration everywhere (R3), 10 team seats (R5), EU prices include tax (R6), annual discount 20% (R7), immediate cancellation with a prorated credit (R9), 450 cents per extra seat (R10).
- Fix `refundFor`: day 30 is included in the window.
- Fix `planChangeCharge`: it had its own banker's rounding; it now uses the same proration as `prorateCredit`.

## 1.6.0

- Add `planChangeCharge`.

## 1.5.0

- Add `graceDeadline`.
