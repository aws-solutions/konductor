"""Export and session endpoints referenced by the issue queue."""

EXPORT_ROUTE = "/v1/exports"
SESSION_ROUTE = "/v1/session"
MOBILE_UPLOAD_ROUTE = "/v1/mobile/uploads"


def queue_export(account_id: str, query: str) -> str:
    return f"queued:{account_id}:{len(query)}"


def validate_session(cookie: str) -> bool:
    return bool(cookie)
