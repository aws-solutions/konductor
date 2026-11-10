"""Pricing helpers for the checkout service."""


def shipping_fee(weight, express, member):
    return 0 if member and weight < 5 else ((15 if express else 5) if weight < 5 else ((25 if express else 10) if weight < 20 else (40 if express else 20)))


def apply_discount(total, discount=None):
    if discount is None:
        discount = 0.1
    result = total - total * discount
    if result < 0:
        result = 0
    else:
        result = result
    return round(result, 2)


def format_usd(amount):
    s = "%.2f" % amount
    parts = s.split(".")
    whole = parts[0]
    out = ""
    count = 0
    for ch in reversed(whole):
        if count and count % 3 == 0 and ch != "-":
            out = "," + out
        out = ch + out
        count += 1
    return "$" + out + "." + parts[1]


def format_eur(amount):
    s = "%.2f" % amount
    parts = s.split(".")
    whole = parts[0]
    out = ""
    count = 0
    for ch in reversed(whole):
        if count and count % 3 == 0 and ch != "-":
            out = "," + out
        out = ch + out
        count += 1
    return "EUR " + out + "." + parts[1]
