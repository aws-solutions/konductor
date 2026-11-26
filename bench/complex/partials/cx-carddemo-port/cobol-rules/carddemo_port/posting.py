"""Job 1: validate and post daily transactions (REQUIREMENTS P1-P13)."""
from dataclasses import dataclass, replace
from decimal import Decimal

from carddemo_port.records import CatBal, Reject

REJECT_TEXT = {
    100: "INVALID CARD NUMBER FOUND",
    101: "ACCOUNT RECORD NOT FOUND",
    102: "OVERLIMIT TRANSACTION",
    103: "TRANSACTION RECEIVED AFTER ACCT EXPIRATION",
    104: "DUPLICATE TRANSACTION ID",
}
ZERO = Decimal("0.00")


@dataclass
class PostingResult:
    posted: list    # Tran, with proc_ts set, in input order
    rejects: list   # Reject, in input order
    accounts: dict  # id -> Account, after posting
    catbals: dict   # (account, type, category) -> CatBal, after posting


def _check(tran, account):
    """Return the reject code for a transaction against a found account, or None."""
    if tran.orig_ts[:10] > account.expiry_date:   # ISO dates compare as text; same day is fine
        return 103
    projected = account.cycle_credit - account.cycle_debit + tran.amount
    if projected > account.credit_limit:
        return 102
    return None


def post_transactions(trans, xref, accounts, catbals, now):
    """Post `trans` in order. Returns a PostingResult; the arguments are not changed.

    xref:     card number -> XrefRow
    accounts: account id -> Account
    catbals:  (account, type, category) -> CatBal
    now:      datetime used for every processed timestamp
    """
    accounts, catbals = dict(accounts), dict(catbals)
    stamp = now.strftime("%Y-%m-%d %H:%M:%S.%f")
    posted, rejects, seen = [], [], set()

    for tran in trans:
        code = _reject_code(tran, xref, accounts, seen)
        seen.add(tran.id)
        if code:
            rejects.append(Reject(tran, code, REJECT_TEXT[code]))
            continue
        acct_id = xref[tran.card].account
        account = accounts[acct_id]
        amount = tran.amount
        accounts[acct_id] = replace(
            account,
            balance=account.balance + amount,
            cycle_credit=account.cycle_credit + (amount if amount >= 0 else ZERO),
            cycle_debit=account.cycle_debit + (amount if amount < 0 else ZERO))
        key = (acct_id, tran.type_cd, tran.cat_cd)
        row = catbals.get(key) or CatBal(acct_id, tran.type_cd, tran.cat_cd, ZERO)
        catbals[key] = replace(row, balance=row.balance + amount)
        posted.append(replace(tran, proc_ts=stamp))

    return PostingResult(posted, rejects, accounts, catbals)


def _reject_code(tran, xref, accounts, seen):
    row = xref.get(tran.card)
    if row is None:
        return 100
    account = accounts.get(row.account)
    if account is None:
        return 101
    return _check(tran, account)
