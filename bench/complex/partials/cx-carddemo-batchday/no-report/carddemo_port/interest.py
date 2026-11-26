"""Job 2: monthly interest from category balances (REQUIREMENTS I1-I9)."""
from dataclasses import dataclass, replace
from decimal import ROUND_DOWN, Decimal

from carddemo_port.errors import ConfigError, DataError
from carddemo_port.records import Tran

ZERO = Decimal("0.00")

# Which rounding rule produced a result. Results with different tags are not comparable.
# "half-up-v1" was the first draft; "truncate-v2" is the approved I3 rule (matches COBOL).
INTEREST_RULE = "truncate-v2"
CENT = Decimal("0.01")
DEFAULT_GROUP = "DEFAULT"


@dataclass
class InterestResult:
    trans: list     # interest Tran records, in id order
    accounts: dict  # id -> Account, after the run


def _rate(rates, group, type_cd, cat_cd):
    """Rate for the group, else for DEFAULT. Missing both is a configuration error (I2)."""
    for g in (group, DEFAULT_GROUP):
        rate = rates.get((g, type_cd, cat_cd))
        if rate is not None:
            return rate
    raise ConfigError("no interest rate for group/type/category and no DEFAULT rate")


def _interest(balance, rate):
    """balance * rate / 1200, to the cent, truncated toward zero, as the COBOL does. Zero if no interest is due (I4)."""
    if rate == 0 or balance <= 0:
        return ZERO
    return (balance * rate / 1200).quantize(CENT, rounding=ROUND_DOWN)


def _lowest_card_by_account(xref):
    cards = {}
    for card in sorted(xref):
        cards.setdefault(xref[card].account, card)
    return cards


def compute_interest(catbals, rates, accounts, xref, run_date, now):
    """Charge one month of interest. Arguments are not changed.

    catbals:  (account, type, category) -> CatBal
    rates:    (group, type, category) -> yearly percent as Decimal
    accounts: account id -> Account
    xref:     card number -> XrefRow
    run_date: "YYYY-MM-DD", the first 10 characters of every interest transaction id
    now:      datetime used for both timestamps
    """
    accounts = dict(accounts)
    stamp = now.strftime("%Y-%m-%d %H:%M:%S.%f")
    cards = _lowest_card_by_account(xref)
    by_account = {}
    for key in sorted(catbals):
        by_account.setdefault(key[0], []).append(catbals[key])

    trans = []
    for acct_id, rows in by_account.items():
        account = accounts.get(acct_id)
        if account is None:
            raise DataError("category balance refers to an account that is not in the account file")
        total = ZERO
        for row in rows:
            amount = _interest(row.balance, _rate(rates, account.group_id, row.type_cd, row.cat_cd))
            if amount == 0:
                continue
            if acct_id not in cards:
                raise DataError("interest is due on an account with no card in the cross reference")
            trans.append(_interest_tran(len(trans) + 1, run_date, acct_id, cards[acct_id], amount, stamp))
            total += amount
        accounts[acct_id] = replace(account, balance=account.balance + total,
                                    cycle_credit=ZERO, cycle_debit=ZERO)
    return InterestResult(trans, accounts)


def _interest_tran(number, run_date, acct_id, card, amount, stamp):
    return Tran(id="%s%06d" % (run_date, number), type_cd="01", cat_cd="0005", source="System",
                desc="Int. for a/c " + acct_id, amount=amount, merchant_id="000000000",
                merchant_name="", merchant_city="", merchant_zip="", card=card,
                orig_ts=stamp, proc_ts=stamp)
