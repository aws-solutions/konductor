"""Builders for in-memory stub data. Values are ours, not taken from the sample files."""
from datetime import datetime
from decimal import Decimal

from carddemo_port.records import Account, CatBal, Tran, XrefRow

NOW = datetime(2026, 11, 25, 12, 0, 0)
NOW_TS = "2026-11-25 12:00:00.000000"


def D(text):
    return Decimal(text)


def account(acct_id="00000000001", balance="100.00", limit="1000.00",
            expiry="2030-01-01", cyc_credit="0.00", cyc_debit="0.00", group="A"):
    """An Account with only the fields the rules read set to interesting values."""
    return Account(
        id=acct_id, status="Y", balance=D(balance), credit_limit=D(limit),
        cash_limit=D("0.00"), open_date="2020-01-01", expiry_date=expiry,
        reissue_date="2025-01-01", cycle_credit=D(cyc_credit), cycle_debit=D(cyc_debit),
        zip="12345", group_id=group)


def tran(tran_id="0000000000000001", amount="10.00", card="4000000000000001",
         type_cd="01", cat_cd="0001", orig_ts="2026-11-01 08:00:00.000000"):
    """A daily transaction. Defaults make a valid small purchase."""
    return Tran(
        id=tran_id, type_cd=type_cd, cat_cd=cat_cd, source="POS TERM", desc="test purchase",
        amount=D(amount), merchant_id="000000001", merchant_name="Shop", merchant_city="Town",
        merchant_zip="11111", card=card, orig_ts=orig_ts, proc_ts="")


def xref(card="4000000000000001", acct="00000000001", cust="000000001"):
    return XrefRow(card=card, customer=cust, account=acct)


def catbal(acct="00000000001", type_cd="01", cat_cd="0001", balance="0.00"):
    return CatBal(account=acct, type_cd=type_cd, cat_cd=cat_cd, balance=D(balance))


def stores(accounts=(), xrefs=(), catbals=()):
    """Turn lists into the keyed dicts the core functions take."""
    return (
        {a.id: a for a in accounts},
        {x.card: x for x in xrefs},
        {(c.account, c.type_cd, c.cat_cd): c for c in catbals},
    )
