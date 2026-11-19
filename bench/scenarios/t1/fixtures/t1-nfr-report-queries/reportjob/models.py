"""Small value objects used by the report code."""

from dataclasses import dataclass


@dataclass(frozen=True)
class OrderRow:
    customer_id: int
    customer_name: str
    email: str
    order_id: int
    order_date: str
    total_cents: int

    def as_dict(self) -> dict[str, object]:
        return {
            "customer_id": self.customer_id,
            "customer_name": self.customer_name,
            "email": self.email,
            "order_id": self.order_id,
            "order_date": self.order_date,
            "total_cents": self.total_cents,
        }
