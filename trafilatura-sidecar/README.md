# PullMD Trafilatura Sidecar

Companion service for [**PullMD**](https://github.com/AeternaLabsHQ/pullmd) — runs [Trafilatura](https://trafilatura.readthedocs.io/) as a small FastAPI HTTP service so the main pullmd container can use it as an alternative HTML-to-Markdown extractor alongside Mozilla Readability.

This image is **not** useful on its own. Use it together with `aeternalabshq/pullmd`.

## Endpoints

- `GET /health` → `{"ok": true, "trafilatura": "<version>"}`
- `POST /extract` body `{"html": "<…>"}` → `text/plain` Markdown (or empty string if extraction failed)

## Wiring

In your `docker-compose.yml`, run alongside `pullmd` on a shared internal network and set `TRAFILATURA_URL=http://trafilatura:8001/extract` on the pullmd service:

```yaml
services:
  pullmd:
    image: aeternalabshq/pullmd:latest
    environment:
      - TRAFILATURA_URL=http://trafilatura:8001/extract
    depends_on:
      - trafilatura
    networks:
      - pullmd-internal

  trafilatura:
    image: aeternalabshq/pullmd-trafilatura:latest
    networks:
      - pullmd-internal

networks:
  pullmd-internal:
    driver: bridge
```

## Tags

- `latest` — main branch
- `1.1.2`, `1.1`, `sha-<short>` — released versions

Multi-arch: `linux/amd64`, `linux/arm64`.

## Source

[github.com/AeternaLabsHQ/pullmd](https://github.com/AeternaLabsHQ/pullmd) — see `trafilatura-sidecar/` for the source.

## License

[AGPL-3.0-or-later](https://github.com/AeternaLabsHQ/pullmd/blob/main/LICENSE).
