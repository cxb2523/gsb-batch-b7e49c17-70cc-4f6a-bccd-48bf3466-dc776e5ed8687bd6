"""Latest-connection-wins: reconnect, displaced-socket teardown and new-game boundaries.

All tests run offline against the real ASGI app (or the real ConnectionManager and
GameEngine) with FakeResolver; no model or network access is involved.
"""

import asyncio
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from api.server import ConnectionManager, create_app
from core.config import settings
from logic.engine import GameEngine
from logic.models import GameState
from support import FakeResolver
from test_engine import password_digest, payload
from test_priority_one_transport import authenticate, receive_until


def close_code(socket) -> int:
    """Drain queued events and return the code the server closed the socket with."""
    for _ in range(30):
        try:
            socket.receive_json()
        except WebSocketDisconnect as exc:
            return exc.code
    raise AssertionError("Socket did not close")


def settle(client, seconds: float = 0.1) -> None:
    """Let server-side socket teardown callbacks run to completion."""

    async def wait():
        await asyncio.sleep(seconds)

    client.portal.call(wait)


def test_reconnect_displaces_old_socket_with_4001_and_new_socket_stays_usable():
    """A reconnect closes the replaced socket with 4001 and the new socket owns the player."""
    app = create_app(FakeResolver)
    host_id, player_id = str(uuid4()), str(uuid4())
    with TestClient(app) as client:
        with client.websocket_connect(f"/ws/{host_id}") as host:
            authenticate(host, host_id)
            receive_until(host, "auth_ok")
            host.send_json({"event_type": "scenario_init", "data": {"scenario": "A gate."}})
            receive_until(host, "scenario_ready")
            with client.websocket_connect(f"/ws/{player_id}") as old:
                authenticate(old, player_id, "Player", settings.server.player_password)
                token = receive_until(old, "auth_ok")["payload"]["reconnect_token"]
                host.send_json({"event_type": "start_game", "data": {}})
                receive_until(old, "turn_directive")
                with client.websocket_connect(f"/ws/{player_id}") as new:
                    authenticate(new, player_id, "Player", settings.server.player_password, token)
                    assert receive_until(new, "auth_ok")["payload"]["round_number"] == 1
                    # The replaced socket is closed with 4001, not left hanging.
                    assert close_code(old) == 4001
                    # The host observes exactly one roster entry per player, both connected.
                    roster = receive_until(host, "player_roster")["payload"]["players"]
                    assert roster == [
                        {"name": "Host", "connected": True, "is_host": True},
                        {"name": "Player", "connected": True, "is_host": False},
                    ]
                    # Let the displaced socket's server-side teardown run; it must not
                    # mark the promoted replacement as disconnected or disturb the turn.
                    settle(client)
                    engine = app.state.engine
                    player = engine.players[player_id]
                    assert player.is_connected
                    assert not player.departure_pending and not player.return_pending
                    assert list(engine.join_order) == [host_id, player_id]
                    assert sorted(engine.turn_queue) == sorted([host_id, player_id])
                    assert engine.active_player_id == host_id
                    assert engine.round_buffer == {}
                    # The new socket keeps sending and receiving after the old one's exit.
                    new.send_json({"event_type": "chat", "data": {"message": "Back already"}})
                    assert receive_until(new, "chat_echo")["payload"]["chat"] == "Back already"
                    assert receive_until(host, "chat_echo")["payload"]["chat"] == "Back already"


def test_multiple_rapid_replacements_converge_on_the_latest_socket():
    """Repeated reconnects close every displaced socket with 4001 and keep the latest."""
    app = create_app(FakeResolver)
    host_id = str(uuid4())
    with TestClient(app) as client:
        with client.websocket_connect(f"/ws/{host_id}") as first:
            authenticate(first, host_id)
            token = receive_until(first, "auth_ok")["payload"]["reconnect_token"]
            with client.websocket_connect(f"/ws/{host_id}") as second:
                authenticate(second, host_id, reconnect_token=token)
                token = receive_until(second, "auth_ok")["payload"]["reconnect_token"]
                with client.websocket_connect(f"/ws/{host_id}") as third:
                    authenticate(third, host_id, reconnect_token=token)
                    receive_until(third, "auth_ok")
                    assert close_code(first) == 4001
                    assert close_code(second) == 4001
                    # Both displaced sockets tear down late; the player stays online.
                    settle(client)
                    engine = app.state.engine
                    assert engine.players[host_id].is_connected
                    assert list(engine.players) == [host_id]
                    assert list(engine.join_order) == [host_id]
                    assert list(engine.turn_queue) == [host_id]
                    third.send_json({"event_type": "chat", "data": {"message": "Latest wins"}})
                    assert receive_until(third, "chat_echo")["payload"]["chat"] == "Latest wins"


