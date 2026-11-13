# CONN-MEDIA-DOWNLOADER — Implementation plan

Governing spec: [spec.md](spec.md). Rows: [requirements.md](requirements.md).

## Summary

This plan states how `media-downloader` delivers the rows of `CONN-MEDIA-DOWNLOADER`. The live caller is the `media-downloader` console script. The owner is the `media_downloader` package. The rows reuse the `scion-sdk` helpers and add no second authority. The plan changes no runtime code.

## Technical Context

- **Language/Version**: Python >=3.12
- **Primary Dependencies**: scion-sdk[mcp]>=0.6.4,<0.7.0; fastmcp; further pins in `pyproject.toml` (scion-sdk[mcp]>=0.6.4,<0.7.0, pyyaml>=6.0.3, yt-dlp[default]>=2026.8.19, requests>=2.34.2)
- **Storage**: N/A, the connector keeps no store of its own
- **Testing**: pytest; each row names the proving test as `path::name`
- **Target Platform**: Linux container and stdio or streamable HTTP MCP clients
- **Project Type**: connector
- **Performance Goals**: N/A, the vendor service sets the latency
- **Constraints**: vendor calls go through the SDK governed client; no connector-local transport
- **Scale/Scope**: 2 active row(s) in this spec

## Constitution Check

- Organization constitution 1.5.0, spec-first change: pass. Every behaviour is a row of this spec with a bound or planned test.
- Repository article R-I, connector scope: pass. The rows stay inside this connector's one external system and reuse the SDK for shared capabilities.

## Project Structure

- `media_downloader/media_downloader.py` (existing)
- `tests/test_coverage_booster.py` (existing)

## Phase 0: Research

No unknowns. Every row names its code and test; the caller chain of each row was read from the code.

## Phase 1: Design

### Summary

This plan states how `media-downloader` delivers the rows of `CONN-MEDIA-DOWNLOADER`. The live caller is the `media-downloader` console script. The owner is the `media_downloader` package. The rows reuse the `scion-sdk` helpers and add no second authority. The plan changes no runtime code.

### Technical Context

- **Language/Version**: Python >=3.12
- **Primary Dependencies**: scion-sdk[mcp]>=0.6.4,<0.7.0; fastmcp; further pins in `pyproject.toml` (scion-sdk[mcp]>=0.6.4,<0.7.0, pyyaml>=6.0.3, yt-dlp[default]>=2026.8.19, requests>=2.34.2)
- **Storage**: N/A, the connector keeps no store of its own
- **Testing**: pytest; each row names the proving test as `path::name`
- **Target Platform**: Linux container and stdio or streamable HTTP MCP clients
- **Project Type**: connector
- **Performance Goals**: N/A, the vendor service sets the latency
- **Constraints**: vendor calls go through the SDK governed client; no connector-local transport
- **Scale/Scope**: 2 active row(s) in this spec

### Constitution Check

- Organization constitution 1.5.0, spec-first change: pass. Every behaviour is a row of this spec with a bound or planned test.
- Repository article R-I, connector scope: pass. The rows stay inside this connector's one external system and reuse the SDK for shared capabilities.

### Project Structure

- `media_downloader/media_downloader.py` (existing)
- `tests/test_coverage_booster.py` (existing)

### Phase 0: Research

No unknowns. Every row names its code and test; the caller chain of each row was read from the code.

### Phase 1: Design

### Summary

This plan states how `media-downloader` delivers the rows of `CONN-MEDIA-DOWNLOADER`. The live caller is the `media-downloader` console script. The owner is the `media_downloader` package. The rows reuse the `scion-sdk` helpers and add no second authority. The plan changes no runtime code.

### Technical Context

- **Language/Version**: Python >=3.12
- **Primary Dependencies**: scion-sdk[mcp]>=0.6.4,<0.7.0; fastmcp; further pins in `pyproject.toml` (scion-sdk[mcp]>=0.6.4,<0.7.0, pyyaml>=6.0.3, yt-dlp[default]>=2026.8.19, requests>=2.34.2)
- **Storage**: N/A, the connector keeps no store of its own
- **Testing**: pytest; each row names the proving test as `path::name`
- **Target Platform**: Linux container and stdio or streamable HTTP MCP clients
- **Project Type**: connector
- **Performance Goals**: N/A, the vendor service sets the latency
- **Constraints**: vendor calls go through the SDK governed client; no connector-local transport
- **Scale/Scope**: 2 active row(s) in this spec

