"""Pricing rules for domestic parcel services.

This module deliberately keeps the pricing calculation in one place.  The
public functions are used by the command line tool and by a small batch job.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import math
from typing import Iterable

from calendar_rules import is_holiday


ZONE_BASE_RATES = {
    1: 4.25,
    2: 5.75,
    3: 7.10,
    4: 8.40,
    5: 9.95,
}
UNKNOWN_ZONE = 5
WEIGHT_BANDS = (
    (1.0, 0.00, "letter"),
    (5.0, 2.75, "small"),
    (10.0, 5.50, "medium"),
    (20.0, 10.00, "large"),
    (math.inf, 18.00, "oversize"),
)
SERVICE_MULTIPLIERS = {
    "ground": 1.00,
    "priority": 1.35,
    "overnight": 1.90,
}
FUEL_RATE = 0.08
RESIDENTIAL_FEE = 1.25
REMOTE_FEE = 3.50
SIGNATURE_FEE = 2.00
HOLIDAY_FEE = 4.00
CURRENCY = "USD"


@dataclass(frozen=True)
class RateRequest:
    zone: int | str
    weight: float
    service: str = "ground"
    residential: bool = False
    remote: bool = False
    signature: bool = False
    ship_date: date | None = None
    declared_value: float = 0.0


@dataclass(frozen=True)
class RateBreakdown:
    total: float
    base: float
    fuel: float
    extras: float
    zone: int
    weight_band: str
    service: str
    holiday: bool
    currency: str = CURRENCY

    def as_dict(self) -> dict[str, object]:
        return {
            "total": self.total,
            "base": self.base,
            "fuel": self.fuel,
            "extras": self.extras,
            "zone": self.zone,
            "weight_band": self.weight_band,
            "service": self.service,
            "holiday": self.holiday,
            "currency": self.currency,
        }


def round_money(amount: float) -> float:
    """Round a currency amount to cents using the service's usual rule."""
    return math.floor(amount * 100.0 + 0.5) / 100.0


def _zone_or_fallback(zone: int | str) -> int:
    try:
        value = int(zone)
    except (TypeError, ValueError) as exc:
        raise ValueError("zone must be an integer") from exc
    if value in ZONE_BASE_RATES:
        return value
    return UNKNOWN_ZONE


def _checked_weight(weight: float) -> float:
    try:
        value = float(weight)
    except (TypeError, ValueError) as exc:
        raise ValueError("weight must be a number") from exc
    if not math.isfinite(value):
        raise ValueError("weight must be finite")
    if value < 0:
        raise ValueError("weight cannot be negative")
    return value


def weight_band(weight: float) -> tuple[float, str]:
    """Return the additive charge and label for a package's weight."""
    value = _checked_weight(weight)
    for limit, charge, label in WEIGHT_BANDS:
        if value <= limit:
            return charge, label
    raise RuntimeError("weight table has no final band")


def base_rate(zone: int | str, weight: float) -> tuple[float, int, str]:
    """Return the unadjusted rate, normalized zone, and weight label."""
    normalized = _zone_or_fallback(zone)
    weight_charge, label = weight_band(weight)
    return ZONE_BASE_RATES[normalized] + weight_charge, normalized, label


def _multiplier(service: str) -> float:
    try:
        return SERVICE_MULTIPLIERS[service.lower()]
    except (AttributeError, KeyError) as exc:
        raise ValueError("unknown service: %s" % service) from exc


def _surcharges_for(request: RateRequest, holiday: bool) -> tuple[float, list[str]]:
    total = 0.0
    names: list[str] = []
    if request.residential:
        total += RESIDENTIAL_FEE
        names.append("residential")
    if request.remote:
        total += REMOTE_FEE
        names.append("remote")
    if request.signature:
        total += SIGNATURE_FEE
        names.append("signature")
    if holiday:
        total += HOLIDAY_FEE
        names.append("holiday")
    if request.declared_value > 100.0:
        insurance = round_money((request.declared_value - 100.0) * 0.01)
        total += insurance
        names.append("insurance")
    return total, names


