from dataclasses import dataclass


@dataclass(frozen=True)
class Record:
    endpoint: str
    latency_ms: int
    status: int