### Constitution Check

- Organization constitution 1.5.0, spec-first change: pass. Every behaviour is a row of this spec with a bound or planned test.
- Repository article R-I, connector scope: pass. The rows stay inside this connector's one external system and reuse the SDK for shared capabilities.

### Project Structure

- `media_downloader/media_downloader.py` (existing)
- `tests/test_coverage_booster.py` (existing)

### Phase 0: Research

No unknowns. Every row names its code and test; the caller chain of each row was read from the code.

### Phase 1: Design

### Summary

This plan states how `media-downloader` delivers the rows of `CONN-MEDIA-DOWNLOADER`. The live caller is the `media-downloader` console script. The owner is the `media_downloader` package. The rows reuse the `scion-sdk` helpers and add no second authority. The plan changes no runtime code.

### Technical Context

- **Language/Version**: Python >=3.12
- **Primary Dependencies**: scion-sdk[mcp]>=0.6.4,<0.7.0; fastmcp; further pins in `pyproject.toml` (scion-sdk[mcp]>=0.6.4,<0.7.0, pyyaml>=6.0.3, yt-dlp[default]>=2026.8.19, requests>=2.34.2)
- **Storage**: N/A, the connector keeps no store of its own
- **Testing**: pytest; each row names the proving test as `path::name`
- **Target Platform**: Linux container and stdio or streamable HTTP MCP clients
- **Project Type**: connector
- **Performance Goals**: N/A, the vendor service sets the latency
- **Constraints**: vendor calls go through the SDK governed client; no connector-local transport
- **Scale/Scope**: 2 active row(s) in this spec

### Constitution Check

- Organization constitution 1.5.0, spec-first change: pass. Every behaviour is a row of this spec with a bound or planned test.
- Repository article R-I, connector scope: pass. The rows stay inside this connector's one external system and reuse the SDK for shared capabilities.

### Project Structure

- `media_downloader/media_downloader.py` (existing)
- `tests/test_coverage_booster.py` (existing)

### Phase 0: Research

No unknowns. Every row names its code and test; the caller chain of each row was read from the code.

### Phase 1: Design

### Summary

This plan states how `media-downloader` delivers the rows of `CONN-MEDIA-DOWNLOADER`. The live caller is the `media-downloader` console script. The owner is the `media_downloader` package. The rows reuse the `scion-sdk` helpers and add no second authority. The plan changes no runtime code.

### Technical Context

- **Language/Version**: Python >=3.12
- **Primary Dependencies**: scion-sdk[mcp]>=0.6.4,<0.7.0; fastmcp; further pins in `pyproject.toml` (scion-sdk[mcp]>=0.6.4,<0.7.0, pyyaml>=6.0.3, yt-dlp[default]>=2026.8.19, requests>=2.34.2)
- **Storage**: N/A, the connector keeps no store of its own
- **Testing**: pytest; each row names the proving test as `path::name`
- **Target Platform**: Linux container and stdio or streamable HTTP MCP clients
- **Project Type**: connector
- **Performance Goals**: N/A, the vendor service sets the latency
- **Constraints**: vendor calls go through the SDK governed client; no connector-local transport
- **Scale/Scope**: 2 active row(s) in this spec

### Constitution Check

- Organization constitution 1.5.0, spec-first change: pass. Every behaviour is a row of this spec with a bound or planned test.
- Repository article R-I, connector scope: pass. The rows stay inside this connector's one external system and reuse the SDK for shared capabilities.

### Project Structure

- `media_downloader/media_downloader.py` (existing)
- `tests/test_coverage_booster.py` (existing)

### Phase 0: Research

No unknowns. Every row names its code and test; the caller chain of each row was read from the code.

### Phase 1: Design

### Existing system and reuse

