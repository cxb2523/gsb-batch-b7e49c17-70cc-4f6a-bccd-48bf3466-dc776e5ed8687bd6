"""Data-gap resilience: empty repo list, null timestamps, missing topics.

Uses one fixed dataset with an empty list, null pushed_at/created_at and
missing/malformed topics, renders each layout (card, bento, terminal) once,
and checks the output files exist, are 1200 px wide and leak no private
repo names. Also runs the full main() pipeline against an empty fetch.

Run from the repo root: python tests/empty_data_test.py
"""
import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("GITHUB_TOKEN", "test-token")  # config.py requires it at import

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))
import pandas as pd  # noqa: E402

from assets.dashboard import LAYOUTS, create_dashboard  # noqa: E402
from assets.layouts.common import snapshot  # noqa: E402
from transform import lifecycle, repos_to_dataframe  # noqa: E402

NOW = pd.Timestamp.now(tz="UTC")
RECENT = (NOW - pd.Timedelta(days=10)).isoformat()          # inside the 90d active window
OLD = (NOW - pd.DateOffset(years=3)).isoformat()            # outside this year's stats


def repo(name, private=False, language="Python", stars=3, created=OLD,
         pushed=RECENT, topics=(), fork=False):
    r = {"name": name, "html_url": f"https://github.com/someone/{name}",
         "private": private, "language": language, "stargazers_count": stars,
         "forks_count": 0, "open_issues_count": 0, "size": 10, "archived": False,
         "created_at": created, "pushed_at": pushed, "fork": fork,
         "description": None, "is_template": False, "license": None}
    if topics is not None:
        r["topics"] = topics
    return r


PRIVATE_NAMES = ["secret-gaps", "hidden-null-push"]

# one fixed dataset covering every gap: null pushed_at, null created_at,
# missing topics key, non-list topics, plus private repos that must not leak
REPOS = [
    repo("null-push", pushed=None, topics=["wip"]),                # never pushed
    repo("null-created", created=None),                            # unknown creation time
    repo("no-topics", topics=None),                                # topics key missing
    repo("string-topics", topics="finished"),                      # topics not a list
    repo("ok-repo", language="Go", stars=7, topics=["finished"]),
    repo("secret-gaps", private=True, stars=99, pushed=None),
    repo("hidden-null-push", private=True, created=None, topics=None),
    repo("a-fork", fork=True),                                     # forks are excluded
]

# --- transform: gaps don't raise, stats follow the rules -------------------
assert lifecycle({"topics": None}) is None
assert lifecycle({"topics": "finished"}) is None  # non-list is no status
assert lifecycle({}) is None                      # key missing entirely

df = repos_to_dataframe(REPOS)
assert len(df) == 7, f"fork should be excluded, got {len(df)}"
row = {r.name: r for r in df.itertuples()}
assert not row["null-push"].is_active, "null pushed_at must not count as active"
assert row["null-push"].stage == "In progress"
assert row["no-topics"].stage is None
assert row["string-topics"].stage is None, "non-list topics must be no status"
assert row["ok-repo"].is_active

snap = snapshot(df)
assert snap.total == 7                      # gaps still count toward the total
assert snap.stars == int(df["stars"].sum())  # and toward stars/languages
assert snap.live == 5                       # the two null pushed_at repos stay out
assert snap.created_ytd == 0                # every created_at is old or null

# --- empty list: still a valid frame, CSV and an empty-state dashboard -----
empty = repos_to_dataframe([])
assert len(empty) == 0 and "stage" in empty.columns and "is_active" in empty.columns
esnap = snapshot(empty)
assert esnap.total == 0 and esnap.stars == 0 and esnap.langs == []

with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)

    # full pipeline against an empty fetch: CSV and SVG are still produced
    import main
    main.CSV_OUTPUT = str(tmp / "repos.csv")
    main.DASHBOARD_OUTPUT = str(tmp / "dash.svg")
    main.get_repositories = lambda: []
    main.main()
    assert Path(main.CSV_OUTPUT).exists(), "empty CSV not written"
    assert "name" in Path(main.CSV_OUTPUT).read_text(encoding="utf-8").splitlines()[0]
    svg = Path(main.DASHBOARD_OUTPUT).read_text(encoding="utf-8")
    assert re.search(r'<svg[^>]* width="1200" ', svg), "empty dashboard width is not 1200"

    # each layout renders once for the gap dataset and once for the empty list
    for layout in LAYOUTS:
        for tag, frame in [("gaps", df), ("empty", empty)]:
            out = tmp / f"{layout}-{tag}.svg"
            create_dashboard(frame, str(out), layout=layout, gradients=True)
            assert out.exists(), f"{out.name}: not created"
            text = out.read_text(encoding="utf-8")
            assert re.search(r'<svg[^>]* width="1200" ', text), f"{out.name}: width is not 1200"
            for name in PRIVATE_NAMES:
                assert name not in text, f"{out.name}: private repo {name!r} in SVG"
        empty_svg = (tmp / f"{layout}-empty.svg").read_text(encoding="utf-8")
        assert "no language data yet" in empty_svg.lower(), f"{layout}: no empty-state placeholder"

print(f"ok: {len(LAYOUTS)} layouts x gaps/empty + empty-pipeline render")