def _ship_date(request: RateRequest) -> date:
    return request.ship_date if request.ship_date is not None else date.today()


def _quote(request: RateRequest, surcharge_sink: list[str] | None = None) -> RateBreakdown:
    weight = _checked_weight(request.weight)
    raw_base, normalized_zone, band = base_rate(request.zone, weight)
    service = request.service.lower()
    adjusted_base = raw_base * _multiplier(service)
    ship_date = _ship_date(request)
    holiday = is_holiday(ship_date)
    extras, names = _surcharges_for(request, holiday)
    fuel = adjusted_base * FUEL_RATE
    if surcharge_sink is not None:
        surcharge_sink.extend(names)
        if fuel:
            surcharge_sink.append("fuel")
    total = round_money(adjusted_base + fuel + extras)
    return RateBreakdown(
        total=total,
        base=round_money(adjusted_base),
        fuel=round_money(fuel),
        extras=round_money(extras),
        zone=normalized_zone,
        weight_band=band,
        service=service,
        holiday=holiday,
    )


def calculate_rate(
    zone: int | str,
    weight: float,
    service: str = "ground",
    *,
    residential: bool = False,
    remote: bool = False,
    signature: bool = False,
    ship_date: date | None = None,
    declared_value: float = 0.0,
) -> RateBreakdown:
    """Calculate a rate from the small set of public shipping inputs."""
    request = RateRequest(
        zone=zone,
        weight=weight,
        service=service,
        residential=residential,
        remote=remote,
        signature=signature,
        ship_date=ship_date,
        declared_value=declared_value,
    )
    return _quote(request)


class RateCalculator:
    """Reusable calculator that also exposes the latest surcharge labels."""

    def __init__(self) -> None:
        self._surcharge_labels: list[str] = []
        self._quotes: list[RateBreakdown] = []

    def quote(self, request: RateRequest) -> RateBreakdown:
        self._surcharge_labels = []
        result = _quote(request, self._surcharge_labels)
        self._quotes.append(result)
        return result

    def last_surcharges(self) -> tuple[str, ...]:
        return tuple(self._surcharge_labels)

    def history(self) -> tuple[RateBreakdown, ...]:
        return tuple(self._quotes)


def quote_many(requests: Iterable[RateRequest]) -> list[RateBreakdown]:
    calculator = RateCalculator()
    return [calculator.quote(item) for item in requests]


def summarize(breakdowns: Iterable[RateBreakdown]) -> dict[str, float]:
    values = list(breakdowns)
    if not values:
        return {"count": 0.0, "total": 0.0, "average": 0.0}
    total = round_money(sum(item.total for item in values))
    return {
        "count": float(len(values)),
        "total": total,
        "average": round_money(total / len(values)),
    }


def compare_services(zone: int | str, weight: float) -> dict[str, RateBreakdown]:
    return {
        service: calculate_rate(zone, weight, service)
        for service in SERVICE_MULTIPLIERS
    }


def zone_description(zone: int | str) -> str:
    normalized = _zone_or_fallback(zone)
    if normalized == UNKNOWN_ZONE and str(zone) not in {str(k) for k in ZONE_BASE_RATES}:
        return "fallback zone %d" % UNKNOWN_ZONE
    return "zone %d" % normalized


def is_free_shipping(request: RateRequest) -> bool:
    return request.declared_value >= 500.0 and request.service == "ground"


def format_breakdown(breakdown: RateBreakdown) -> str:
    return (
        "%s %.2f (%s, zone %d, %s)"
        % (
            breakdown.currency,
            breakdown.total,
            breakdown.service,
            breakdown.zone,
            breakdown.weight_band,
        )
    )