The SDK tool surface registers each public `MediaDownloader` method as a tool. The tool result is the method return value.

### Architecture

`get_channel_videos` tries each channel URL form. `_append_links` queues the links on `self.links` and returns the queued links. `get_channel_videos` returns that list.

A channel page lists its videos in embedded initial data, not in `href` anchors. `_canonical_channel_video_links` reads the `videoId` values when it finds no anchor.

### Interfaces and data model

The tool returns a list of video URLs. The `channel` and `limit` arguments do not change.

### Live integration path

The fleet gateway calls `media_downloader_get_channel_videos`. The SDK tool surface builds a client with `get_client` and returns the method result.

### Quality and release gates

The focused tests run with `pytest -q`. A merge to the default branch publishes the package and the image.

### Risks, alternatives, and decisions

The method returned no value before, so the tool returned empty content. Each tool call builds a new client, so the return value is the only result channel.

### Phase 2: Task approach

`tasks.md` holds one task per row, producer first. Rows that depend on none run in parallel. A task is checked when its `Spec:` trailer is on the default branch.

### Complexity Tracking

None. The constitution check passed.

### Build contract

- `pre-commit run --all-files` runs ruff check, ruff format, the shared `connector-standard`, `spec`, `secrets` and `dependency-readiness` gates at the pinned shared revision.
- `uv run pytest tests` runs the proving tests; the shared complexity, duplication and KISS gates apply their org thresholds and this repository sets no local override.
- A change adds no scanner suppression and no duplicate implementation of an SDK helper.

### Production caller chain


### Cross-repo seams

None. The rows depend only on the published `scion-sdk` package, which the connector imports.

### Phase 2: Task approach

`tasks.md` holds one task per row, producer first. Rows that depend on none run in parallel. A task is checked when its `Spec:` trailer is on the default branch.

### Complexity Tracking

None. The constitution check passed.

### Build contract

- `pre-commit run --all-files` runs ruff check, ruff format, the shared `connector-standard`, `spec`, `secrets` and `dependency-readiness` gates at the pinned shared revision.
- `uv run pytest tests` runs the proving tests; the shared complexity, duplication and KISS gates apply their org thresholds and this repository sets no local override.
- A change adds no scanner suppression and no duplicate implementation of an SDK helper.

### Production caller chain

- `CONN-MEDIA-DOWNLOADER-R001`: the `media_downloader` console script calls `media_downloader` (`media_downloader/media_downloader.py:1311`), which calls `MediaDownloader.get_channel_videos` (`media_downloader/media_downloader.py:1112`).
- `CONN-MEDIA-DOWNLOADER-R001.1`: `get_channel_videos` (`media_downloader/media_downloader.py:1112`) calls `_canonical_channel_video_links` (`media_downloader/media_downloader.py:1068`), which falls back to `_embedded_channel_video_links`.

### Cross-repo seams

None. The rows depend only on the published `scion-sdk` package, which the connector imports.

### Phase 2: Task approach

`tasks.md` holds one task per row, producer first. Rows that depend on none run in parallel. A task is checked when its `Spec:` trailer is on the default branch.

### Complexity Tracking

None. The constitution check passed.

### Build contract

- `pre-commit run --all-files` runs ruff check, ruff format, the shared `connector-standard`, `spec`, `secrets` and `dependency-readiness` gates at the pinned shared revision.
- `uv run pytest tests` runs the proving tests; the shared complexity, duplication and KISS gates apply their org thresholds and this repository sets no local override.
- A change adds no scanner suppression and no duplicate implementation of an SDK helper.

### Production caller chain

- `CONN-MEDIA-DOWNLOADER-R001`: the `media_downloader` console script calls `media_downloader` (`media_downloader/media_downloader.py:1311`), which calls `MediaDownloader.get_channel_videos` (`media_downloader/media_downloader.py:1112`).
- `CONN-MEDIA-DOWNLOADER-R001.1`: `get_channel_videos` (`media_downloader/media_downloader.py:1112`) calls `_canonical_channel_video_links` (`media_downloader/media_downloader.py:1068`), which falls back to `_embedded_channel_video_links`.

