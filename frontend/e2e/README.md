# End-to-end tests

These specs drive the real stack: the SPA at `E2E_BASE_URL` (default `http://localhost:5173`) and
the API at `E2E_API_URL` (default `http://localhost:3000`). Both come from `e2e/constants.ts`.

Run the whole suite from the repository root or from `frontend/`:

```bash
pnpm run test:e2e --reporter=line
pnpm -C frontend exec playwright test e2e/two-user-access.spec.ts --reporter=line   # one spec
```

## Prerequisites

- `docker compose up` from the repository root (Postgres, storage, backend, frontend), with
  `ENABLE_DEV_LOGIN=true` so the specs can sign in through `POST /api/auth/dev-login`.
- `RATE_LIMIT_ENABLED=false`, which is the root compose default (the production image keeps
  `true`). Every Playwright context shares one IP, so the limiter produces random 429s. The
  sign-in helper fails with a message naming this flag when it sees one. Set it to `true` only to
  exercise the limiter on purpose, and then run specs one at a time.
- The origins must match what the stack was started with. The browser app talks to `VITE_API_URL`
  and the backend allows `FRONTEND_URL` and sets the session cookie for `AUTH_URL`; the stock
  `.env` uses `localhost`, which is the default here. If yours uses another host, set both
  `E2E_BASE_URL` and `E2E_API_URL` to match.
- Nothing but Docker may listen on the frontend port:

  ```bash
  lsof -nP -iTCP:5173 -sTCP:LISTEN
  ```

  The output must list only Docker. A Vite started on the host once shadowed the container on
  IPv6 and silently invalidated a run.

- After code changes restart the `backend` and `frontend` containers; a long-running dev
  container can serve a stale bundle.

Before the first test, `global-setup.ts` waits (up to 90 seconds) until `${E2E_API_URL}/api/health`
and the base URL answer several times in a row, so a dev-server reload does not hit a spec midway.
It fails with a message naming the URL that never settled.

## CI

Install the browser once per runner:

```bash
pnpm -C frontend exec playwright install --with-deps chromium
```

## The production image journey

`production-image.spec.ts` is not part of the normal run: the dev server sends no content security
policy and has dev login, so it only means something against the production image. Build it, run it in demo mode (which signs in without an
OAuth provider) next to the dev database and object store, and point the spec at it:

```bash
docker build -t canvhq-image-test .
docker compose exec -T db psql -U postgres -c 'CREATE DATABASE canvhq_image'
docker run -d --name canvhq-image --network canvhq-network -p 127.0.0.1:3100:3000 \
  -e NODE_ENV=production -e DEMO_MODE=true -e RATE_LIMIT_ENABLED=false \
  -e AUTH_SECRET=<32+ characters> -e AUTH_URL=http://localhost:3100 -e FRONTEND_URL=http://localhost:3100 \
  -e DATABASE_URL='postgresql://postgres:postgrespassword@db:5432/canvhq_image?schema=public' \
  -e S3_BUCKET_NAME=canvhq-boards -e S3_ACCESS_KEY_ID=minioadmin -e S3_SECRET_ACCESS_KEY=minioadminpassword \
  -e S3_ENDPOINT=http://storage:9000 -e S3_FORCE_PATH_STYLE=true canvhq-image-test
pnpm -C frontend run test:e2e:image        # E2E_IMAGE_URL overrides http://localhost:3100
```

It visits the public pages, signs in with "Try the demo", creates a workspace and a canvas, draws,
reloads, adds an image and reloads, opens a public link as a visitor, and checks that a second demo
visitor cannot see the first one's workspace. It fails on any `securitypolicyviolation` along the
way.

The same command also runs the multi-user specs that matter most on the image: images and save
conflicts, saving a canvas (nothing written on open, leaving with unsaved changes, Reload and
Restore after a conflict), two users with a pending grant, live notifications (the stream must pass
the content security policy), key rotation on removal, workspace key rotation on
demotion, the background re-key job, and the workspace lifecycle. There is no dev login in
production, so they sign in as demo accounts (`E2E_DEMO_SESSIONS`, set by the config); an invited
person signs in first and the invitation goes to the address the server gave them. Specs that need
dev login, a second sign-in of the same person, or people's display names (`role-ui`, `account-e2ee`,
`e2ee-canvas`, `api-contract`, `security-and-isolation`, `unblocked-spec-routes`) stay on the dev
stack. Stop the dev backend and frontend while the image runs: all of it together can exhaust
Docker's memory and Docker then kills the database.

## Notes

- The application has no handle for tests. The specs draw with the mouse, add an image by pasting
  it (`e2e/scene-helpers.ts`; the image tool's own picker uses a system dialog a test cannot
  drive), count shapes from Excalidraw's own statistics panel (Alt+/), and treat "the image came
  back" as the browser fetching the image file and the scene holding the expected shapes (pixels
  are not inspected). A test in `src/lib/design-tokens.test.ts` fails if application code assigns
  anything to `window` or `globalThis`.
- CI runs the suite as three jobs side by side, each with its own stack. The slowest journeys carry
  a tag (`@journeys-1`, `@journeys-2`) so they get a job each; every other test, including a spec
  you add later, runs in the third (`--grep-invert`). Locally you can run one group the same way:
  `pnpm -C frontend exec playwright test --grep @journeys-1`. When you add a long journey, tag it
  so no job becomes the slow one again (a job's time is its slowest tests added up).
- The `rbac-*.spec.ts` files are access-control journeys built on `rbac-cast.ts`. A scenario sets a
  small cast up through the real screens (so every key is wrapped in a browser), changes who may
  do what (join, grant, role changes, removal, hand-over, account erasure, a new device), and after
  every step calls `cast.expectAccess(canvases, ...)`: for every canvas ever made, who must be able
  to edit it, who read-only, who is waiting for a key, and who is refused (UI and server). A change
  to roles, grants, keys or rotation should add its event to one of these journeys rather than
  test the one thing in isolation: a canvas made after a key rotation that nobody could open was
  missed exactly because every older test looked at one step at a time. Saves take turns in the
  harness because two people saving one canvas at once is a conflict by design.
- `account-e2ee.spec.ts` and `workspace-lifecycle.spec.ts` are serial, one-user journeys; the
  multi-user and rotation specs create their own users and workspaces, so specs do not share data.
