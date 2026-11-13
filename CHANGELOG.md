# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.4.7] - 2026-10-30

### Changed
- Require `scion-sdk>=0.6.4,<0.7.0`; `uv.lock` relocked.

## [4.4.4] - 2026-10-23

### Changed
- Requires `agent-connector-sdk>=0.4.1`; data sources are declared in code (`connector_sources`).

## [Unreleased]

### Added
- `MediaDownloader.get_channel_videos_report(channel, limit=-1)`: tries the `user` and `c` channel URLs and returns a `ChannelVideoReport` with the selected URL, deduplicated links and a per-candidate record (URL, parser, success, raw/unique counts, exception type on failure); video IDs are deduplicated within and across candidates and all-failing or all-empty rounds return an empty miss instead of raising.

### Changed
-

### Fixed
-

## [2.2.55] - 2026-04-29

### Added
- Initial release
