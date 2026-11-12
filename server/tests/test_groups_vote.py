"""
Offline tests for POST /groups/vote.

These tests run entirely locally:
- The database is an in-memory SQLite instance (via dependency override).
- Firebase token verification is replaced by a stub that trusts the
  `Authorization` header value as the user id.
- yfinance market data is replaced by a fake ticker returning a fixed price.

Run from the repository root:  python -m pytest server/tests -v
"""

import uuid
from datetime import datetime, timedelta

import pytest
from fastapi import Header
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from server import database, models
from server.auth import get_current_user
from server.main import app

FAKE_PRICE = 200.0


class FakeTicker:
    """Stand-in for yfinance.Ticker returning a fixed quote — no network."""

    def __init__(self, symbol):
        self.symbol = symbol

    @property
    def info(self):
        return {"regularMarketPrice": FAKE_PRICE}


def fake_current_user(authorization: str = Header("")):
    """Auth stub: the Authorization header value is treated as the uid."""
    return {"uid": authorization, "email": "", "name": ""}


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    models.Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[database.get_db] = override_get_db
    app.dependency_overrides[get_current_user] = fake_current_user

    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        app.dependency_overrides.clear()


@pytest.fixture()
def client(db_session):
    return TestClient(app)


@pytest.fixture(autouse=True)
def fake_market(monkeypatch):
    monkeypatch.setattr("server.main.yf.Ticker", FakeTicker)


# ── helpers ──────────────────────────────────────────────────────────────────

def make_user(db, uid):
    db.add(models.User(id=uid, name=uid, email=f"{uid}@test.local", hashed_password=""))


def make_group(db, corpus, vote_mode="majority"):
    group = models.Group(
        id=str(uuid.uuid4()),
        name="Test Group",
        invite_code="TL-" + uuid.uuid4().hex[:6].upper(),
        vote_mode=vote_mode,
        virtual_corpus=corpus,
        created_by="creator",
    )
    db.add(group)
    return group


def add_member(db, group, uid):
    db.add(models.GroupMember(
        id=str(uuid.uuid4()), group_id=group.id, user_id=uid,
        contribution=100.0, units_held=1.0,
    ))


def make_proposal(db, group, action, quantity, price=100.0, ticker="RELIANCE"):
    proposal = models.Proposal(
        id=str(uuid.uuid4()),
        group_id=group.id,
        proposed_by="creator",
        ticker=ticker,
        action=action,
        quantity=quantity,
        price_at_proposal=price,
        status="open",
        expires_at=datetime.utcnow() + timedelta(days=1),
    )
    db.add(proposal)
    return proposal


def vote(client, proposal_id, voter_id, vote="yes"):
    return client.post(
        "/groups/vote",
        json={"proposal_id": proposal_id, "voter_id": voter_id, "vote": vote},
        headers={"Authorization": voter_id},
    )


def vote_count(db, proposal_id):
    return db.query(models.Vote).filter(models.Vote.proposal_id == proposal_id).count()


# ── tests ────────────────────────────────────────────────────────────────────

def test_non_member_vote_rejected(client, db_session):
    """A user who is not a member of the proposal's group gets 403 and
    no vote is recorded and the proposal state is untouched."""
    make_user(db_session, "alice")
    make_user(db_session, "mallory")
    group = make_group(db_session, corpus=10000.0)
    add_member(db_session, group, "alice")
    proposal = make_proposal(db_session, group, "BUY", quantity=5)
    db_session.commit()

    resp = vote(client, proposal.id, "mallory")

    assert resp.status_code == 403
    assert vote_count(db_session, proposal.id) == 0
    db_session.expire_all()
    assert db_session.get(models.Proposal, proposal.id).status == "open"


def test_duplicate_vote_rejected(client, db_session):
    """Voting twice on the same proposal returns 400; the tally and the
    proposal status are unchanged."""
    make_user(db_session, "alice")
    make_user(db_session, "bob")
    # Two members, majority mode → majority is 2, so one "yes" keeps it open.
    group = make_group(db_session, corpus=10000.0, vote_mode="majority")
    add_member(db_session, group, "alice")
    add_member(db_session, group, "bob")
    proposal = make_proposal(db_session, group, "BUY", quantity=1)
    db_session.commit()

    first = vote(client, proposal.id, "alice")
    assert first.status_code == 200
    assert first.json()["status"] == "open"

    second = vote(client, proposal.id, "alice")
    assert second.status_code == 400
    assert vote_count(db_session, proposal.id) == 1
    db_session.expire_all()
    assert db_session.get(models.Proposal, proposal.id).status == "open"


def test_buy_insufficient_funds_rejected(client, db_session):
    """Passed BUY proposal with insufficient corpus → rejected, and neither
    funds nor holdings change."""
    make_user(db_session, "alice")
    group = make_group(db_session, corpus=100.0)
    add_member(db_session, group, "alice")
    # cost = 200 * 10 = 2000 > 100 corpus
    proposal = make_proposal(db_session, group, "BUY", quantity=10)
    db_session.commit()

    resp = vote(client, proposal.id, "alice")

    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"
    db_session.expire_all()
    assert db_session.get(models.Group, group.id).virtual_corpus == 100.0
    assert db_session.query(models.GroupHolding).filter_by(group_id=group.id).count() == 0
    assert db_session.get(models.Proposal, proposal.id).status == "rejected"


def test_sell_insufficient_holdings_rejected(client, db_session):
    """Passed SELL proposal for more shares than held → rejected, and neither
    funds nor holdings change."""
    make_user(db_session, "alice")
    group = make_group(db_session, corpus=1000.0)
    add_member(db_session, group, "alice")
    db_session.add(models.GroupHolding(
        id=str(uuid.uuid4()), group_id=group.id, ticker="RELIANCE",
        quantity=5, avg_buy_price=100.0,
    ))
    proposal = make_proposal(db_session, group, "SELL", quantity=10)
    db_session.commit()

    resp = vote(client, proposal.id, "alice")

    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"
    db_session.expire_all()
    assert db_session.get(models.Group, group.id).virtual_corpus == 1000.0
    holding = db_session.query(models.GroupHolding).filter_by(group_id=group.id).one()
    assert holding.quantity == 5
    assert holding.avg_buy_price == 100.0
    assert db_session.get(models.Proposal, proposal.id).status == "rejected"


def test_buy_success_weighted_average(client, db_session):
    """Passed BUY proposal with sufficient funds executes: corpus is debited
    and the holding's average price is updated as a weighted average."""
    make_user(db_session, "alice")
    group = make_group(db_session, corpus=10000.0)
    add_member(db_session, group, "alice")
    db_session.add(models.GroupHolding(
        id=str(uuid.uuid4()), group_id=group.id, ticker="RELIANCE",
        quantity=10, avg_buy_price=100.0,
    ))
    # buy 10 more @ FAKE_PRICE (200) → cost 2000
    proposal = make_proposal(db_session, group, "BUY", quantity=10)
    db_session.commit()

    resp = vote(client, proposal.id, "alice")

    assert resp.status_code == 200
    assert resp.json()["status"] == "executed"
    db_session.expire_all()
    assert db_session.get(models.Group, group.id).virtual_corpus == pytest.approx(8000.0)
    holding = db_session.query(models.GroupHolding).filter_by(group_id=group.id).one()
    assert holding.quantity == pytest.approx(20)
    # weighted average: (10*100 + 10*200) / 20 = 150
    assert holding.avg_buy_price == pytest.approx(150.0)
    assert db_session.get(models.Proposal, proposal.id).status == "executed"
