"""Record types. Frozen, so a rule cannot change a caller's record by accident."""
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class Account:
    id: str
    status: str
    balance: Decimal
    credit_limit: Decimal
    cash_limit: Decimal
    open_date: str
    expiry_date: str
    reissue_date: str
    cycle_credit: Decimal
    cycle_debit: Decimal  # zero or negative: payments and returns are added as negatives
    zip: str
    group_id: str


@dataclass(frozen=True)
class XrefRow:
    card: str
    customer: str
    account: str


@dataclass(frozen=True)
class CatBal:
    account: str
    type_cd: str
    cat_cd: str
    balance: Decimal


@dataclass(frozen=True)
class DiscRow:
    group: str
    type_cd: str
    cat_cd: str
    rate: Decimal  # yearly percent


@dataclass(frozen=True)
class Tran:
    id: str
    type_cd: str
    cat_cd: str
    source: str
    desc: str
    amount: Decimal
    merchant_id: str
    merchant_name: str
    merchant_city: str
    merchant_zip: str
    card: str
    orig_ts: str
    proc_ts: str


@dataclass(frozen=True)
class Reject:
    tran: Tran
    code: int
    text: str


@dataclass(frozen=True)
class TranType:
    code: str
    desc: str


@dataclass(frozen=True)
class TranCat:
    type_cd: str
    cat_cd: str
    desc: str


@dataclass(frozen=True)
class Customer:
    id: str
    first: str
    middle: str
    last: str
    addr1: str
    addr2: str
    addr3: str
    state: str
    country: str
    zip: str
    fico: str