# These small adapters are retained for importers that used the original
# procedural API before RateRequest was introduced.
def rate_for_order(order: dict[str, object]) -> RateBreakdown:
    return calculate_rate(
        order.get("zone", UNKNOWN_ZONE),
        order.get("weight", 0.0),
        str(order.get("service", "ground")),
        residential=bool(order.get("residential", False)),
        remote=bool(order.get("remote", False)),
        signature=bool(order.get("signature", False)),
        declared_value=float(order.get("declared_value", 0.0)),
    )


def normalize_request(values: dict[str, object]) -> RateRequest:
    return RateRequest(
        zone=values.get("zone", UNKNOWN_ZONE),
        weight=float(values.get("weight", 0.0)),
        service=str(values.get("service", "ground")),
        residential=bool(values.get("residential", False)),
        remote=bool(values.get("remote", False)),
        signature=bool(values.get("signature", False)),
        declared_value=float(values.get("declared_value", 0.0)),
    )


def table_rows() -> list[dict[str, object]]:
    rows = []
    for zone in sorted(ZONE_BASE_RATES):
        for limit, charge, label in WEIGHT_BANDS:
            rows.append({"zone": zone, "limit": limit, "charge": charge, "band": label})
    return rows


def validate_catalog() -> list[str]:
    problems: list[str] = []
    if UNKNOWN_ZONE not in ZONE_BASE_RATES:
        problems.append("fallback zone is not priced")
    if not WEIGHT_BANDS or WEIGHT_BANDS[-1][0] != math.inf:
        problems.append("weight table has no open-ended band")
    if any(value <= 0 for value in ZONE_BASE_RATES.values()):
        problems.append("zone base must be positive")
    if any(value <= 0 for value in SERVICE_MULTIPLIERS.values()):
        problems.append("service multiplier must be positive")
    return problems


# Historical names kept at the bottom so that old batch scripts can import
# them without needing a compatibility package.
def get_rate(zone: int | str, weight: float, service: str = "ground") -> float:
    return calculate_rate(zone, weight, service).total


def get_zone(zone: int | str) -> int:
    return _zone_or_fallback(zone)


def get_band(weight: float) -> str:
    return weight_band(weight)[1]


def get_holiday_fee(day: date) -> float:
    return HOLIDAY_FEE if is_holiday(day) else 0.0


def get_surcharge_total(request: RateRequest) -> float:
    result = _quote(request)
    return round_money(result.total - result.base)


def rates_version() -> str:
    return "2024.11"


# Keep the module's long-lived table readable in tracebacks and simple REPLs.
RATE_TABLE_DESCRIPTION = "zone base plus weight band, service factor, fuel, and extras"
DEFAULT_REQUEST = RateRequest(zone=1, weight=1.0)


def describe_request(request: RateRequest) -> str:
    flags = []
    if request.residential:
        flags.append("residential")
    if request.remote:
        flags.append("remote")
    if request.signature:
        flags.append("signature")
    suffix = ",".join(flags) if flags else "none"
    return "%s/%s/%s [%s]" % (request.zone, request.weight, request.service, suffix)


def check_request(request: RateRequest) -> None:
    _checked_weight(request.weight)
    _multiplier(request.service)
    _zone_or_fallback(request.zone)


def copy_request(request: RateRequest, **changes: object) -> RateRequest:
    values = {
        "zone": request.zone,
        "weight": request.weight,
        "service": request.service,
        "residential": request.residential,
        "remote": request.remote,
        "signature": request.signature,
        "ship_date": request.ship_date,
        "declared_value": request.declared_value,
    }
    values.update(changes)
    return RateRequest(**values)


def annual_holiday_count(year: int) -> int:
    return sum(1 for month in range(1, 13) for day in range(1, 32) if _is_valid_day(year, month, day) and is_holiday(date(year, month, day)))


def _is_valid_day(year: int, month: int, day: int) -> bool:
    try:
        date(year, month, day)
    except ValueError:
        return False
    return True


# The following aliases are intentionally boring: they support two old report
# templates that refer to the calculation in slightly different terms.
shipping_rate = calculate_rate
parcel_rate = calculate_rate
price_for = get_rate


