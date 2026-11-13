"""The boundaries of the NVD matching chain, pinned with local samples.

The scanner records a camera's vendor, model and version, then asks an NVD 2.0
feed whether a range covers them. Every case here runs from a fabricated feed
and a fabricated `cpe_map.yaml` written into `tmp_path`: no network, no
device, no NVD API. What is pinned is the boundary, not one happy path:

- an unknown version is covered only by a pattern that states no range at all,
  and never by one that carries versionStart/versionEnd bounds;
- the firmware retry applies to a model the feed carries only as
  `<model>_firmware`, and a model the feed carries in neither form matches
  nothing rather than inventing a hit;
- the `matched_range` a finding carries is the range that actually covered the
  device, not the device's version repeated;
- version segments compare numerically, so 1.10 sorts after 1.9.
"""

import json
from pathlib import Path

import pytest

from scanners.vuln_probe import (
    CpeMap,
    CpeVersion,
    CveFeed,
    DeviceFingerprint,
    VulnProbe,
)

_HOST = "127.0.0.1"
_PORT = 554
_CVSS = 9.8
_VENDOR = "hikvision"
# The product string a scan reports, and the CPE product the map gives for it.
_PRODUCT = "Hikvision IP camera"
_MAPPED = "ip_camera"
# The model a camera banner reports; NVD hangs the range on its firmware CPE.
_MODEL = "ds-2cd2032-i"
_OTHER_MODEL = "ds-2cd2142fwd-i"
_UNBOUNDED_ID = "CVE-2021-36260"
_BOUNDED_ID = "CVE-2021-9999"
_FIRMWARE_ID = "CVE-2017-7921"
_EXACT_ID = "CVE-2017-0001"
_ORDER_ID = "CVE-2021-0001"
_BOUNDED_RANGE = ">=5.0.0, <5.5.0"
_IN_RANGE_VERSION = "5.4.5"


def _match(product: str, version: str = "*", **bounds: str) -> dict:
    """One NVD cpeMatch node for a hikvision product, as the feed would carry it."""
    node = {
        "vulnerable": True,
        "criteria": f"cpe:2.3:o:{_VENDOR}:{product}:{version}:*:*:*:*:*:*:*",
    }
    node.update(bounds)
    return node


def _cve(cve_id: str, *matches: dict, score: float = _CVSS) -> dict:
    """One NVD 2.0 vulnerability record, reduced to what matching reads."""
    return {
        "cve": {
            "id": cve_id,
            "descriptions": [{"lang": "en", "value": f"{cve_id} sample"}],
            "metrics": {
                "cvssMetricV31": [
                    {
                        "type": "Primary",
                        "cvssData": {"version": "3.1", "baseScore": score},
                    }
                ]
            },
            "configurations": [
                {"nodes": [{"operator": "OR", "cpeMatch": list(matches)}]}
            ],
        }
    }


def _cpe_map_yaml(products: dict[str, str] | None = None) -> str:
    """A cpe_map.yaml body; json.dumps keeps the product strings quoted."""
    if not products:
        return "products: {}\n"
    lines = ["products:"]
    lines += [
        f"  {json.dumps(name)}: {json.dumps(pair)}" for name, pair in products.items()
    ]
    return "\n".join(lines) + "\n"


def _probe(
    tmp_path: Path, records: list[dict], products: dict[str, str] | None = None
) -> VulnProbe:
    """A probe over a fabricated feed and map, both local files in tmp_path."""
    feed_path = tmp_path / "nvdcve-2.0-sample.json"
    feed_path.write_text(
        json.dumps({"format": "NVD_CVE", "version": "2.0", "vulnerabilities": records}),
        encoding="utf-8",
    )
    map_path = tmp_path / "cpe_map.yaml"
    map_path.write_text(_cpe_map_yaml(products), encoding="utf-8")
    return VulnProbe(CveFeed(str(feed_path)), CpeMap(str(map_path)))


def _mapped_probe(tmp_path: Path, records: list[dict]) -> VulnProbe:
    """A probe whose map reaches the hikvision:ip_camera pair."""
    return _probe(tmp_path, records, {_PRODUCT: f"{_VENDOR}:{_MAPPED}"})


def _device(**fields) -> DeviceFingerprint:
    return DeviceFingerprint(host=_HOST, port=_PORT, **fields)


# --- An unknown version ------------------------------------------------------


def test_an_unknown_version_is_covered_by_a_pattern_with_no_range(
    tmp_path: Path,
) -> None:
    """The unbounded pattern covers; the bounded one in the same feed does not."""
    probe = _mapped_probe(
        tmp_path,
        [
            _cve(_UNBOUNDED_ID, _match(_MAPPED)),
            _cve(
                _BOUNDED_ID,
                _match(
                    _MAPPED,
                    versionStartIncluding="5.0.0",
                    versionEndExcluding="5.5.0",
                ),
            ),
        ],
    )

    found = probe.match(_device(product=_PRODUCT))

    assert [cve_match.cve_id for cve_match in found] == [_UNBOUNDED_ID], (
        f"only the unbounded pattern may cover an unknown version, got {found}"
    )
    assert [cve_match.matched_range for cve_match in found] == [""], (
        f"an unbounded pattern carries no range text, got {found}"
    )