def test_new_game_requires_host_and_ended_game():
    """new_game is rejected for non-hosts and while the current game is not ended."""
    app = create_app(FakeResolver)
    host_id, player_id = str(uuid4()), str(uuid4())
    with TestClient(app) as client:
        with client.websocket_connect(f"/ws/{host_id}") as host:
            authenticate(host, host_id)
            receive_until(host, "auth_ok")
            host.send_json({"event_type": "new_game", "data": {}})
            assert "End the current game" in receive_until(host, "error")["payload"]["msg"]
            host.send_json({"event_type": "scenario_init", "data": {"scenario": "Ruins"}})
            receive_until(host, "scenario_ready")
            with client.websocket_connect(f"/ws/{player_id}") as player:
                authenticate(player, player_id, "Player", settings.server.player_password)
                receive_until(player, "auth_ok")
                host.send_json({"event_type": "start_game", "data": {}})
                receive_until(host, "turn_directive")
                player.send_json({"event_type": "new_game", "data": {}})
                assert "Only the host" in receive_until(player, "error")["payload"]["msg"]
                host.send_json({"event_type": "end_game", "data": {}})
                receive_until(player, "game_ended")
                player.send_json({"event_type": "new_game", "data": {}})
                assert "Only the host" in receive_until(player, "error")["payload"]["msg"]
                # Rejections leave the ended session and its roster untouched.
                engine = app.state.engine
                assert engine.state is GameState.ENDED
                assert set(engine.players) == {host_id, player_id}


def test_new_game_ignores_late_disconnects_from_the_old_session():
    """Old-session sockets closing after a restart cannot disturb the new host or state."""
    app = create_app(FakeResolver)
    host_id, player_id = str(uuid4()), str(uuid4())
    with TestClient(app) as client:
        with client.websocket_connect(f"/ws/{host_id}") as host:
            authenticate(host, host_id)
            receive_until(host, "auth_ok")
            host.send_json({"event_type": "scenario_init", "data": {"scenario": "Old ruins"}})
            receive_until(host, "scenario_ready")
            with client.websocket_connect(f"/ws/{player_id}") as player:
                authenticate(player, player_id, "Player", settings.server.player_password)
                receive_until(player, "auth_ok")
                host.send_json({"event_type": "start_game", "data": {}})
                receive_until(host, "turn_directive")
                host.send_json({"event_type": "end_game", "data": {}})
                receive_until(host, "game_ended")
                receive_until(player, "game_ended")
                old_engine = app.state.engine
                host.send_json({"event_type": "new_game", "data": {}})
                snapshot = receive_until(host, "auth_ok")["payload"]
                assert snapshot["state"] == "SCENARIO_INJECTION"
                assert snapshot["session_id"] != old_engine.session_id
                # Every other authenticated socket is closed with 4002.
                assert close_code(player) == 4002
                # The displaced socket's late teardown must not remove the new host
                # from the roster or revert the fresh session back to ENDED.
                settle(client)
                engine = app.state.engine
                assert engine is not old_engine
                assert old_engine.state is GameState.ENDED
                assert engine.state is GameState.SCENARIO_INJECTION
                assert list(engine.players) == [host_id]
                assert list(engine.turn_queue) == [host_id]
                assert engine.players[host_id].is_connected
                # The new host can immediately drive the fresh session forward.
                host.send_json({"event_type": "scenario_init", "data": {"scenario": "New forest"}})
                receive_until(host, "scenario_ready")
                assert engine.state is GameState.AWAITING_PLAYERS


