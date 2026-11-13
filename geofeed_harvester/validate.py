from __future__ import annotations

from collections.abc import Iterable
from itertools import groupby

from geofeed_harvester.iso import valid_country, valid_region
from geofeed_harvester.models import RawGeofeedRow, ValidatedGeofeedRow


def validate_rows(
    rows: Iterable[RawGeofeedRow],
    fetched_at_by_url: dict[str, str],
    bgp_verdicts: dict[object, bool | None] | None = None,
    signature_verdicts: dict[str, bool] | None = None,
) -> list[ValidatedGeofeedRow]:
    bgp_verdicts = bgp_verdicts or {}
    signature_verdicts = signature_verdicts or {}
    candidates: list[ValidatedGeofeedRow] = []
    for row in rows:
        flags: list[str] = []
        if row.prefix.version != row.inetnum.version:
            flags.append("ip_version_mismatch")
        elif not row.prefix.subnet_of(row.inetnum):
            flags.append("outside_inetnum")
        if not valid_country(row.country):
            flags.append("invalid_country")
        if row.region and not valid_region(row.region.upper()):
            flags.append("invalid_region")

        if "outside_inetnum" in flags or "ip_version_mismatch" in flags:
            continue

        confidence = 0.55
        if not flags:
            confidence += 0.25
        bgp_valid = bgp_verdicts.get(row.prefix)
        if bgp_valid is True:
            confidence += 0.1
        elif bgp_valid is False:
            flags.append("bgp_not_announced")
            confidence -= 0.2
        signed = row.url in signature_verdicts
        signature_valid = bool(signature_verdicts.get(row.url, False))
        if signature_valid:
            confidence += 0.1
        elif signed:
            flags.append("invalid_signature")
            confidence -= 0.25

        candidates.append(
            ValidatedGeofeedRow(
                prefix=row.prefix,
                country=row.country,
                region=row.region.upper(),
                city=row.city,
                postal_code=row.postal_code,
                url=row.url,
                rir=row.rir,
                inetnum=row.inetnum,
                fetched_at=fetched_at_by_url.get(row.url, ""),
                signed=signed,
                signature_valid=signature_valid,
                bgp_valid=bgp_valid,
                confidence=confidence,
                flags=tuple(flags),
            )
        )

    return _prefer_most_specific_inetnum(candidates)


def _prefer_most_specific_inetnum(rows: list[ValidatedGeofeedRow]) -> list[ValidatedGeofeedRow]:
    winners: list[ValidatedGeofeedRow] = []
    ordered = sorted(
        rows,
        key=lambda r: (
            r.prefix.version,
            int(r.prefix.network_address),
            int(r.prefix.broadcast_address),
            -r.inetnum.prefixlen,
            -r.prefix.prefixlen,
        ),
    )
    for _, group in groupby(
        ordered,
        key=lambda r: (r.prefix.version, int(r.prefix.network_address), int(r.prefix.broadcast_address)),
    ):
        grouped = list(group)
        winner = grouped[0]
        if len(grouped) > 1:
            top = grouped[0]
            runner_up = grouped[1]
            if top.inetnum.prefixlen > runner_up.inetnum.prefixlen:
                winner = _with_flag(top, "overlap_more_specific_inetnum")
            elif top.prefix.prefixlen > runner_up.prefix.prefixlen:
                winner = _with_flag(top, "overlap_more_specific_prefix")
            else:
                winner = _with_flag(top, "overlap_conflict")
        winners.append(winner)
    return sorted(
        winners,
        key=lambda r: (r.prefix.version, int(r.prefix.network_address), r.prefix.prefixlen),
    )


def _with_flag(row: ValidatedGeofeedRow, flag: str) -> ValidatedGeofeedRow:
    flags = tuple(dict.fromkeys((*row.flags, flag)))
    return ValidatedGeofeedRow(
        prefix=row.prefix,
        country=row.country,
        region=row.region,
        city=row.city,
        postal_code=row.postal_code,
        url=row.url,
        rir=row.rir,
        inetnum=row.inetnum,
        fetched_at=row.fetched_at,
        signed=row.signed,
        signature_valid=row.signature_valid,
        bgp_valid=row.bgp_valid,
        confidence=max(row.confidence - 0.15, 0.0),
        flags=flags,
    )