_BOUND_KINDS = (
    {"versionStartIncluding": "5.0.0"},
    {"versionStartExcluding": "5.0.0"},
    {"versionEndIncluding": "5.5.0"},
    {"versionEndExcluding": "5.5.0"},
    {"versionStartIncluding": "5.0.0", "versionEndExcluding": "5.5.0"},
)


@pytest.mark.parametrize(
    "bounds",
    _BOUND_KINDS,
    ids=[", ".join(sorted(kind)) for kind in _BOUND_KINDS],
)
def test_a_bounded_range_never_covers_an_unknown_version(
    tmp_path: Path, bounds: dict
) -> None:
    """Any versionStart/versionEnd bound is a range an unknown version cannot sit in."""
    probe = _mapped_probe(tmp_path, [_cve(_BOUNDED_ID, _match(_MAPPED, **bounds))])

    found = probe.match(_device(product=_PRODUCT))

    assert found == [], (
        f"a bounded range must not cover an unknown version, got {found}"
    )


def test_an_exact_version_pattern_never_covers_an_unknown_version(
    tmp_path: Path,
) -> None:
    """A pattern that names one version is a range of one, so it does not cover."""
    probe = _mapped_probe(tmp_path, [_cve(_EXACT_ID, _match(_MAPPED, version="4.0.0"))])

    found = probe.match(_device(product=_PRODUCT))

    assert found == [], f"an exact version is not an unbounded pattern, got {found}"


# --- The firmware retry -------------------------------------------------------


def test_a_model_the_feed_carries_only_as_firmware_is_retried_as_firmware(
    tmp_path: Path,
) -> None:
    """The model alone is not a product NVD knows: the range is on its firmware."""
    probe = _probe(
        tmp_path,
        [
            _cve(
                _FIRMWARE_ID,
                _match(
                    f"{_MODEL}_firmware",
                    versionStartIncluding="5.0.0",
                    versionEndExcluding="5.5.0",
                ),
            )
        ],
    )

    found = probe.match(
        _device(vendor=_VENDOR, product=_MODEL, version=_IN_RANGE_VERSION)
    )

    assert [cve_match.cve_id for cve_match in found] == [_FIRMWARE_ID], (
        f"the firmware CPE of the model is the one the range names, got {found}"
    )
    assert [cve_match.matched_range for cve_match in found] == [_BOUNDED_RANGE], (
        f"the range comes from the firmware record, got {found}"
    )


def test_the_firmware_retry_runs_on_the_pair_the_cpe_map_gives(
    tmp_path: Path,
) -> None:
    """A mapped product the feed carries only as `<product>_firmware` is retried."""
    probe = _mapped_probe(
        tmp_path,
        [
            _cve(
                _FIRMWARE_ID,
                _match(
                    f"{_MAPPED}_firmware",
                    versionStartIncluding="5.0.0",
                    versionEndExcluding="5.5.0",
                ),
            )
        ],
    )

    found = probe.match(_device(product=_PRODUCT, version=_IN_RANGE_VERSION))

    assert [cve_match.cve_id for cve_match in found] == [_FIRMWARE_ID], (
        f"the retry adds the one suffix NVD uses, got {found}"
    )
    assert [cve_match.matched_range for cve_match in found] == [_BOUNDED_RANGE], (
        f"the range comes from the firmware record, got {found}"
    )


def test_an_unknown_version_still_reaches_an_unbounded_firmware_pattern(
    tmp_path: Path,
) -> None:
    """The retry and the unknown-version rule compose: unbounded still covers."""
    probe = _probe(tmp_path, [_cve(_FIRMWARE_ID, _match(f"{_MODEL}_firmware"))])

    found = probe.match(_device(vendor=_VENDOR, product=_MODEL))

    assert [cve_match.cve_id for cve_match in found] == [_FIRMWARE_ID], (
        f"the firmware pattern states no range, so it covers, got {found}"
    )


def test_a_model_the_feed_carries_in_neither_form_matches_nothing(
    tmp_path: Path,
) -> None:
    """The retry adds one product name; it does not invent a match."""
    probe = _probe(tmp_path, [_cve(_FIRMWARE_ID, _match(_OTHER_MODEL))])

    found = probe.match(
        _device(vendor=_VENDOR, product=_MODEL, version=_IN_RANGE_VERSION)
    )

    assert found == [], (
        f"neither {_MODEL} nor {_MODEL}_firmware is in the feed, got {found}"
    )


def test_the_firmware_retry_does_not_run_when_the_feed_carries_the_model_itself(
    tmp_path: Path,
) -> None:
    """The retry is for a pair the feed does not carry, not for a range that misses."""
    probe = _mapped_probe(
        tmp_path,
        [
            _cve(_EXACT_ID, _match(_MAPPED, version="4.0.0")),
            _cve(
                _FIRMWARE_ID,
                _match(
                    f"{_MAPPED}_firmware",
                    versionStartIncluding="5.0.0",
                    versionEndExcluding="5.5.0",
                ),
            ),
        ],
    )

    found = probe.match(_device(product=_PRODUCT, version=_IN_RANGE_VERSION))

    assert found == [], (
        "the model is in the feed, so it is not 'only as firmware' "
        f"and the retry must not run, got {found}"
    )


