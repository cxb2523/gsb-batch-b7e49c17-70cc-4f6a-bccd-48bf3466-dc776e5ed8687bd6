# Synchroplayer

Synchronized video player for watching videos together remotely.

[![](header.png)](https://movie.tom32i.fr)

Demo: https://movie.tom32i.fr

## Currently supported contents

| Content | Format | Method |
| ------- | ------ | ------ |
| Local video files | `.mp4`, `.mkv`, `.mov` | Drag & drop |
| Local subtitles files | `.vtt`, `.srt` | Drag & drop |
| Remote video url | Any url | Copy & paste |
| Youtube video url | `https://www.youtube.com/watch?v=BathEBfiG1s`, `https://youtu.be/BathEBfiG1s` | Copy & paste |

## Tests

The drop/paste dispatch is covered by offline tests that use synthetic `File`/`Blob` objects and a fake `XMLHttpRequest` (no network, browser, or installed dependencies required):

    npm test

Or directly:

    node --import ./test/register.mjs --test test/drop-handler.test.mjs

Tests require Node.js 24+ (see `.nvmrc`).

## License

[MIT](./LICENSE)
