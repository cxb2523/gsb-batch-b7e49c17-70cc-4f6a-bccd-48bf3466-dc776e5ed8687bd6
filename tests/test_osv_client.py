#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Technology Innovation Institute (TII)
#
# SPDX-License-Identifier: Apache-2.0

"""Focused tests for the reusable OSV client."""

import json
import logging

from vulnxscan import osv_client
from vulnxscan.osv_client import OSV


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


class FakeSession:
    def __init__(self):
        self.calls = []

    def post(self, url, json=None, timeout=None):
        self.calls.append((url, json, timeout))
        return FakeResponse(
            {
                "results": [
                    {
                        "vulns": [
                            {
                                "id": "OSV-1",
                                "modified": "2024-01-01",
                            }
                        ]
                    }
                ]
            }
        )


class RecordingSession:
    """Fake session returning payloads derived from each batch's queries."""

    def __init__(self, responder=None):
        self.calls = []
        self._responder = responder or (
            lambda queries: {"results": [{} for _ in queries]}
        )

    def post(self, url, json=None, timeout=None):
        self.calls.append({"url": url, "query": json, "timeout": timeout})
        return FakeResponse(self._responder(json["queries"]))


def _write_sbom(path, components, metadata=None):
    if metadata is None:
        metadata = {"name": "root", "version": "3.0", "bom-ref": "ref-root"}
    path.write_text(
        json.dumps(
            {
                "metadata": {"component": metadata},
                "components": components,
            }
        ),
        encoding="utf-8",
    )


def _batch_queries(session):
    return [
        [
            (query["package"]["name"], query["package"]["ecosystem"])
            for query in call["query"]["queries"]
        ]
        for call in session.calls
    ]


def test_osv_client_posts_with_timeout_and_parses_results(tmp_path):
    sbom_path = tmp_path / "sbom.json"
    sbom_path.write_text(
        ('{"metadata":{"component":{"name":"hello","version":"1.0"}},"components":[]}'),
        encoding="utf-8",
    )

    session = FakeSession()
    osv = OSV(session=session, request_timeout=17)

    osv.query_vulns(sbom_path.as_posix(), ecosystems=["GIT"])

    assert session.calls == [
        (
            "https://api.osv.dev/v1/querybatch",
            {
                "queries": [
                    {
                        "version": "1.0",
                        "package": {
                            "name": "hello",
                            "ecosystem": "GIT",
                        },
                    }
                ]
            },
            17,
        )
    ]
    assert osv.to_dataframe().to_dict(orient="records") == [
        {
            "vuln_id": "OSV-1",
            "modified": "2024-01-01",
            "package": "hello",
            "version": "1.0",
            "component_ref": "",
        }
    ]


def test_osv_client_binds_results_to_each_component_query(tmp_path):
    sbom_path = tmp_path / "sbom.json"
    components = [
        {"name": "alpha", "version": "1.0", "bom-ref": "ref-alpha"},
        {"name": "beta", "version": "2.0", "bom-ref": "ref-beta"},
    ]
    _write_sbom(sbom_path, components)

    def responder(queries):
        return {
            "results": [
                {
                    "vulns": [
                        {
                            "id": f"OSV-{q['package']['name']}-{q['package']['ecosystem']}",
                            "modified": "2024-01-01",
                        }
                    ]
                }
                for q in queries
            ]
        }

    session = RecordingSession(responder)
    osv = OSV(session=session)

    # Default ecosystems (GIT, OSS-Fuzz) apply when none are passed.
    osv.query_vulns(sbom_path.as_posix())

    # Components are sorted by name: alpha, beta, root.
    assert _batch_queries(session) == [
        [
            ("alpha", "GIT"),
            ("alpha", "OSS-Fuzz"),
            ("beta", "GIT"),
            ("beta", "OSS-Fuzz"),
            ("root", "GIT"),
            ("root", "OSS-Fuzz"),
        ]
    ]

    expected = {
        ("alpha", "1.0", "ref-alpha", "OSV-alpha-GIT"),
        ("alpha", "1.0", "ref-alpha", "OSV-alpha-OSS-Fuzz"),
        ("beta", "2.0", "ref-beta", "OSV-beta-GIT"),
        ("beta", "2.0", "ref-beta", "OSV-beta-OSS-Fuzz"),
        ("root", "3.0", "ref-root", "OSV-root-GIT"),
        ("root", "3.0", "ref-root", "OSV-root-OSS-Fuzz"),
    }
    records = osv.to_dataframe().to_dict(orient="records")
    assert {
        (
            record["package"],
            record["version"],
            record["component_ref"],
            record["vuln_id"],
        )
        for record in records
    } == expected