def test_a_banner_that_reports_the_model_in_another_case_still_reaches_the_feed(
    tmp_path: Path,
) -> None:
    """The feed is indexed by lower-case CPE fields, so the pair is normalised."""
    probe = _probe(tmp_path, [_cve(_FIRMWARE_ID, _match(f"{_MODEL}_firmware"))])

    found = probe.match(
        _device(vendor="Hikvision", product="DS-2CD2032-I", version=" 5.4.5 ")
    )

    assert [cve_match.cve_id for cve_match in found] == [_FIRMWARE_ID], (
        f"the same model in another case names the same CPE, got {found}"
    )


# --- matched_range ------------------------------------------------------------


def test_the_reported_range_is_the_one_that_covered_the_device(
    tmp_path: Path,
) -> None:
    """One record, two ranges: the finding carries the range that matched."""
    probe = _mapped_probe(
        tmp_path,
        [
            _cve(
                _BOUNDED_ID,
                _match(
                    _MAPPED,
                    versionStartIncluding="4.0.0",
                    versionEndExcluding="5.0.0",
                ),
                _match(
                    _MAPPED,
                    versionStartIncluding="5.0.0",
                    versionEndExcluding="5.5.0",
                ),
            )
        ],
    )

    found = probe.match(_device(product=_PRODUCT, version=_IN_RANGE_VERSION))

    assert [cve_match.matched_range for cve_match in found] == [_BOUNDED_RANGE], (
        f"5.4.5 sits in the second range, got {[cve_match.matched_range for cve_match in found]}"
    )
    assert _IN_RANGE_VERSION not in found[0].matched_range, (
        f"the range is the record's, not the device version, got {found[0].matched_range!r}"
    )


def test_an_exact_version_match_reports_the_pattern_version(tmp_path: Path) -> None:
    """A pattern that names one version reports that version as the range."""
    probe = _mapped_probe(tmp_path, [_cve(_EXACT_ID, _match(_MAPPED, version="4.0.0"))])

    found = probe.match(_device(product=_PRODUCT, version="4.0.0"))

    assert [cve_match.matched_range for cve_match in found] == ["4.0.0"], (
        f"the pattern names one version, got {[cve_match.matched_range for cve_match in found]}"
    )


_RANGE_ENDPOINTS = (
    ({"versionStartIncluding": "5.0.0"}, ">=5.0.0"),
    ({"versionStartExcluding": "5.0.0"}, ">5.0.0"),
    ({"versionEndIncluding": "5.5.0"}, "<=5.5.0"),
    ({"versionEndExcluding": "5.5.0"}, "<5.5.0"),
)


@pytest.mark.parametrize(
    ("bounds", "expected"),
    _RANGE_ENDPOINTS,
    ids=[expected for _bounds, expected in _RANGE_ENDPOINTS],
)
def test_the_range_text_names_only_the_endpoints_the_record_wrote(
    tmp_path: Path, bounds: dict, expected: str
) -> None:
    """The reported range is built from the record's endpoints, nothing else."""
    probe = _mapped_probe(tmp_path, [_cve(_BOUNDED_ID, _match(_MAPPED, **bounds))])

    found = probe.match(_device(product=_PRODUCT, version="5.4.0"))

    assert [cve_match.matched_range for cve_match in found] == [expected], (
        f"the endpoint the record wrote is the range text, got {found}"
    )


# --- Version ordering ----------------------------------------------------------


def test_a_two_digit_segment_sorts_after_a_one_digit_segment() -> None:
    """1.10 sorts after 1.9: segments compare as numbers, not as text."""
    assert CpeVersion("1.9").is_below(CpeVersion("1.10"))
    assert not CpeVersion("1.10").is_below(CpeVersion("1.9"))


def test_numeric_and_text_segments_keep_one_total_order() -> None:
    """A digit sorts before text, so a mixed key still has one order."""
    assert CpeVersion("1.0.1").is_below(CpeVersion("1.0.a"))
    assert CpeVersion("1.0.1").is_below(CpeVersion("1.0.1a"))
    assert CpeVersion("1.0.1a").is_below(CpeVersion("1.0.1b"))


def test_a_range_endpoint_compares_1_10_after_1_9(tmp_path: Path) -> None:
    """The segment order is what a range endpoint applies: 1.9 in, 1.10 out."""
    probe = _mapped_probe(
        tmp_path,
        [
            _cve(
                _ORDER_ID,
                _match(
                    _MAPPED,
                    versionStartIncluding="1.9",
                    versionEndExcluding="1.10",
                ),
            )
        ],
    )

    assert [
        cve_match.cve_id
        for cve_match in probe.match(_device(product=_PRODUCT, version="1.9"))
    ] == [_ORDER_ID], "1.9 sits inside >=1.9, <1.10"
    assert probe.match(_device(product=_PRODUCT, version="1.10")) == [], (
        "1.10 is the excluded end, not a value below 1.9"
    )