def test_kicked_socket_disconnect_callback_ignores_replacement():
    """A failed socket's late callback must not mark its authenticated replacement offline."""

    class Socket:
        """Minimal fake WebSocket for the manager."""

        def __init__(self):
            """Initialize the fake socket."""
            self.messages = []
            self.closed = None

        async def accept(self):
            """Accept the socket."""

        async def send_text(self, text):
            """Record a sent text."""
            self.messages.append(text)

        async def close(self, code=1000):
            """Record the close code."""
            self.closed = code

    async def run():
        manager = ConnectionManager()
        engine = GameEngine(manager, FakeResolver())

        async def lost(client_id):
            # The same callback the lifespan wires into manager.on_disconnect.
            await engine.handle_disconnect(
                client_id, still_disconnected=lambda: client_id not in manager.active_connections
            )

        manager.on_disconnect = lost
        client_id = "player"
        auth_data = payload(
            "auth",
            name="Player",
            password_digest=password_digest(settings.server.host_password, client_id),
            reconnect_token=None,
        ).data
        first = Socket()
        await manager.connect(client_id, first)
        await engine._authenticate(
            client_id, auth_data, activate=lambda: manager.promote(client_id, first)
        )
        assert engine.players[client_id].is_connected

        # The socket is kicked (writer failure/queue overflow) and the player
        # reconnects before the failed socket's cleanup callback runs.
        manager._fail(first)
        second = Socket()
        await manager.connect(client_id, second)
        token = engine.players[client_id].reconnect_token
        await engine._authenticate(
            client_id,
            {**auth_data, "reconnect_token": token},
            activate=lambda: manager.promote(client_id, second),
        )
        assert manager.owns(client_id, second)
        await asyncio.sleep(0.05)
        assert first.closed == 1013
        assert engine.players[client_id].is_connected

        # A kick with no replacement still marks the player offline exactly once.
        manager._fail(second)
        await asyncio.sleep(0.05)
        assert not engine.players[client_id].is_connected
        version = engine.players[client_id].connection_version
        await engine.handle_disconnect(client_id)
        assert engine.players[client_id].connection_version == version
        await manager.close()

    asyncio.run(run())


def test_displaced_socket_teardown_sequence_keeps_replacement_connected():
    """The endpoint's locked removal/version chain ignores a displaced socket."""

    class Socket:
        """Minimal fake WebSocket for the manager."""

        def __init__(self):
            """Initialize the fake socket."""
            self.messages = []

        async def accept(self):
            """Accept the socket."""

        async def send_text(self, text):
            """Record a sent text."""
            self.messages.append(text)

        async def close(self, code=1000):
            """Ignore closes."""

    async def run():
        manager = ConnectionManager()
        engine = GameEngine(manager, FakeResolver())
        client_id = "player"
        auth_data = payload(
            "auth",
            name="Player",
            password_digest=password_digest(settings.server.host_password, client_id),
            reconnect_token=None,
        ).data
        old, new = Socket(), Socket()
        await manager.connect(client_id, old)
        await engine._authenticate(
            client_id, auth_data, activate=lambda: manager.promote(client_id, old)
        )
        await manager.connect(client_id, new)
        token = engine.players[client_id].reconnect_token
        await engine._authenticate(
            client_id,
            {**auth_data, "reconnect_token": token},
            activate=lambda: manager.promote(client_id, new),
        )

        # Reproduce the endpoint's finally block for the displaced old socket.
        async with engine.lock:
            removed = await manager.disconnect(client_id, old)
            version = None
            if removed:
                player = engine.players.get(client_id)
                version = player.connection_version if player is not None else None
        if removed:
            await engine.handle_disconnect(
                client_id,
                expected_version=version,
                still_disconnected=lambda: client_id not in manager.active_connections,
            )
        assert not removed
        assert engine.players[client_id].is_connected

        # The current socket's own teardown still marks the player offline.
        async with engine.lock:
            removed = await manager.disconnect(client_id, new)
            player = engine.players.get(client_id)
            version = player.connection_version if removed and player is not None else None
        assert removed
        await engine.handle_disconnect(
            client_id,
            expected_version=version,
            still_disconnected=lambda: client_id not in manager.active_connections,
        )
        assert not engine.players[client_id].is_connected
        await manager.close()

    asyncio.run(run())
