from __future__ import annotations

from tubescrape._parsers import ResponseParser


class TestParseShortLockup:
    def test_valid_lockup(self):
        lockup = {
            'onTap': {
                'innertubeCommand': {
                    'reelWatchEndpoint': {'videoId': 'abc123'},
                }
            },
            'overlayMetadata': {
                'primaryText': {'content': 'Test Short Title'},
                'secondaryText': {'content': '10K views'},
            },
            'thumbnailViewModel': {
                'thumbnailViewModel': {
                    'image': {
                        'sources': [
                            {'url': 'https://i.ytimg.com/vi/abc123/oar2.jpg', 'width': 405, 'height': 720},
                        ]
                    }
                }
            },
        }
        short = ResponseParser._parse_short_lockup(lockup)
        assert short is not None
        assert short.video_id == 'abc123'
        assert short.title == 'Test Short Title'
        assert short.view_count == '10K views'
        assert short.thumbnail_url == 'https://i.ytimg.com/vi/abc123/oar2.jpg'
        assert short.url == 'https://www.youtube.com/shorts/abc123'

    def test_missing_video_id(self):
        lockup = {'onTap': {'innertubeCommand': {}}}
        assert ResponseParser._parse_short_lockup(lockup) is None

    def test_empty_lockup(self):
        assert ResponseParser._parse_short_lockup({}) is None

    def test_no_thumbnail(self):
        lockup = {
            'onTap': {
                'innertubeCommand': {
                    'reelWatchEndpoint': {'videoId': 'xyz'},
                }
            },
            'overlayMetadata': {
                'primaryText': {'content': 'Title'},
            },
        }
        short = ResponseParser._parse_short_lockup(lockup)
        assert short is not None
        assert short.thumbnail_url is None


class TestParseShortsTab:
    def test_valid_response(self):
        data = {
            'contents': {
                'twoColumnBrowseResultsRenderer': {
                    'tabs': [
                        {'tabRenderer': {'title': 'Home', 'selected': False}},
                        {'tabRenderer': {
                            'title': 'Shorts',
                            'selected': True,
                            'content': {
                                'richGridRenderer': {
                                    'contents': [
                                        {
                                            'richItemRenderer': {
                                                'content': {
                                                    'shortsLockupViewModel': {
                                                        'onTap': {
                                                            'innertubeCommand': {
                                                                'reelWatchEndpoint': {'videoId': 's1'},
                                                            }
                                                        },
                                                        'overlayMetadata': {
                                                            'primaryText': {'content': 'Short 1'},
                                                            'secondaryText': {'content': '5K views'},
                                                        },
                                                    }
                                                }
                                            }
                                        },
                                        {
                                            'richItemRenderer': {
                                                'content': {
                                                    'shortsLockupViewModel': {
                                                        'onTap': {
                                                            'innertubeCommand': {
                                                                'reelWatchEndpoint': {'videoId': 's2'},
                                                            }
                                                        },
                                                        'overlayMetadata': {
                                                            'primaryText': {'content': 'Short 2'},
                                                        },
                                                    }
                                                }
                                            }
                                        },
                                    ]
                                }
                            },
                        }},
                    ]
                }
            }
        }
        result = ResponseParser.parse_shorts_tab(data, 'UC123')
        assert result.channel_id == 'UC123'
        assert len(result.shorts) == 2
        assert result.shorts[0].video_id == 's1'
        assert result.shorts[0].title == 'Short 1'
        assert result.shorts[0].view_count == '5K views'
        assert result.shorts[1].video_id == 's2'

    def test_empty_response(self):
        result = ResponseParser.parse_shorts_tab({}, 'UC123')
        assert result.shorts == []


class TestParseChannelPlaylistItem:
    def test_lockup_viewmodel(self):
        item = {
            'lockupViewModel': {
                'contentId': 'PLtest123',
                'contentType': 'LOCKUP_CONTENT_TYPE_PLAYLIST',
                'metadata': {
                    'lockupMetadataViewModel': {
                        'title': {'content': 'My Playlist'},
                        'metadata': {
                            'contentMetadataViewModel': {
                                'metadataRows': [
                                    {'metadataParts': [{'text': {'content': '10 videos'}}]},
                                ]
                            }
                        },
                    }
                },
                'contentImage': {
                    'collectionThumbnailViewModel': {
                        'primaryThumbnail': {
                            'thumbnailViewModel': {
                                'image': {
                                    'sources': [
                                        {'url': 'https://thumb.jpg'},
                                    ]
                                }
                            }
                        }
                    }
                },
            }
        }
        entry = ResponseParser._parse_channel_playlist_item(item)
        assert entry is not None
        assert entry.playlist_id == 'PLtest123'
        assert entry.title == 'My Playlist'
        assert entry.video_count == '10 videos'
        assert entry.thumbnail_url == 'https://thumb.jpg'
        assert entry.url == 'https://www.youtube.com/playlist?list=PLtest123'

    def test_grid_playlist_renderer(self):
        item = {
            'gridPlaylistRenderer': {
                'playlistId': 'PLlegacy',
                'title': {'simpleText': 'Legacy Playlist'},
                'videoCountShortText': {'simpleText': '25'},
                'thumbnail': {
                    'thumbnails': [
                        {'url': 'https://thumb_small.jpg', 'width': 168, 'height': 94},
                        {'url': 'https://thumb_large.jpg', 'width': 336, 'height': 188},
                    ]
                },
            }
        }
        entry = ResponseParser._parse_channel_playlist_item(item)
        assert entry is not None
        assert entry.playlist_id == 'PLlegacy'
        assert entry.title == 'Legacy Playlist'
        assert entry.video_count == '25'
        assert entry.thumbnail_url == 'https://thumb_large.jpg'

    def test_empty_item(self):
        assert ResponseParser._parse_channel_playlist_item({}) is None

    def test_lockup_no_content_id(self):
        item = {'lockupViewModel': {'contentType': 'LOCKUP_CONTENT_TYPE_PLAYLIST'}}
        assert ResponseParser._parse_channel_playlist_item(item) is None


