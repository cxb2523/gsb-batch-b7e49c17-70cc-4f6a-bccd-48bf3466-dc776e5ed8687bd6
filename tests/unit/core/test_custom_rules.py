# Copyright 2025 Secure Sauce LLC
# SPDX-License-Identifier: BUSL-1.1
"""Tests for custom rule loading and execution.

Covers the four cases:
  1. a legal custom rule is registered and produces a finding;
  2. rules missing required fields are rejected with an error message and
     are never registered;
  3. a rule whose language has no loaded parser falls back to the Basic
     parser while the unknown language is reported;
  4. a rule whose tree-sitter query raises at scan time produces an ERROR
     result (rule id ending in "000") without disturbing other rules or
     files.
"""
import logging

import pytest

from precli.core.artifact import Artifact
from precli.core.level import Level
from precli.core.run import CUSTOM_RULE_REQUIRED_FIELDS
from precli.core.run import Run
from precli.core.run import parsers
from precli.parsers.basic import Basic


def _python_rule(**overrides):
    """A valid Python custom rule with overridable fields."""
    rule = {
        "id": "PY901C",
        "name": "custom-insecure-verify",
        "language": "python",
        "description": "TLS certificate verification is disabled.",
        "cwe": 295,
        "severity": "error",
        "message": "Setting 'verify=False' disables SSL verification.",
        "query": (
            "(call"
            " function: (attribute object: (identifier) @module"
            " attribute: (identifier) @method)"
            " arguments: (argument_list"
            " (keyword_argument name: (identifier) @kw"
            " value: (false) @vuln_val)))"
            ' (#eq? @module "requests") (#eq? @kw "verify")'
        ),
        "location_node": "vuln_val",
    }
    rule.update(overrides)
    return rule


@pytest.fixture
def parser_guard():
    """Snapshot/restore the global parser registry around each test."""
    snapshot = {
        name: (parser, dict(parser.rules))
        for name, parser in parsers.items()
    }
    yield
    for name, parser in list(parsers.items()):
        if name not in snapshot:
            del parsers[name]
        else:
            original_parser, original_rules = snapshot[name]
            original_parser.rules = original_rules
            parsers[name] = original_parser


@pytest.fixture
def python_file(tmp_path):
    path = tmp_path / "sample.py"
    path.write_text("import requests\nrequests.get(url, verify=False)\n")
    return str(path)


