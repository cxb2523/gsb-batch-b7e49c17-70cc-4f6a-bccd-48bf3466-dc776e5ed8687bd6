# The Falcon: the platform on Docker Compose

The Falcon is the second vessel: the same project and lake as the Optimist on a laptop, on one
Linux VM, behind Traefik over HTTPS:

| URL | Service |
|---|---|
| `https://crowsnest.<DOMAIN>` | Crows Nest |
| `https://dagster.<DOMAIN>` | Dagster UI (`dagster-webserver`); `dagster-daemon` runs the schedules |
| `https://marimo.<DOMAIN>` | Marimo notebooks |
| `https://apps.<DOMAIN>` | The project's apps (`marimo run apps/`), shown in the Crows Nest's Dashboards tab |

Only Traefik publishes ports (80 and 443); every service sits behind a sign-in, except the Crows
Nest's `/api/health`, for an uptime check. Certificates come from Let's Encrypt.

The project lives on the host in `FALCON_DIR/PROJECT` (default `/srv/falcon/noaa`), with
its lake in `lake/` as on a laptop. Dagster's own state (runs, schedules) is in the `dagster_home`
volume, so a schedule switched off in the UI stays off.

## Choices

- **One image for every service**, built from this checkout with the versions in `uv.lock`, so the
  VM runs what CI tested. Building from the PyPI release a project pins, with the deploy files in
  the project itself, is planned (#55).
- **Marimo is its own service**, not started by the Crows Nest as on a laptop: one notebook server,
  reachable at its own URL. The Crows Nest links to it (`CROWSNEST_MARIMO_PUBLIC_URL`).
- **One sign-in in front of everything**: the `auth` middleware on every router, from
  `traefik/auth-<FALCON_AUTH>.yml`. Basic auth (`basic`, the default) or single sign-on through the
  customer's identity provider (`oidc`, below). Marimo runs code on the VM, so nothing may be
  reachable without it. Leave `CROWSNEST_AUTH_TOKEN` unset, or users sign in twice.
- **Access is all or nothing**: whoever gets past the sign-in sees everything. Who gets in is
  decided at the identity provider, or with `OIDC_ALLOWED_GROUPS`. Roles per user are the
  Catamaran's.

## On the VM

A VM from `deploy/thalassa` has Docker, a `deploy` user and `/srv/falcon`. DNS: a wildcard
record `*.<DOMAIN>` pointing at the server, before the first start, or Let's Encrypt fails.

```bash
ssh deploy@<ip>
git clone https://github.com/datavloot/datavloot-toolkit.git
cd datavloot-toolkit/deploy/compose

cp .env.example .env
nano .env               # DOMAIN, ACME_EMAIL; FALCON_DEMO=1 for the NOAA demo
# The services run as the owner of /srv/falcon:
sed -i "s/^FALCON_UID=.*/FALCON_UID=$(id -u)/; s/^FALCON_GID=.*/FALCON_GID=$(id -g)/" .env

# A user for the sign-in; the password is asked for, not typed on the command line.
read -rsp 'Password: ' pw; echo
printf '%s\n' "$pw" | docker run --rm -i httpd:2.4-alpine htpasswd -niB <user> > traefik/users.htpasswd
unset pw

docker compose up -d --build
docker compose ps       # prepare has exited (0), the rest is running
```

More users: run the `htpasswd` line again with `>>` instead of `>`, then `docker compose restart traefik`.

Updating to a newer toolkit: `git pull`, then `docker compose up -d --build`.

## Single sign-on with the customer's identity provider

With `FALCON_AUTH=oidc`, people sign in with the account they already have: Microsoft Entra ID,
Google Workspace, Keycloak, or any other OpenID Connect provider. Traefik asks oauth2-proxy about
every request, and oauth2-proxy sends whoever is not signed in to the provider. One sign-in covers
the Crows Nest, Dagster, Marimo and the apps.

1. At the provider, register an application, a confidential OIDC client, with four redirect URIs:
   `https://crowsnest.<DOMAIN>/oauth2/callback`, `https://dagster.<DOMAIN>/oauth2/callback`,
   `https://marimo.<DOMAIN>/oauth2/callback` and `https://apps.<DOMAIN>/oauth2/callback`. Note its issuer URL, client ID and client secret.
2. In `.env`: `FALCON_AUTH=oidc`, and the `OIDC_*` settings (see `.env.example`). Generate the
   cookie secret with `openssl rand -base64 32 | tr -- '+/' '-_'`.
3. `docker compose up -d`. This starts oauth2-proxy and switches Traefik over; `users.htpasswd`
   is no longer used.

Back to basic auth: `FALCON_AUTH=basic`, then `docker compose up -d --remove-orphans`.

### Microsoft Entra ID

- **App registration**, single tenant, a *Web* platform with the four redirect URIs, and a client
  secret. The issuer URL is `https://login.microsoftonline.com/<tenant id>/v2.0`.
- **Client secrets expire**, after 24 months at most. Agree with the customer who renews it, and
  when; an expired secret locks everyone out.
- **The token often has no `email` claim.** Set `OIDC_EMAIL_CLAIM=preferred_username`, or
  oauth2-proxy refuses the user. Entra ID normally sends no `email_verified` claim, so nothing
  more is needed; check it on the customer's tenant. A provider that does send
  `email_verified=false` for these users needs `OIDC_ALLOW_UNVERIFIED_EMAIL=true` as well.
- **Who gets in:** set *Assignment required* on the Enterprise application and assign the users or
  a group there. That keeps the decision with the customer, in Entra. `OIDC_ALLOWED_GROUPS` works
  too, but Entra puts group object IDs in the `groups` claim, not names, and leaves the claim out
  for users in more than about 200 groups. The claim has to be added to the app registration
  (*Token configuration*, optional claim `groups`); it is a claim, not a scope.

### Testing single sign-on

`test-idp/` runs Keycloak as a stand-in for the customer's provider, at `idp.<DOMAIN>`, behind the
Falcon's own Traefik. Its realm has a client `falcon` and three users: `alice` (in the group
`falcon-users`), `bob` (in the group, no email address, as an Entra user often looks) and `carol`
(not in the group). Not for production: dev mode and test passwords.

