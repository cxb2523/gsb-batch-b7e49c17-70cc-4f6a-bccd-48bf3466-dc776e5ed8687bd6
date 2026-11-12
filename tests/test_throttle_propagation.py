"""The run must know when it was refused.

A synthetic empty response (``_hd_failure``) is not a result page: pagination
must stop on it, the reason must travel up to the walk and the run summary,
and the tallies must count only what actually reached the network — one
metric record per real attempt, retries included, and nothing for a request
the cooldown never let leave the process.

These tests drive the real HDClient and the real browse pipeline through a
scripted transport; no network is involved.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from hd.config import Settings
from hd.hd_api.graphql import failure_reason
from hd.http.client import HDClient
from hd.http.cooldown import ThrottleCooldown
from hd.http.transport import RawResponse
from hd.pipeline.browse import Walk, run_browse, walk_and_capture, walk_status

from tests.test_browse import make_page, make_product
from tests.test_http_client import FakeTransport, resp


OK_BODY = {"data": {"searchModel": {"products": [], "searchReport": {"totalProducts": 0}}}}


def make_settings(tmp_path, **overrides) -> Settings:
    base = dict(
        # As in test_browse: never inherit the operator's untracked .env.
        _env_file=None,
        database_url=f"sqlite+aiosqlite:///{tmp_path}/test.db",
        stores="2619",
        brands="Milwaukee",
        brand_tokens="Milwaukee:zv",
        root_nav_param="N-5yc1v",
        page_size=2,
        api_max_start_index=10,
        browse_cursor_path=str(tmp_path / "cursor.json"),
        keyword_pause_min_seconds=0,
        keyword_pause_max_seconds=0,
        store_raw_json=False,
        rate_limit_rps=1000.0,
        jitter_min_ms=0,
        jitter_max_ms=0,
        request_budget=0,
        api_endpoint="https://api.example.invalid/graphql",
        throttle_cooldown_path=str(tmp_path / "cool"),
    )
    base.update(overrides)
    return Settings(**base)


@pytest.fixture
async def fresh_db(tmp_path):
    """Patch the module-level Database singleton so tests get an isolated DB."""
    from hd.db import base

    db = base.Database()
    with patch.object(base, "_default", db):
        yield db
    await db.close_db()


def make_client(settings: Settings, transport: FakeTransport) -> HDClient:
    c = HDClient(settings, transport=transport)
    c._query_cache = "query searchModel { x }"  # skip the on-disk lookup
    return c


def shelf_router(pages: dict[int, dict]):
    """A router serving the brand shelf node, keyed on startIndex."""

    def router(request):
        start = request["payload"]["variables"]["startIndex"]
        page = pages[start]
        # Entries already built as RawResponse (a 206, say) pass through;
        # plain page dicts become ordinary 200 JSON responses.
        return page if isinstance(page, RawResponse) else resp(200, json=page)

    return router


# ---------------------------------------------------------------- run result


class TestRunResult:
    async def test_normal_run_reads_to_the_last_page(self, tmp_path, fresh_db):
        from hd.db import base

        settings = make_settings(tmp_path)
        await base.init_db(settings)

        transport = FakeTransport(shelf_router({
            0: make_page([make_product("111"), make_product("222")], 3),
            2: make_page([make_product("333")], 3),
        }))
        client = make_client(settings, transport)
        summary = await run_browse(settings, client=client, tiers=("shelf",))

        assert summary.aborted is False
        assert summary.throttled is False
        assert summary.throttle_reason is None
        assert summary.snapshots == 3
        # Facet read (reused as page 0) plus one follow-up page — and the
        # request tally, the metric records and the transport agree.
        assert summary.requests_made == 2
        assert client.metrics.attempts == 2
        assert len(transport.requests) == 2

    async def test_206_mid_walk_stops_pagination_and_marks_the_run(
        self, tmp_path, fresh_db
    ):
        from hd.db import base

        settings = make_settings(tmp_path)
        await base.init_db(settings)

        transport = FakeTransport(shelf_router({
            0: make_page([make_product("111"), make_product("222")], 12),
            2: make_page([make_product("333"), make_product("444")], 12),
            4: resp(206, json=OK_BODY),
        }))
        client = make_client(settings, transport)
        summary = await run_browse(settings, client=client, tiers=("shelf",))

        # Pagination stopped AT the 206: nothing was asked for beyond it.
        starts = [r["payload"]["variables"]["startIndex"] for r in transport.requests]
        assert starts == [0, 2, 4]
        # The run says it was throttled, why, and what it had spent.
        assert summary.throttled is True
        assert summary.throttle_reason == "http_206_quota"
        assert summary.aborted is True
        assert summary.requests_made == 3
        # One metric record per real network attempt, no more.
        assert client.metrics.attempts == 3
        assert client.metrics.by_outcome() == {"http_206_quota": 1, "ok": 2}
        # And the refusal outlives the run, for the next scheduled one.
        assert ThrottleCooldown(settings.throttle_cooldown_path).is_active()

    async def test_active_cooldown_means_zero_requests_and_a_readable_reason(
        self, tmp_path, fresh_db
    ):
        from hd.db import base

        settings = make_settings(tmp_path)
        await base.init_db(settings)
        ThrottleCooldown(settings.throttle_cooldown_path).start(3600)

        transport = FakeTransport(shelf_router({0: make_page([], 0)}))
        client = make_client(settings, transport)
        summary = await run_browse(settings, client=client, tiers=("shelf",))

        # Nothing reached the network, and the tallies say so...
        assert transport.requests == []
        assert summary.requests_made == 0
        assert client.request_count == 0
        assert client.metrics.attempts == 0
        # ...but the run still reports that it was refused, and why.
        assert summary.throttled is True
        assert summary.throttle_reason == "cooling_down"
        assert summary.aborted is True

    async def test_corrupt_cooldown_file_is_ignored_and_requests_flow(
        self, tmp_path, fresh_db
    ):
        from hd.db import base

        settings = make_settings(tmp_path)
        await base.init_db(settings)
        # A damaged cooldown file must not silence the scanner: it reads as
        # no cooldown at all, and the live 206 handling still stops a run.
        with open(settings.throttle_cooldown_path, "w", encoding="utf-8") as fh:
            fh.write("\x00\xff not a timestamp \x00")

        transport = FakeTransport(shelf_router({
            0: make_page([make_product("111")], 1),
        }))
        client = make_client(settings, transport)
        summary = await run_browse(settings, client=client, tiers=("shelf",))

        assert len(transport.requests) == 1
        assert summary.throttled is False
        assert summary.throttle_reason is None
        assert summary.requests_made == 1
        assert summary.snapshots == 1


# ---------------------------------------------------------------- the walk


class TestWalkStopReason:
    async def test_walk_carries_why_it_stopped(self, tmp_path, fresh_db):
        from hd.db import base

        settings = make_settings(tmp_path)
        await base.init_db(settings)

        transport = FakeTransport(shelf_router({
            0: make_page([make_product("111"), make_product("222")], 6),
            2: resp(206, json=OK_BODY),
        }))
        client = make_client(settings, transport)
        walk = Walk("N-5yc1vZzv", "Milwaukee", 6)
        await walk_and_capture(
            client, settings, walk, "2619", "IN_STORE", set(), ["Milwaukee"],
        )

        assert walk.cut is True
        assert walk.stop_reason == "http_206_quota"
        assert walk_status(walk) == "truncated"
        # The 206 page contributed nothing: only the two real products landed.
        assert walk.observed_ids == 2

    async def test_a_failure_tagged_page_is_not_a_valid_end_of_results(
        self, tmp_path, fresh_db
    ):
        """A synthetic empty page must cut the walk, not complete it."""
        from hd.db import base

        settings = make_settings(tmp_path)
        await base.init_db(settings)

        # The transport answers 200 with a body the client cannot use, so the
        # client synthesises a tagged empty response in place of a page.
        transport = FakeTransport([resp(200, text='{"data": {broken')])
        client = make_client(settings, transport)
        walk = Walk("N-5yc1vZzv", "Milwaukee", 6)
        await walk_and_capture(
            client, settings, walk, "2619", "IN_STORE", set(), ["Milwaukee"],
        )

        assert walk.cut is True
        assert walk.stop_reason == "bad_json"
        assert walk_status(walk) == "failed"  # nothing usable was seen at all


# ---------------------------------------------------------------- metrics


class TestMetricsAccounting:
    async def test_each_retry_is_its_own_metric_record(self, tmp_path):
        settings = make_settings(tmp_path)
        transport = FakeTransport([
            resp(429, headers={"Retry-After": "0"}),
            resp(200, json=OK_BODY),
        ])
        client = make_client(settings, transport)
        raw = await client.post_graphql({})

        assert failure_reason(raw) is None
        assert client.request_count == 1       # one logical request
        assert client.metrics.attempts == 2    # two real network attempts
        assert client.metrics.retries == 1
        assert len(transport.requests) == 2

    async def test_a_cooling_client_records_no_attempt(self, tmp_path):
        settings = make_settings(tmp_path)
        ThrottleCooldown(settings.throttle_cooldown_path).start(600)
        transport = FakeTransport([resp(200, json=OK_BODY)])
        client = make_client(settings, transport)
        raw = await client.post_graphql({})

        assert failure_reason(raw) == "cooling_down"
        assert client.throttle_reason == "cooling_down"
        assert client.request_count == 0
        assert client.metrics.attempts == 0
        assert transport.requests == []