def rate_bucket(total: float) -> str:
    if total < 10:
        return "economy"
    if total < 25:
        return "regular"
    if total < 50:
        return "premium"
    return "special"


def surcharge_labels(request: RateRequest) -> tuple[str, ...]:
    sink: list[str] = []
    _quote(request, sink)
    return tuple(sink)


def total_for_requests(requests: Iterable[RateRequest]) -> float:
    return summarize(quote_many(requests))["total"]


def max_rate(breakdowns: Iterable[RateBreakdown]) -> RateBreakdown | None:
    values = list(breakdowns)
    return max(values, key=lambda item: item.total) if values else None


def min_rate(breakdowns: Iterable[RateBreakdown]) -> RateBreakdown | None:
    values = list(breakdowns)
    return min(values, key=lambda item: item.total) if values else None


def group_by_zone(breakdowns: Iterable[RateBreakdown]) -> dict[int, list[RateBreakdown]]:
    grouped: dict[int, list[RateBreakdown]] = {}
    for breakdown in breakdowns:
        grouped.setdefault(breakdown.zone, []).append(breakdown)
    return grouped


def group_totals_by_service(breakdowns: Iterable[RateBreakdown]) -> dict[str, float]:
    totals: dict[str, float] = {}
    for breakdown in breakdowns:
        totals[breakdown.service] = round_money(totals.get(breakdown.service, 0.0) + breakdown.total)
    return totals


def band_limits() -> tuple[float, ...]:
    return tuple(limit for limit, _charge, _label in WEIGHT_BANDS)


def band_names() -> tuple[str, ...]:
    return tuple(label for _limit, _charge, label in WEIGHT_BANDS)


def base_prices() -> dict[int, float]:
    return dict(ZONE_BASE_RATES)


def service_names() -> tuple[str, ...]:
    return tuple(SERVICE_MULTIPLIERS)


def surcharge_rates() -> dict[str, float]:
    return {
        "fuel": FUEL_RATE,
        "residential": RESIDENTIAL_FEE,
        "remote": REMOTE_FEE,
        "signature": SIGNATURE_FEE,
        "holiday": HOLIDAY_FEE,
    }


def make_request(
    zone: int | str,
    weight: float,
    *,
    priority: bool = False,
    overnight: bool = False,
    residential: bool = False,
    remote: bool = False,
    signature: bool = False,
) -> RateRequest:
    service = "overnight" if overnight else "priority" if priority else "ground"
    return RateRequest(
        zone=zone,
        weight=weight,
        service=service,
        residential=residential,
        remote=remote,
        signature=signature,
    )


def request_from_row(row: dict[str, object]) -> RateRequest:
    return normalize_request(row)


def breakdown_from_row(row: dict[str, object]) -> RateBreakdown:
    request = request_from_row(row)
    return _quote(request)


def export_rows(breakdowns: Iterable[RateBreakdown]) -> list[dict[str, object]]:
    return [breakdown.as_dict() for breakdown in breakdowns]


def import_rows(rows: Iterable[dict[str, object]]) -> list[RateBreakdown]:
    result = []
    for row in rows:
        result.append(
            RateBreakdown(
                total=float(row["total"]),
                base=float(row["base"]),
                fuel=float(row["fuel"]),
                extras=float(row["extras"]),
                zone=int(row["zone"]),
                weight_band=str(row["weight_band"]),
                service=str(row["service"]),
                holiday=bool(row["holiday"]),
                currency=str(row.get("currency", CURRENCY)),
            )
        )
    return result


def audit_breakdown(breakdown: RateBreakdown) -> list[str]:
    warnings: list[str] = []
    if breakdown.total < 0:
        warnings.append("negative total")
    if breakdown.base < 0:
        warnings.append("negative base")
    if breakdown.fuel < 0:
        warnings.append("negative fuel")
    if breakdown.zone not in ZONE_BASE_RATES:
        warnings.append("unlisted zone")
    if breakdown.service not in SERVICE_MULTIPLIERS:
        warnings.append("unlisted service")
    return warnings


