# Contributing

## Development

### Install dependencies

    make install

### Build project

Build once:

    make build

or launch watcher:

    make watch

### Linting

    make lint

### Testing

The tests run offline with Node's built-in test runner (synthetic `File`/`Blob` objects and a fake `XMLHttpRequest`, no network or browser required):

    make test

or:

    npm test

### Sart local server

    make start-client

    make start-server

    open http://localhost:8000

