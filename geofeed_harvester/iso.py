from __future__ import annotations

import re
from functools import lru_cache

COUNTRY_RE = re.compile(r"^[A-Z]{2}$")
REGION_RE = re.compile(r"^$|^[A-Z]{2}-[A-Z0-9]{1,3}$")


@lru_cache(maxsize=1)
def _country_codes() -> set[str] | None:
    try:
        import pycountry
    except ImportError:
        return None
    return {country.alpha_2 for country in pycountry.countries}


@lru_cache(maxsize=1)
def _subdivision_codes() -> set[str] | None:
    try:
        import pycountry
    except ImportError:
        return None
    return {subdivision.code for subdivision in pycountry.subdivisions}


def valid_country(code: str) -> bool:
    code = code.upper()
    countries = _country_codes()
    if countries is None:
        return bool(COUNTRY_RE.fullmatch(code))
    return code in countries


def valid_region(code: str) -> bool:
    code = code.upper()
    if not code:
        return True
    subdivisions = _subdivision_codes()
    if subdivisions is None:
        return bool(REGION_RE.fullmatch(code))
    return code in subdivisions
