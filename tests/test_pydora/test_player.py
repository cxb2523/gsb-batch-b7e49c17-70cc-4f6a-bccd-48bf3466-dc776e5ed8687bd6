from unittest import TestCase
from unittest.mock import Mock, patch

from pydora.audio_backend import (
    PlayerConnectionError,
    PlayerProcessError,
    UnsupportedEncoding,
)
from pydora.player import PlayerApp


def make_app():
    with patch("pydora.player.Screen"):
        app = PlayerApp()
    app.screen = Mock()
    app.player = Mock()
    return app


class TestAdvertisementCommands(TestCase):
    def setUp(self):
        self.app = make_app()
        self.song = Mock(is_ad=True)

    def test_cannot_skip_advertisement(self):
        self.app.skip_song(self.song)

        self.app.screen.print_error.assert_called_once_with(
            "Cannot skip advertisements"
        )
        self.app.player.stop.assert_not_called()

    def test_cannot_dislike_advertisement(self):
        self.app.dislike_song(self.song)

        self.app.screen.print_error.assert_called_once_with(
            "Cannot dislike advertisements"
        )
        self.song.thumbs_down.assert_not_called()
        self.app.player.stop.assert_not_called()

    def test_cannot_like_advertisement(self):
        self.app.like_song(self.song)

        self.app.screen.print_error.assert_called_once_with(
            "Cannot like advertisements"
        )
        self.song.thumbs_up.assert_not_called()

    def test_cannot_bookmark_advertisement(self):
        self.app.bookmark_song(self.song)

        self.app.screen.print_error.assert_called_once_with(
            "Cannot bookmark advertisements"
        )
        self.song.bookmark_song.assert_not_called()

    def test_cannot_bookmark_advertisement_artist(self):
        self.app.bookmark_artist(self.song)

        self.app.screen.print_error.assert_called_once_with(
            "Cannot bookmark advertisements"
        )
        self.song.bookmark_artist.assert_not_called()

    def test_cannot_sleep_advertisement(self):
        self.app.sleep_song(self.song)

        self.app.screen.print_error.assert_called_once_with(
            "Cannot sleep advertisements"
        )
        self.song.sleep.assert_not_called()
        self.app.player.stop.assert_not_called()


class TestNormalSongCommands(TestCase):
    def setUp(self):
        self.app = make_app()
        self.song = Mock(is_ad=False)

    def test_skip_song_stops_player(self):
        self.app.skip_song(self.song)

        self.app.player.stop.assert_called_once_with()

    def test_like_song(self):
        self.song.thumbs_up.return_value = True

        self.app.like_song(self.song)

        self.song.thumbs_up.assert_called_once_with()
        self.app.screen.print_success.assert_called_once_with("Track liked")

    def test_dislike_song_stops_player(self):
        self.song.thumbs_down.return_value = True

        self.app.dislike_song(self.song)

        self.song.thumbs_down.assert_called_once_with()
        self.app.player.stop.assert_called_once_with()

    def test_bookmark_song(self):
        self.song.bookmark_song.return_value = True

        self.app.bookmark_song(self.song)

        self.song.bookmark_song.assert_called_once_with()
        self.app.screen.print_success.assert_called_once_with(
            "Bookmarked song"
        )

    def test_sleep_song_stops_player(self):
        self.song.sleep.return_value = True

        self.app.sleep_song(self.song)

        self.song.sleep.assert_called_once_with()
        self.app.player.stop.assert_called_once_with()


class TestInvalidCommand(TestCase):
    def test_invalid_command_does_not_affect_playback(self):
        app = make_app()
        song = Mock(is_ad=False)

        app.input("z", song)

        app.screen.print_error.assert_called_once_with("Invalid command 'z'!")
        app.player.stop.assert_not_called()
        app.player.pause.assert_not_called()
        app.player.end_station.assert_not_called()


class TestRunLoop(TestCase):
    def _run_app(self, play_side_effects):
        app = make_app()
        player = Mock()
        player.play_station.side_effect = play_side_effects

        app.get_player = Mock(return_value=player)
        app.get_client = Mock()
        app.get_client.return_value.get_station_list.return_value = ["station"]
        app.pre_flight_checks = Mock()
        app._parse_args = Mock(return_value=Mock(vlc_net=None, verbose=False))
        app.station_selection_menu = Mock(side_effect=["station"] * 3)

        with patch("pydora.player.logging.basicConfig"):
            with self.assertRaises(SystemExit):
                app.run()

        return app, player

    def test_backend_exit_returns_to_station_menu(self):
        app, player = self._run_app(
            [
                PlayerProcessError(
                    "Audio backend process exited unexpectedly"
                ),
                KeyboardInterrupt,
            ]
        )

        self.assertEqual(app.station_selection_menu.call_count, 2)
        app.station_selection_menu.assert_called_with(
            "Audio backend process exited unexpectedly"
        )
        player.stop.assert_called_once_with()

    def test_remote_vlc_disconnect_returns_to_station_menu(self):
        app, player = self._run_app(
            [
                PlayerConnectionError("Lost connection to remote VLC"),
                KeyboardInterrupt,
            ]
        )

        self.assertEqual(app.station_selection_menu.call_count, 2)
        app.station_selection_menu.assert_called_with(
            "Lost connection to remote VLC"
        )
        player.stop.assert_called_once_with()

    def test_unsupported_encoding_returns_to_station_menu(self):
        app, player = self._run_app(
            [
                UnsupportedEncoding("mpg123 only supports mp3 files"),
                KeyboardInterrupt,
            ]
        )

        self.assertEqual(app.station_selection_menu.call_count, 2)
        app.station_selection_menu.assert_called_with(
            "mpg123 only supports mp3 files"
        )
        player.stop.assert_called_once_with()
