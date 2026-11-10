import httpx

BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"


def predictions(station: str, date: str) -> dict:
    """Return tide predictions for one station and day."""
    r = httpx.get(BASE, params={"station": station, "begin_date": date, "range": 24,
                                "product": "predictions", "format": "json", "units": "metric",
                                "time_zone": "gmt", "datum": "MLLW"})
    r.raise_for_status()
    return r.json()