### Cross-repo seams

None. The rows depend only on the published `scion-sdk` package, which the connector imports.

### Phase 2: Task approach

`tasks.md` holds one task per row, producer first. Rows that depend on none run in parallel. A task is checked when its `Spec:` trailer is on the default branch.

### Complexity Tracking

None. The constitution check passed.

### Build contract

- `pre-commit run --all-files` runs ruff check, ruff format, the shared `connector-standard`, `spec`, `secrets` and `dependency-readiness` gates at the pinned shared revision.
- `uv run pytest tests` runs the proving tests; the shared complexity, duplication and KISS gates apply their org thresholds and this repository sets no local override.
- A change adds no scanner suppression and no duplicate implementation of an SDK helper.

### Production caller chain

- `CONN-MEDIA-DOWNLOADER-R001`: the `media_downloader` console script calls `media_downloader` (`media_downloader/media_downloader.py:1311`), which calls `MediaDownloader.get_channel_videos` (`media_downloader/media_downloader.py:1112`).
- `CONN-MEDIA-DOWNLOADER-R001.1`: `get_channel_videos` (`media_downloader/media_downloader.py:1112`) calls `_canonical_channel_video_links` (`media_downloader/media_downloader.py:1068`), which falls back to `_embedded_channel_video_links`.

### Cross-repo seams

None. The rows depend only on the published `scion-sdk` package, which the connector imports.

## Phase 2: Task approach

`tasks.md` holds one task per row, producer first. Rows that depend on none run in parallel. A task is checked when its `Spec:` trailer is on the default branch.

## Complexity Tracking

None. The constitution check passed.

## Build contract

- `pre-commit run --all-files` runs ruff check, ruff format, the shared `connector-standard`, `spec`, `secrets` and `dependency-readiness` gates at the pinned shared revision.
- `uv run pytest tests` runs the proving tests; the shared complexity, duplication and KISS gates apply their org thresholds and this repository sets no local override.
- A change adds no scanner suppression and no duplicate implementation of an SDK helper.

## Production caller chain

- `CONN-MEDIA-DOWNLOADER-R001`: the `media_downloader` console script calls `media_downloader` (`media_downloader/media_downloader.py:1311`), which calls `MediaDownloader.get_channel_videos` (`media_downloader/media_downloader.py:1112`).
- `CONN-MEDIA-DOWNLOADER-R001.1`: `get_channel_videos` (`media_downloader/media_downloader.py:1112`) calls `_canonical_channel_video_links` (`media_downloader/media_downloader.py:1068`), which falls back to `_embedded_channel_video_links`.

## Cross-repo seams

None. The rows depend only on the published `scion-sdk` package, which the connector imports.

## Amendments

### 2026-11-13 - CONN-MEDIA-DOWNLOADER-R001.2 channel candidate report

`MediaDownloader.get_channel_videos_report` (`media_downloader/media_downloader.py`) reuses `_channel_video_url_candidates` to try the `user` then `c` URLs, always attempting both so the report stays complete. Each attempt is recorded with its URL, parser name, success flag, raw parser count, in-candidate unique count and, when the fetch or parser raises, the exception type; a failed candidate never interrupts the round.

`_channel_video_identity` derives a video-ID key from each parsed link (falling back to the link itself), so deduplication by ID applies inside one candidate and across candidates with the first page-order occurrence winning. The first candidate contributing a new link is the selected URL. The returned `ChannelVideoReport` carries the selected URL, `hit` flag, limited deduplicated links and every `ChannelVideoCandidateReport`; `to_dict` renders it for the MCP tool surface. Only links not already on `self.links` are appended. All-empty or all-failing rounds return an empty miss instead of raising. `get_channel_videos` is untouched and keeps its retry, append and return behaviour.

Production caller chain: the SDK tool surface registers the public method as `media_downloader_get_channel_videos_report`, bound in `media_downloader/connector_contracts.py` under the `media-downloader-inspect-channel` contract. Proving tests live in `tests/test_channel_video_report.py` (normal hit, candidate fallback, parser/fetch exception, all-empty and all-failing).