```bash
cd test-idp
cp .env.example .env
nano .env               # DOMAIN, and three secrets: openssl rand -base64 24
docker compose up -d    # the Falcon must be running: Keycloak joins its network
cd ..
```

Then in the Falcon's `.env`: `FALCON_AUTH=oidc`, `OIDC_ISSUER_URL=https://idp.<DOMAIN>/realms/falcon`,
`OIDC_CLIENT_ID=falcon`, `OIDC_CLIENT_SECRET` = `FALCON_TEST_CLIENT_SECRET` from `test-idp/.env`,
a cookie secret, and `docker compose up -d`.

| Case | Expected |
|---|---|
| Not signed in, open each of the four hosts | Redirected to the Keycloak sign-in |
| `alice` signs in at the Crows Nest | In; Dagster, Marimo and the Dashboards tab then open without a second sign-in |
| `bob` (no email), `OIDC_EMAIL_CLAIM=email` | Refused: `Internal Server Error`, and `email in id_token () isn't verified` in the oauth2-proxy log |
| `bob`, `OIDC_EMAIL_CLAIM=preferred_username` | Still refused: Keycloak sends `email_verified=false` for him |
| `bob`, and also `OIDC_ALLOW_UNVERIFIED_EMAIL=true` | In |
| `carol`, with `OIDC_ALLOWED_GROUPS=falcon-users` | `403`; without the group setting: in |
| Sign out (`/oauth2/sign_out`) | The next request asks to sign in again |
| `https://crowsnest.<DOMAIN>/api/health`, not signed in | `200` |
| A Marimo notebook after signing in | The kernel connects |
| `FALCON_AUTH=basic` again | The basic-auth prompt; oauth2-proxy is gone |

Afterwards: `docker compose down` in `test-idp/`, and `FALCON_AUTH` back as it was.

## On a laptop

To try the stack without a VM, TLS or DNS (Docker Desktop):

```bash
cd deploy/compose
docker run --rm httpd:2.4-alpine htpasswd -nbB demo demo > traefik/users.htpasswd
docker compose --env-file local.env -f compose.yaml -f compose.local.yaml up -d --build
```

Then `http://crowsnest.localhost:8000` (user and password `demo`). The project lives in a Docker
volume here, not in a directory: SQLite's locking, which the lake's catalog relies on, is not
reliable on a directory shared from Windows or macOS into a container.

## Troubleshooting

- `docker compose logs prepare`: the demo, `dbt deps` and `dbt parse` run here, once per start.
- `docker compose logs traefik`: certificate and routing errors.
- `docker compose logs oauth2-proxy`: single sign-on. At start it fetches the provider's
  configuration from `OIDC_ISSUER_URL`; until that works it restarts. After signing in at the
  provider, `Internal Server Error` on `/oauth2/callback` is a user oauth2-proxy refuses; the log
  says why: `email in id_token () isn't verified` (no `email` claim, see `OIDC_EMAIL_CLAIM`, or
  `OIDC_ALLOW_UNVERIFIED_EMAIL`). `403` straight after the redirect, without a sign-in page, with
  `invalid_scope` in the log: the provider refuses a scope; `OIDC_SCOPE` must hold only scopes it
  knows (the default does).
- `PermissionError` in `prepare`: `FALCON_UID`/`FALCON_GID` in `.env` do not match the owner of
  `FALCON_DIR`. Fix them, then `docker compose up -d --build`.
- Traefik older than 3.6 cannot talk to Docker Engine 29 (`API returned a 400`).
- `alembic_version has more than one head` from `dagster-webserver`, `dagster-daemon` or a run:
  Dagster's storage was created by several services at once, on a stack started before `prepare`
  created it (#45). `prepare` cannot repair such a storage. With no run history to keep, start
  Dagster's state over: `docker compose down`, `docker volume rm falcon_dagster_home`,
  `docker compose up -d`. Not `down -v`: that also removes the certificates.
