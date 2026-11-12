import base64
import logging
from collections.abc import Callable

import msgpack
import pytest
from fakes import ONLINE_MONEY, TOTAL_MONEY, FakeAlgod, FakeIndexer

from pposdex import inequality_idx as idx
from pposdex import ppos_dex_data as pposdex
from pposdex.helpers import Account, Json, PPoSDexError
from pposdex.ppos_dex_data import PPoSDexData

PUBLISHER = "PUBLISHER"


def b64(note: bytes) -> str:
    return base64.b64encode(note).decode()


class TestPost:
    def test_computes_and_publishes(
        self,
        algod: FakeAlgod,
        indexer: FakeIndexer,
        publisher: Account,
        make_holders: Callable[[int], list[Json]],
    ) -> None:
        indexer.holders = make_holders(300)
        data = pposdex.post_ppos_dex_data(algod, indexer, publisher, 1000)

        stakes = [h["amount"] for h in indexer.holders if h["amount"] > 10**9]
        online = sorted(
            h["amount"]
            for h in indexer.holders
            if h["amount"] > 10**9 and h["status"] == "Online"
        )
        assert data["accounts"] == len(stakes)
        assert data["algo_dynamics"] == TOTAL_MONEY / pposdex.MICROALGO_TOTAL_SUPPLY
        assert data["ppos_online_stake"] == ONLINE_MONEY / TOTAL_MONEY
        assert data["ppos_online_accounts"] == len(online) / len(stakes)
        assert data["algo_hhi"] == idx.herfindahl_hirschman(stakes)
        assert data["ppos_gini"] == idx.gini(online)
        assert data["ppos_theil_l"] == idx.theil_l(online)
        assert data["ppos_theil_t"] == idx.theil_t(online)
        assert data["ppos_hhi"] == idx.herfindahl_hirschman(online)
        # Fake accounts share no keys: every account is its own operator
        v3 = {
            name: idx.nakamoto_coefficient(online, share)
            for name, share in pposdex.V3_SHARES.items()
        }
        assert data["ppos_dex_v3_veto"] == data["ppos_dex_v3_veto_operators"]
        assert data["ppos_dex_v3_veto"] == v3["veto"]
        assert data["ppos_dex_v3_liveness"] == v3["liveness"]
        assert data["ppos_dex_v3_nakamoto"] == v3["nakamoto"]
        assert data["ppos_dex_v3_upgrade"] == v3["upgrade"]
        assert data["ppos_dex_v3_upgrade_operators"] == v3["upgrade"]
        # The coefficients grow with their thresholds
        assert v3["veto"] <= v3["liveness"] <= v3["nakamoto"] <= v3["upgrade"]
        assert data["round"] == 1000
        # The published note is the same data point, msgpack encoded
        (signed,) = algod.sent
        assert msgpack.unpackb(signed.transaction.note) == data

    def test_invalid_data_is_not_published(
        self,
        algod: FakeAlgod,
        indexer: FakeIndexer,
        publisher: Account,
        make_holders: Callable[[int], list[Json]],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        indexer.holders = make_holders(30)
        monkeypatch.setattr(pposdex, "MICROALGO_TOTAL_SUPPLY", -1)
        with pytest.raises(pposdex.InvalidDataError, match="algo_dynamics"):
            pposdex.post_ppos_dex_data(algod, indexer, publisher, 1000)
        assert not algod.sent


def account(
    address: str, amount: int, auth: str | None = None, window: int | None = None
) -> Json:
    keys = (
        {"vote-first-valid": window, "vote-last-valid": window + 100}
        if window
        else None
    )
    return {
        "address": address,
        "amount": amount,
        "auth-addr": auth,
        "participation": keys,
    }


def test_operator_stakes() -> None:
    accounts = [
        account("A", 1, auth="X"),
        account("B", 2, auth="X"),
        account("C", 4, window=10),
        account("D", 8, window=10),
        account("E", 16),
        # Rekeyed elsewhere, but registered with C and D
        account("F", 32, auth="Y", window=10),
        account("G", 64, window=20),
    ]
    assert sorted(pposdex.operator_stakes(accounts)) == [3, 16, 44, 64]


class TestGet:
    def test_reads_valid_data_for_threshold(
        self,
        indexer: FakeIndexer,
        make_data_point: Callable[..., PPoSDexData],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        caplog.set_level(logging.DEBUG, logger="pposdex")
        latest = make_data_point(timestamp="2026-11-02 00:00:00.000000")
        oldest = make_data_point(timestamp="2026-11-01 00:00:00.000000")
        noise, incomplete = b"noise", msgpack.packb({"ppos_dex": 2.0})
        other_threshold = msgpack.packb(make_data_point(algo_threshold=1))
        indexer.notes[PUBLISHER] = [
            msgpack.packb(latest),
            noise,
            incomplete,
            other_threshold,
            msgpack.packb(oldest),
        ]

        result = pposdex.get_ppos_dex_data(indexer, PUBLISHER, 1000, 1, 2)

        # Valid data points stay in chain return order
        assert result.data_points == [latest, oldest]
        assert indexer.requests[0]["min_round"] == 1
        # Every note has a traceable disposition, in chain order
        assert [disposition.status for disposition in result.dispositions] == [
            pposdex.NoteStatus.VALID,
            pposdex.NoteStatus.UNDECODABLE,
            pposdex.NoteStatus.INVALID,
            pposdex.NoteStatus.FILTERED,
            pposdex.NoteStatus.VALID,
        ]
        assert [disposition.note for disposition in result.dispositions] == [
            b64(note) for note in indexer.notes[PUBLISHER]
        ]
        summary = result.summary
        assert summary.valid_data_points == 2
        assert summary.invalid_notes == 1
        assert summary.undecodable_notes == 1
        assert summary.threshold_filtered_notes == 1
        assert summary.total_notes == 5
        skipped = [m for m in caplog.messages if m.startswith("Skipping note")]
        assert skipped == [
            f"Skipping note {b64(noise)}: unpack(b) received extra data.",
            f"Skipping note {b64(incomplete)}: Missing key: algo_threshold",
        ]
        # Threshold filtering is a disposition, not an error
        filtered = [m for m in caplog.messages if m.startswith("Filtering note")]
        assert filtered == [
            f"Filtering note {b64(other_threshold)}: algo_threshold 1 != requested 1000"
        ]

    def test_legacy_and_unknown_keys_are_valid(
        self,
        indexer: FakeIndexer,
        make_data_point: Callable[..., PPoSDexData],
    ) -> None:
        legacy = make_data_point(ppos_dex_v3=7, ppos_dex_v3_operators=3)
        newer = make_data_point(unknown_key="ignored")
        indexer.notes[PUBLISHER] = [
            msgpack.packb(legacy),
            msgpack.packb(newer),
        ]

        result = pposdex.get_ppos_dex_data(indexer, PUBLISHER, 1000, 1)

        assert result.summary.valid_data_points == 2
        assert result.data_points[0]["ppos_dex_v3_liveness"] == 7
        assert result.data_points[0]["ppos_dex_v3_liveness_operators"] == 3
        assert "ppos_dex_v3" not in result.data_points[0]
        assert "unknown_key" not in result.data_points[1]

    @pytest.mark.parametrize(
        "note",
        [b"noise", b""],
        ids=["extra_data", "empty"],
    )
    def test_undecodable_notes_are_counted(
        self,
        indexer: FakeIndexer,
        make_data_point: Callable[..., PPoSDexData],
        note: bytes,
    ) -> None:
        indexer.notes[PUBLISHER] = [note, msgpack.packb(make_data_point())]

        result = pposdex.get_ppos_dex_data(indexer, PUBLISHER, 1000, 1)

        assert result.dispositions[0].status == pposdex.NoteStatus.UNDECODABLE
        assert result.summary.undecodable_notes == 1
        assert result.summary.valid_data_points == 1

    def test_no_valid_data_reports_publisher_block_and_counts(
        self, indexer: FakeIndexer, make_data_point: Callable[..., PPoSDexData]
    ) -> None:
        indexer.notes[PUBLISHER] = [
            b"noise",
            msgpack.packb({"ppos_dex": 2.0}),
            msgpack.packb(make_data_point(algo_threshold=1)),
        ]
        with pytest.raises(PPoSDexError) as err:
            pposdex.get_ppos_dex_data(indexer, PUBLISHER, 1000, 4242)
        message = str(err.value)
        # The message must locate the failed read, not just say "no data"
        assert PUBLISHER in message
        assert "4242" in message
        assert "1000" in message
        assert "schema invalid: 1" in message
        assert "undecodable: 1" in message
        assert "threshold filtered: 1" in message

    def test_only_invalid_notes(
        self, indexer: FakeIndexer, make_data_point: Callable[..., PPoSDexData]
    ) -> None:
        bad_type: dict[str, object] = dict(make_data_point())
        bad_type["accounts"] = 1.5
        out_of_range: dict[str, object] = dict(make_data_point())
        out_of_range["ppos_gini"] = 1.1
        missing_key: dict[str, object] = dict(make_data_point())
        del missing_key["timestamp"]
        indexer.notes[PUBLISHER] = [
            msgpack.packb(bad_type),
            msgpack.packb(out_of_range),
            msgpack.packb(missing_key),
        ]
        with pytest.raises(PPoSDexError) as err:
            pposdex.get_ppos_dex_data(indexer, PUBLISHER, 1000, 7)
        assert PUBLISHER in str(err.value)
        assert "7" in str(err.value)