def check_table_order() -> bool:
    last = 0.0
    for limit, _charge, _label in WEIGHT_BANDS:
        if limit < last:
            return False
        last = limit
    return True


def lookup_band_for_report(weight: float) -> dict[str, object]:
    charge, label = weight_band(weight)
    return {"weight": float(weight), "charge": charge, "label": label}


def rate_for_report(row: dict[str, object]) -> dict[str, object]:
    result = breakdown_from_row(row)
    value = result.as_dict()
    value["bucket"] = rate_bucket(result.total)
    return value


def is_zone_supported(zone: int | str) -> bool:
    try:
        return int(zone) in ZONE_BASE_RATES
    except (TypeError, ValueError):
        return False


def fallback_used(zone: int | str) -> bool:
    return not is_zone_supported(zone)


def service_available(service: str) -> bool:
    return service.lower() in SERVICE_MULTIPLIERS


def estimated_days(service: str, zone: int | str) -> int:
    normalized = _zone_or_fallback(zone)
    base = {"ground": 5, "priority": 3, "overnight": 1}[service.lower()]
    return base + max(0, normalized - 1)


def delivery_window(service: str, zone: int | str) -> tuple[int, int]:
    days = estimated_days(service, zone)
    return days, days + (1 if service.lower() == "ground" else 0)


def holiday_adjusted_window(service: str, zone: int | str, ship_date: date) -> tuple[int, int]:
    start, end = delivery_window(service, zone)
    if is_holiday(ship_date):
        start += 1
        end += 1
    return start, end


def explain(request: RateRequest) -> list[str]:
    result = _quote(request)
    return [
        "zone=%d" % result.zone,
        "band=%s" % result.weight_band,
        "service=%s" % result.service,
        "base=%0.2f" % result.base,
        "fuel=%0.2f" % result.fuel,
        "extras=%0.2f" % result.extras,
        "total=%0.2f" % result.total,
    ]


def as_legacy_tuple(breakdown: RateBreakdown) -> tuple[float, float, float]:
    return breakdown.total, breakdown.base, breakdown.extras


def from_legacy_tuple(values: tuple[float, float, float], zone: int = UNKNOWN_ZONE) -> RateBreakdown:
    total, base, extras = values
    fuel = round_money(total - base - extras)
    return RateBreakdown(total, base, fuel, extras, zone, "unknown", "ground", False)


def round_schedule(values: Iterable[float]) -> list[float]:
    return [round_money(value) for value in values]


def apply_discount(breakdown: RateBreakdown, percent: float) -> RateBreakdown:
    if not 0 <= percent <= 1:
        raise ValueError("discount must be between zero and one")
    total = round_money(breakdown.total * (1 - percent))
    return RateBreakdown(total, breakdown.base, breakdown.fuel, breakdown.extras, breakdown.zone, breakdown.weight_band, breakdown.service, breakdown.holiday, breakdown.currency)


def apply_credit(breakdown: RateBreakdown, credit: float) -> RateBreakdown:
    if credit < 0:
        raise ValueError("credit cannot be negative")
    return apply_discount(breakdown, min(1.0, credit / max(breakdown.total, 1.0)))


def parse_weight(text: str) -> float:
    value = float(text.strip())
    return _checked_weight(value)


def parse_zone(text: str) -> int:
    return _zone_or_fallback(text.strip())


def parse_service(text: str) -> str:
    value = text.strip().lower()
    _multiplier(value)
    return value


def supported_inputs() -> dict[str, tuple[str, ...]]:
    return {
        "zones": tuple(str(zone) for zone in sorted(ZONE_BASE_RATES)),
        "services": tuple(SERVICE_MULTIPLIERS),
        "bands": band_names(),
    }


def diagnostics() -> dict[str, object]:
    return {
        "version": rates_version(),
        "table_valid": check_table_order(),
        "catalog_problems": validate_catalog(),
        "inputs": supported_inputs(),
    }