def test_osv_client_keeps_component_queries_in_one_batch_beyond_limit(tmp_path):
    sbom_path = tmp_path / "sbom.json"
    components = [
        {"name": f"pkg-{index:04d}", "version": "1.0", "bom-ref": f"ref-{index}"}
        for index in range(399)
    ]
    # 399 components plus the metadata component: 400 * 3 = 1200 queries.
    _write_sbom(sbom_path, components)
    ecosystems = ["GIT", "OSS-Fuzz", "PyPI"]

    session = RecordingSession()
    osv = OSV(session=session)
    osv.query_vulns(sbom_path.as_posix(), ecosystems=ecosystems)

    batches = _batch_queries(session)
    assert sum(len(batch) for batch in batches) == 1200
    # No batch is split at the limit in the middle of a component's queries.
    assert [len(batch) for batch in batches] == [999, 201]

    component_batches = {}
    for batch_index, batch in enumerate(batches):
        for name, ecosystem in batch:
            component_batches.setdefault(name, []).append((batch_index, ecosystem))

    assert len(component_batches) == 400
    for name, entries in component_batches.items():
        batch_indices = {batch_index for batch_index, _ in entries}
        assert len(batch_indices) == 1, f"{name} leaked across batches: {entries}"
        assert {ecosystem for _, ecosystem in entries} == set(ecosystems)


def test_osv_client_logs_components_skipped_for_missing_version(tmp_path, caplog):
    sbom_path = tmp_path / "sbom.json"
    components = [
        {"name": "has-version", "version": "1.0", "bom-ref": "ref-has-version"},
        {"name": "no-version", "bom-ref": "ref-no-version"},
        {"name": "empty-version", "version": "", "bom-ref": "ref-empty-version"},
    ]
    _write_sbom(sbom_path, components)

    session = RecordingSession()
    osv = OSV(session=session)

    with caplog.at_level(logging.WARNING, logger=osv_client.LOG.name):
        osv.query_vulns(sbom_path.as_posix(), ecosystems=["GIT"])

    assert _batch_queries(session) == [[("has-version", "GIT"), ("root", "GIT")]]
    # Queried-but-clean components produce no rows; skipped ones are not queried.
    assert osv.to_dataframe().empty

    assert "skipping osv query (unknown version): no-version" in caplog.text
    assert "skipping osv query (unknown version): empty-version" in caplog.text


def test_osv_client_missing_results_do_not_shift_later_results(tmp_path):
    sbom_path = tmp_path / "sbom.json"
    components = [
        {"name": "alpha", "version": "1.0", "bom-ref": "ref-alpha"},
        {"name": "beta", "version": "2.0", "bom-ref": "ref-beta"},
    ]
    _write_sbom(sbom_path, components)

    def responder(queries):
        # Two results for three queries. The first result is empty (queried,
        # no vulnerabilities); the second belongs to the second query. The
        # missing third result must stay missing, not receive anything.
        assert len(queries) == 3
        return {
            "results": [
                {},
                {
                    "vulns": [
                        {
                            "id": "OSV-beta",
                            "modified": "2024-01-01",
                        }
                    ]
                },
            ]
        }

    session = RecordingSession(responder)
    osv = OSV(session=session)
    osv.query_vulns(sbom_path.as_posix(), ecosystems=["GIT"])

    assert _batch_queries(session) == [
        [("alpha", "GIT"), ("beta", "GIT"), ("root", "GIT")]
    ]
    assert osv.to_dataframe().to_dict(orient="records") == [
        {
            "vuln_id": "OSV-beta",
            "modified": "2024-01-01",
            "package": "beta",
            "version": "2.0",
            "component_ref": "ref-beta",
        }
    ]
