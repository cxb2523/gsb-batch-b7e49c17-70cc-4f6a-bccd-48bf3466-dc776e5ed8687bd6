from unittest import TestCase
from unittest.mock import Mock, patch

from pydora.audio_backend import (
    BasePlayer,
    PlayerConnectionError,
    PlayerProcessError,
    PlayerUnusable,
    RemoteVLC,
)


class FakeProcess:
    """Minimal stand-in for an audio backend process."""

    def __init__(self, alive=True):
        self._alive = alive
        self.stdin = Mock()
        self.stdout = Mock()

    def poll(self):
        return None if self._alive else 1

    def kill(self):
        pass


class FakeBackend(BasePlayer):
    """BasePlayer subclass backed by a fake process."""

    stopped = False

    def _find_path(self):
        return "fake-backend"

    def _load_track(self, song):
        pass

    def _player_stopped(self, value):
        return self.stopped

    def _ensure_started(self):
        if self._process is None:
            self._process = FakeProcess()


def make_control_channel(readline_value="n\n"):
    channel = Mock()
    channel.fileno.return_value = 0
    channel.readline.return_value = readline_value
    return channel


class TestBackendProcessExit(TestCase):
    def setUp(self):
        self.callbacks = Mock()
        self.control = make_control_channel()
        self.player = FakeBackend(self.callbacks, self.control)

    @patch("pydora.audio_backend.time.sleep")
    def test_play_raises_when_backend_exits(self, sleep):
        self.player._process = FakeProcess(alive=False)

        with self.assertRaises(PlayerProcessError):
            self.player.play(Mock())

        self.callbacks.play.assert_called_once()
        self.callbacks.post_poll.assert_called_once()

    @patch("pydora.audio_backend.time.sleep")
    def test_play_station_propagates_backend_exit(self, sleep):
        self.player._process = FakeProcess(alive=False)
        station = Mock()
        station.get_playlist.return_value = iter([Mock()])

        with self.assertRaises(PlayerProcessError):
            self.player.play_station(station)

    def test_send_cmd_raises_when_backend_exited(self):
        self.player._process = FakeProcess(alive=False)

        with self.assertRaises(PlayerProcessError):
            self.player._send_cmd("stop")

    def test_stop_raises_when_backend_exited(self):
        self.player._process = FakeProcess(alive=False)

        with self.assertRaises(PlayerProcessError):
            self.player.stop()

    def test_send_cmd_raises_when_write_fails(self):
        process = FakeProcess(alive=True)
        process.stdin.write.side_effect = BrokenPipeError("gone")
        self.player._process = process

        with self.assertRaises(PlayerProcessError):
            self.player._send_cmd("stop")

    def test_read_from_process_raises_on_error(self):
        handle = Mock()
        handle.readline.side_effect = OSError("closed")

        with self.assertRaises(PlayerProcessError):
            self.player._read_from_process(handle)


class TestControlChannel(TestCase):
    def setUp(self):
        self.callbacks = Mock()
        self.control = make_control_channel()
        self.player = FakeBackend(self.callbacks, self.control)
        self.player._process = FakeProcess(alive=True)

    @patch("pydora.audio_backend.select.select")
    @patch("pydora.audio_backend.time.sleep")
    def test_control_channel_eof_raises(self, sleep, select_mock):
        self.control.readline.return_value = ""
        select_mock.return_value = ([self.control], [], [])

        with self.assertRaises(PlayerProcessError):
            self.player.play(Mock())

    @patch("pydora.audio_backend.select.select")
    @patch("pydora.audio_backend.time.sleep")
    def test_control_channel_read_error_raises(self, sleep, select_mock):
        self.control.readline.side_effect = OSError("closed")
        select_mock.return_value = ([self.control], [], [])

        with self.assertRaises(PlayerProcessError):
            self.player.play(Mock())

    @patch("pydora.audio_backend.select.select")
    @patch("pydora.audio_backend.time.sleep")
    def test_control_channel_input_dispatches(self, sleep, select_mock):
        self.control.readline.return_value = "n\n"
        self.callbacks.input.side_effect = StopIteration
        select_mock.return_value = ([self.control], [], [])

        with self.assertRaises(StopIteration):
            self.player.play(Mock())

        self.callbacks.input.assert_called_once()


class TestPlaybackCompletion(TestCase):
    @patch("pydora.audio_backend.select.select")
    @patch("pydora.audio_backend.time.sleep")
    def test_play_returns_when_player_stopped(self, sleep, select_mock):
        callbacks = Mock()
        control = make_control_channel()
        player = FakeBackend(callbacks, control)
        player.stopped = True
        process = FakeProcess(alive=True)
        process.stdout.fileno.return_value = 1
        player._process = process
        select_mock.return_value = ([process.stdout], [], [])

        player.play(Mock())

        callbacks.play.assert_called_once()


class TestRemoteVLC(TestCase):
    def setUp(self):
        self.callbacks = Mock()
        self.control = make_control_channel()

    def _make_player(self, sock):
        with patch(
            "pydora.audio_backend.socket.create_connection",
            return_value=sock,
        ):
            return RemoteVLC("localhost", "1234", self.callbacks, self.control)

    def test_unable_to_connect_is_unusable(self):
        with patch(
            "pydora.audio_backend.socket.create_connection",
            side_effect=OSError("refused"),
        ):
            with self.assertRaises(PlayerUnusable):
                RemoteVLC("localhost", "1234", self.callbacks, self.control)

    def test_send_cmd_connection_lost(self):
        sock = Mock()
        sock.sendall.side_effect = BrokenPipeError("gone")
        player = self._make_player(sock)

        with self.assertRaises(PlayerConnectionError):
            player._send_cmd("stop")

        self.assertIsNone(player._control_sock)
        sock.close.assert_called_once()

    def test_send_cmd_without_connection(self):
        player = self._make_player(Mock())
        player._control_sock = None

        with self.assertRaises(PlayerConnectionError):
            player._send_cmd("stop")

    def test_read_connection_lost(self):
        sock = Mock()
        sock.recv.side_effect = ConnectionResetError("reset")
        player = self._make_player(sock)

        with self.assertRaises(PlayerConnectionError):
            player._read_from_process(sock)

        self.assertIsNone(player._control_sock)

    def test_read_connection_closed(self):
        sock = Mock()
        sock.recv.return_value = b""
        player = self._make_player(sock)

        with self.assertRaises(PlayerConnectionError):
            player._read_from_process(sock)

        self.assertIsNone(player._control_sock)

    def test_read_returns_stripped_response(self):
        sock = Mock()
        sock.recv.return_value = b"state stopped\r\n"
        player = self._make_player(sock)

        self.assertEqual(player._read_from_process(sock), b"state stopped")

    def test_reconnect_after_disconnect(self):
        sock = Mock()
        sock.sendall.side_effect = BrokenPipeError("gone")
        player = self._make_player(sock)

        with self.assertRaises(PlayerConnectionError):
            player._send_cmd("stop")

        new_sock = Mock()
        with patch(
            "pydora.audio_backend.socket.create_connection",
            return_value=new_sock,
        ):
            player._ensure_started()

        self.assertIs(player._control_sock, new_sock)
        new_sock.setblocking.assert_called_once_with(False)
