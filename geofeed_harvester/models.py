from __future__ import annotations

from dataclasses import dataclass, field
from ipaddress import IPv4Network, IPv6Network
from typing import Literal

IPNetwork = IPv4Network | IPv6Network


@dataclass(frozen=True)
class InetnumRef:
    rir: str
    inetnum: IPNetwork
    url: str
    source: str


@dataclass(frozen=True)
class RawGeofeedRow:
    prefix: IPNetwork
    country: str
    region: str
    city: str
    postal_code: str
    url: str
    inetnum: IPNetwork
    rir: str


@dataclass(frozen=True)
class ValidatedGeofeedRow:
    prefix: IPNetwork
    country: str
    region: str
    city: str
    postal_code: str
    url: str
    rir: str
    inetnum: IPNetwork
    fetched_at: str
    signed: bool = False
    signature_valid: bool = False
    bgp_valid: bool | None = None
    confidence: float = 0.5
    flags: tuple[str, ...] = field(default_factory=tuple)

    def csv_fields(self) -> list[str]:
        return [
            str(self.prefix),
            self.country,
            self.region,
            self.city,
            self.postal_code,
            self.rir,
            str(self.inetnum),
            self.url,
            self.fetched_at,
            str(self.signed).lower(),
            str(self.signature_valid).lower(),
            "" if self.bgp_valid is None else str(self.bgp_valid).lower(),
            f"{self.confidence:.2f}",
            ";".join(self.flags),
        ]

    def json_dict(self) -> dict[str, object]:
        return {
            "prefix": str(self.prefix),
            "country": self.country,
            "region": self.region,
            "city": self.city,
            "postal_code": self.postal_code,
            "rir": self.rir,
            "inetnum": str(self.inetnum),
            "url": self.url,
            "fetched_at": self.fetched_at,
            "signed": self.signed,
            "signature_valid": self.signature_valid,
            "bgp_valid": self.bgp_valid,
            "confidence": self.confidence,
            "flags": list(self.flags),
        }


FetchStatus = Literal["fetched", "not_modified", "failed"]