class TestParseChannelPlaylistsTab:
    def test_valid_response(self):
        data = {
            'contents': {
                'twoColumnBrowseResultsRenderer': {
                    'tabs': [
                        {'tabRenderer': {'title': 'Home', 'selected': False}},
                        {'tabRenderer': {
                            'title': 'Playlists',
                            'selected': True,
                            'content': {
                                'sectionListRenderer': {
                                    'contents': [{
                                        'itemSectionRenderer': {
                                            'contents': [{
                                                'gridRenderer': {
                                                    'items': [
                                                        {
                                                            'lockupViewModel': {
                                                                'contentId': 'PL001',
                                                                'metadata': {
                                                                    'lockupMetadataViewModel': {
                                                                        'title': {'content': 'Playlist 1'},
                                                                    }
                                                                },
                                                            }
                                                        },
                                                        {
                                                            'lockupViewModel': {
                                                                'contentId': 'PL002',
                                                                'metadata': {
                                                                    'lockupMetadataViewModel': {
                                                                        'title': {'content': 'Playlist 2'},
                                                                    }
                                                                },
                                                            }
                                                        },
                                                    ]
                                                }
                                            }]
                                        }
                                    }]
                                }
                            },
                        }},
                    ]
                }
            }
        }
        result = ResponseParser.parse_channel_playlists_tab(data, 'UC123')
        assert result.channel_id == 'UC123'
        assert len(result.playlists) == 2
        assert result.playlists[0].playlist_id == 'PL001'
        assert result.playlists[1].playlist_id == 'PL002'

    def test_empty_response(self):
        result = ResponseParser.parse_channel_playlists_tab({}, 'UC123')
        assert result.playlists == []


class TestParseChannelSearch:
    def test_valid_response(self):
        data = {
            'contents': {
                'twoColumnBrowseResultsRenderer': {
                    'tabs': [
                        {'tabRenderer': {'title': 'Home', 'selected': False}},
                        {'expandableTabRenderer': {
                            'selected': True,
                            'content': {
                                'sectionListRenderer': {
                                    'contents': [
                                        {
                                            'itemSectionRenderer': {
                                                'contents': [
                                                    {
                                                        'videoRenderer': {
                                                            'videoId': 'v1',
                                                            'title': {'simpleText': 'Result 1'},
                                                            'ownerText': {'simpleText': 'Channel'},
                                                            'lengthText': {'simpleText': '5:00'},
                                                        }
                                                    },
                                                    {
                                                        'videoRenderer': {
                                                            'videoId': 'v2',
                                                            'title': {'simpleText': 'Result 2'},
                                                            'ownerText': {'simpleText': 'Channel'},
                                                            'lengthText': {'simpleText': '10:00'},
                                                        }
                                                    },
                                                ]
                                            }
                                        },
                                    ]
                                }
                            },
                        }},
                    ]
                }
            }
        }
        result = ResponseParser.parse_channel_search(data, 'UC123', 'test')
        assert result.query == 'test'
        assert len(result.videos) == 2
        assert result.videos[0].video_id == 'v1'
        assert result.videos[0].title == 'Result 1'
        assert result.videos[1].video_id == 'v2'

    def test_empty_response(self):
        result = ResponseParser.parse_channel_search({}, 'UC123', 'test')
        assert result.videos == []


class TestModelSerialization:
    def test_short_result_to_dict(self):
        from tubescrape.models import ShortResult
        short = ShortResult(video_id='abc', title='Test', view_count='1K views')
        d = short.to_dict()
        assert d['video_id'] == 'abc'
        assert d['url'] == 'https://www.youtube.com/shorts/abc'
        assert d['view_count'] == '1K views'
        assert 'thumbnail_url' not in d  # sparse output

    def test_shorts_result_to_dict(self):
        from tubescrape.models import ShortResult, ShortsResult
        result = ShortsResult(
            channel_id='UC123',
            shorts=[ShortResult(video_id='a', title='A')],
        )
        d = result.to_dict()
        assert d['channel_id'] == 'UC123'
        assert len(d['shorts']) == 1

    def test_channel_playlist_entry_to_dict(self):
        from tubescrape.models import ChannelPlaylistEntry
        entry = ChannelPlaylistEntry(
            playlist_id='PL123', title='Test',
            thumbnail_url='https://thumb.jpg',
        )
        d = entry.to_dict()
        assert d['playlist_id'] == 'PL123'
        assert d['url'] == 'https://www.youtube.com/playlist?list=PL123'
        assert d['thumbnail_url'] == 'https://thumb.jpg'
        assert 'video_count' not in d  # sparse output

    def test_channel_playlists_result_to_dict(self):
        from tubescrape.models import ChannelPlaylistEntry, ChannelPlaylistsResult
        result = ChannelPlaylistsResult(
            channel_id='UC123',
            playlists=[ChannelPlaylistEntry(playlist_id='PL1', title='P1')],
        )
        d = result.to_dict()
        assert d['channel_id'] == 'UC123'
        assert len(d['playlists']) == 1