class TestCustomRules:
    def test_valid_rule_is_registered_and_matches(
        self, parser_guard, python_file, caplog
    ):
        rule = _python_rule()
        run = Run(
            config={},
            artifacts=[Artifact(python_file)],
            debug=logging.DEBUG,
            custom_rules=[rule],
        )

        # The legal rule is attached to the python parser's rules dict.
        assert rule["name"] in parsers["python"].rules
        registered = parsers["python"].rules[rule["name"]]
        assert registered.id == rule["id"]
        assert registered.query == rule["query"]
        assert registered.location_node == rule["location_node"]

        run.invoke()
        matches = [r for r in run.results if r.rule_id == rule["id"]]
        assert len(matches) == 1
        result = matches[0]
        assert result.message == rule["message"]
        assert result.level == Level.ERROR
        assert result.location.start_line == 2
        # No errors should have been logged for a valid rule.
        assert not any(
            record.levelno >= logging.ERROR for record in caplog.records
        )

    @pytest.mark.parametrize("missing_field", CUSTOM_RULE_REQUIRED_FIELDS)
    def test_missing_required_field_is_rejected(
        self, parser_guard, python_file, caplog, missing_field
    ):
        rule = _python_rule(id="PY902C", name="custom-missing-field")
        del rule[missing_field]

        with caplog.at_level(logging.ERROR):
            run = Run(
                config={},
                artifacts=[Artifact(python_file)],
                debug=logging.ERROR,
                custom_rules=[rule],
            )

        # The defective rule must not be registered on any parser.
        assert all(
            "custom-missing-field" not in parser.rules
            for parser in parsers.values()
        )

        # A readable, locatable error message is recorded. It names the
        # rule (by name when the id field itself is missing) and the field.
        rule_reference = (
            rule["name"] if missing_field == "id" else rule["id"]
        )
        error_messages = [
            record.getMessage()
            for record in caplog.records
            if record.levelno >= logging.ERROR
        ]
        assert any(
            "missing required field" in message
            and missing_field in message
            and rule_reference in message
            for message in error_messages
        )

        # Scanning still works and never references the rejected rule.
        run.invoke()
        assert all(r.rule_id != "PY902C" for r in run.results)

    def test_unknown_language_falls_back_to_basic(
        self, parser_guard, tmp_path, caplog
    ):
        # "kotlin" has a tree-sitter module installed but is not among the
        # loaded precli.parsers entry points, so it is an unknown language.
        assert "kotlin" not in parsers

        rule = {
            "id": "KT901C",
            "name": "custom-kotlin-rule",
            "language": "kotlin",
            "description": "Rule targeting an unknown language.",
            "cwe": 295,
            "message": "Kotlin custom rule matched.",
            "query": "(identifier) @id",
            "location_node": "id",
        }
        kt_file = tmp_path / "sample.kt"
        kt_file.write_text('fun main() {\n    println("hello")\n}\n')

        with caplog.at_level(logging.ERROR):
            Run(
                config={},
                artifacts=[Artifact(str(kt_file))],
                debug=logging.ERROR,
                custom_rules=[rule],
            )

        # Existing fallback behaviour: a Basic parser is created and the
        # rule is still registered on it.
        assert "kotlin" in parsers
        assert isinstance(parsers["kotlin"], Basic)
        assert rule["name"] in parsers["kotlin"].rules
        assert parsers["kotlin"].rule_prefix() == "KO"

        # The unknown language must be visible in the diagnostics.
        assert any(
            "unknown language" in record.getMessage()
            and "kotlin" in record.getMessage()
            and "KT901C" in record.getMessage()
            for record in caplog.records
            if record.levelno >= logging.ERROR
        )

        # The Basic parser can still execute the rule's query.
        results = parsers["kotlin"].parse(Artifact(str(kt_file)), {})
        assert any(result.rule_id == "KT901C" for result in results)

    def test_query_exception_is_isolated_per_rule_and_file(
        self, parser_guard, tmp_path, caplog
    ):
        bad_rule = _python_rule(
            id="PY903C",
            name="custom-broken-query",
            message="this rule never produces a normal finding",
            # Syntactically invalid tree-sitter query (unterminated
            # predicate) -> QueryError when the file is scanned.
            query="((identifier) @id (#eq? @id",
        )
        good_rule = _python_rule(
            id="PY904C",
            name="custom-healthy-rule",
            severity="warning",
            message="the healthy rule still runs",
            query="(false) @v",
            location_node="v",
        )

        file_one = tmp_path / "one.py"
        file_one.write_text("requests.get(url, verify=False)\n")
        file_two = tmp_path / "two.py"
        file_two.write_text("flag = False\n")

        with caplog.at_level(logging.ERROR):
            run = Run(
                config={},
                artifacts=[
                    Artifact(str(file_one)),
                    Artifact(str(file_two)),
                ],
                debug=logging.ERROR,
                custom_rules=[bad_rule, good_rule],
            )
            run.invoke()

        # Every scanned file gets one ERROR result whose rule id is the
        # language prefix followed by "000".
        error_results = [
            result
            for result in run.results
            if result.level == Level.ERROR
            and result.rule_id == "PY000"
        ]
        assert len(error_results) == 2
        for result in error_results:
            assert bad_rule["id"] in result.message
            assert "QueryError" in result.message

        # The message identifies the failing rule id and exception type and
        # the same details are logged for the operator.
        assert any(
            bad_rule["id"] in record.getMessage()
            and "QueryError" in record.getMessage()
            for record in caplog.records
            if record.levelno >= logging.ERROR
        )

        # Other rules in the same files keep producing normal results.
        healthy = [r for r in run.results if r.rule_id == good_rule["id"]]
        assert len(healthy) == 2
        assert all(result.level == Level.WARNING for result in healthy)

        # The broken rule itself never emits a regular finding.
        assert not any(
            result.rule_id == bad_rule["id"] for result in run.results
        )
