# Contributing

Thanks for helping. This page is what you need to open a pull request that can be merged.

## Run it

You need Docker.

```bash
docker compose up --build   # Postgres, object storage, backend :3000, frontend :5173
```

The containers install their own dependencies and generate the Prisma client, so nothing else is needed to try the app or change code with hot reload.

## Before you open a pull request

The checks below run on your machine, outside the containers, so install the packages there first. You need Node 22 or newer and pnpm at the version in the root `package.json` (`packageManager`).

```bash
pnpm -C backend install --frozen-lockfile
pnpm -C backend run generate     # the Prisma client; the backend's type-check, build and tests need it on your machine too
pnpm -C frontend install --frozen-lockfile
```

Use pnpm, not npm. Do not add a root workspace file: the two packages stay independent on purpose.

## Checks a pull request must pass

```bash
pnpm run format:check
pnpm run typecheck
pnpm run lint            # may only go down: the warning ceilings are in each package.json
pnpm run test            # unit tests for both packages
docker compose up -d db storage && pnpm -C backend run test:integration
pnpm run test:e2e        # with the dev stack running; see frontend/e2e/README.md
```

`pnpm run format` may need two passes on a few files. Continuous integration runs the same checks, except the browser tests, which run on every merge to `main` and on a pull request that carries the `e2e` label (add it if you touched access, keys or the Docker image).

## Pull requests and releases

Pull requests are squash-merged, so the **title becomes the commit message** and a check enforces its form: `feat: ...` for something users will notice (a new version), `fix: ...` for a bug fix (a patch), or `docs:`, `chore:`, `test:`, `ci:`, `refactor:`, `perf:`, `build:` for the rest, which stay out of the release notes. Maintainers release by merging the standing "release" pull request that a bot keeps up to date; that creates the tag, the GitHub release and the Docker image. You never edit the version by hand.

## Rules that are easy to miss

- **A bug fix comes with a test that fails without the fix.** Anything touching data integrity is tested against a real Postgres, not a mocked client.
- **The server must never see canvas plaintext or keys.** All encryption happens in the browser. See `AGENTS.md` for the key layers.
- **Use what the project already depends on:** Better Auth for sign-in, CASL for permissions, Zod for validation, TanStack Query for server state. Do not add a parallel home-grown version.
- **Colours come from the tokens in `frontend/src/index.css`.** No arbitrary hex classes; a test fails on them.
- **Words matter.** Anything users read must be literally true and short. No "impossible", "nobody can", "100%", "guaranteed", and do not describe a third party's prices, limits or terms. Put technical detail in a collapsed section. A test checks the pages and docs for banned wording.
- **Schema changes are migrations** (`prisma migrate dev --name ...`). Never `db push` or `--accept-data-loss`.
- **No AI attribution** in commit messages, pull requests, code or docs.
- Commit in meaningful chunks, not one commit per keystroke.

## Conduct and security

Be kind: see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).
