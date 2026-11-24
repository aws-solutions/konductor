"""Invoice presentation and access helpers."""

INVOICE_ROUTE = "/v1/invoices/{invoice_id}"
FOOTER_COPY = "Thank you for choosing Northstar"


def invoice_path(invoice_id: str) -> str:
    return INVOICE_ROUTE.format(invoice_id=invoice_id)


def footer(locale: str) -> str:
    return FOOTER_COPY if locale == "en" else "Merci de choisir Northstar"
