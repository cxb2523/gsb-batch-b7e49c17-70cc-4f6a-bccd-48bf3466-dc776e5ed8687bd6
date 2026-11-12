from __future__ import annotations

import base64

import pytest

from tubescrape._filters import SearchFilter


class TestSearchFilterBuild:
    """Test protobuf search filter encoding."""

    def test_no_filters_returns_empty(self):
        assert SearchFilter.build() == ''

    def test_sort_by_relevance_returns_empty(self):
        # Relevance is the default (value 0), should be omitted
        assert SearchFilter.build(sort_by='relevance') == ''

    def test_sort_by_upload_date(self):
        result = SearchFilter.build(sort_by='upload_date')
        assert result != ''
        # Decode to verify it's valid base64
        decoded = base64.b64decode(result)
        assert len(decoded) > 0

    def test_sort_by_view_count(self):
        result = SearchFilter.build(sort_by='view_count')
        assert result != ''

    def test_type_video(self):
        result = SearchFilter.build(type='video')
        assert result != ''

    def test_duration_long(self):
        result = SearchFilter.build(duration='long')
        assert result != ''

    def test_upload_date_this_week(self):
        result = SearchFilter.build(upload_date='this_week')
        assert result != ''

    def test_features_single(self):
        result = SearchFilter.build(features='hd')
        assert result != ''

    def test_features_list(self):
        result = SearchFilter.build(features=['4k', 'hdr'])
        assert result != ''

    def test_combined_filters(self):
        result = SearchFilter.build(
            sort_by='view_count',
            type='video',
            duration='long',
            upload_date='this_week',
        )
        assert result != ''

    def test_invalid_sort_by_raises(self):
        with pytest.raises(ValueError, match='Invalid sort_by'):
            SearchFilter.build(sort_by='invalid')

    def test_invalid_type_raises(self):
        with pytest.raises(ValueError, match='Invalid type'):
            SearchFilter.build(type='invalid')

    def test_invalid_duration_raises(self):
        with pytest.raises(ValueError, match='Invalid duration'):
            SearchFilter.build(duration='invalid')

    def test_invalid_upload_date_raises(self):
        with pytest.raises(ValueError, match='Invalid upload_date'):
            SearchFilter.build(upload_date='invalid')

    def test_invalid_feature_raises(self):
        with pytest.raises(ValueError, match='Invalid feature'):
            SearchFilter.build(features='invalid')

    def test_case_insensitive(self):
        result1 = SearchFilter.build(type='Video')
        result2 = SearchFilter.build(type='video')
        assert result1 == result2

    def test_alias_date(self):
        result1 = SearchFilter.build(sort_by='date')
        result2 = SearchFilter.build(sort_by='upload_date')
        assert result1 == result2
