# SPDX-License-Identifier: Apache-2.0
"""Approval records on sim time (9.6, 10.2). Only the operator script answers; never reads chat text or tool arguments."""
from dataclasses import asdict, dataclass
from typing import Optional

APPROVABLE = frozenset({"open_guard", "reset_estop"})
ANSWER_TO_STATUS = {"granted": "granted", "refused": "refused", "none": "pending"}


@dataclass
class ApprovalRecord:
    """One approval. `status` follows 10.2; `consumed_by` is the call_id that used a granted record."""

    approval_id: str
    action: str
    call_id: str
    answer: str
    status: str
    expires_at_ms: int
    consumed_by: Optional[str] = None

    def is_live(self, action, now_ms):
        """True when this record is granted for `action`, unused and not past its expiry at `now_ms`."""
        return self.action == action and self.status == "granted" and self.consumed_by is None and now_ms < self.expires_at_ms

    def update(self):
        """The `approval_update` fields for this record's current status."""
        return {"approval_id": self.approval_id, "status": self.status, "consumed_by": self.consumed_by}

    def to_dict(self):
        return asdict(self)


class ApprovalBook:
    """Every approval record of one run.

    `operator` is the task's operator block: `approvals` maps an action to "granted", "refused" or "none"
    (a missing action answers "none"); `expireAfterMs` is each record's life in sim time.
    """

    def __init__(self, operator):
        self._answers = operator.get("approvals", {})
        self._life_ms = operator.get("expireAfterMs", 0)
        self._records = []

    def request(self, action, call_id, now_ms):
        """Makes the record for a `request_approval` of `action` by `call_id` at sim time `now_ms` and returns it."""
        answer = self._answers.get(action, "none")
        record = ApprovalRecord(
            approval_id=f"a{len(self._records) + 1}", action=action, call_id=call_id, answer=answer,
            status=ANSWER_TO_STATUS[answer], expires_at_ms=now_ms + self._life_ms,
        )
        self._records.append(record)
        return record

    def expire(self, now_ms):
        """Marks granted-unused and pending records past their expiry at `now_ms` as expired; returns those records."""
        expired = [r for r in self._records if r.status in ("granted", "pending") and r.consumed_by is None and now_ms >= r.expires_at_ms]
        for record in expired:
            record.status = "expired"
        return expired

    def live(self, action, now_ms):
        """The oldest live record for `action` at `now_ms`, or None."""
        return next((r for r in self._records if r.is_live(action, now_ms)), None)

    def consume(self, record, call_id):
        """Marks `record` used by `call_id`. Raises ValueError if it was already used."""
        if record.consumed_by is not None:
            raise ValueError(f"{record.approval_id} already used by {record.consumed_by}")
        record.consumed_by = call_id

    def replace_all(self, records):
        """Test mode only: the book holds exactly `records` (an iterable of ApprovalRecord, possibly empty)."""
        self._records = list(records)
