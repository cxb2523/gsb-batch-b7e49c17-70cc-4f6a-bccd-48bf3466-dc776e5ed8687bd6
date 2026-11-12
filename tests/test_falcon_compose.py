"""
The Falcon's sign-in (deploy/compose): nothing is reachable without it.

Every Traefik router in compose.yaml goes through the `auth` middleware, which
traefik/auth-basic.yml or traefik/auth-oidc.yml defines depending on FALCON_AUTH.
Two routers are exceptions on purpose, and only with exactly their rules: the
Crows Nest's health check, and oauth2-proxy's own /oauth2/ paths, which are the
sign-in itself. A new service without the middleware fails here, not in
production.
"""

import pathlib
import re

import pytest

yaml = pytest.importorskip("yaml", reason="pyyaml is not installed")

COMPOSE_DIR = pathlib.Path(__file__).resolve().parent.parent / "deploy" / "compose"

UNGUARDED = {
    "crowsnest-health": re.compile(r"^Host\(`crowsnest\.\$\{DOMAIN\}`\) && Path\(`/api/health`\)$"),
    "oauth2": re.compile(r"^\(Host\(`[a-z]+\.\$\{DOMAIN\}`\)( \|\| Host\(`[a-z]+\.\$\{DOMAIN\}`\))*\) && PathPrefix\(`/oauth2/`\)$"),
}


def _compose() -> dict:
    return yaml.safe_load((COMPOSE_DIR / "compose.yaml").read_text(encoding="utf-8"))


def _routers() -> dict[str, dict[str, str]]:
    """router name -> {setting: value}, from every service's Traefik labels."""
    routers: dict[str, dict[str, str]] = {}
    for service in _compose()["services"].values():
        for label in service.get("labels", []):
            key, _, value = label.partition("=")
            parts = key.split(".")
            if parts[:3] == ["traefik", "http", "routers"]:
                routers.setdefault(parts[3], {})[".".join(parts[4:])] = value
    return routers


def test_every_router_signs_in_except_the_two_exceptions():
    routers = _routers()
    assert {"crowsnest", "dagster", "marimo"} <= routers.keys()
    for name, settings in routers.items():
        if name in UNGUARDED:
            assert UNGUARDED[name].match(settings["rule"]), (name, settings["rule"])
            assert "middlewares" not in settings, name
        else:
            assert settings.get("middlewares") == "auth@file", f"router {name} has no sign-in"


def test_oauth2_paths_cover_every_signed_in_host():
    routers = _routers()
    hosts = set(re.findall(r"Host\(`([a-z]+)\.", routers["oauth2"]["rule"]))
    guarded = {
        re.match(r"Host\(`([a-z]+)\.", settings["rule"]).group(1)
        for name, settings in routers.items()
        if name not in UNGUARDED
    }
    # A host without /oauth2/ routed to oauth2-proxy could never finish signing in.
    assert hosts == guarded


@pytest.mark.parametrize("mode", ["basic", "oidc"])
def test_each_mode_defines_the_auth_middleware(mode):
    config = yaml.safe_load((COMPOSE_DIR / "traefik" / f"auth-{mode}.yml").read_text(encoding="utf-8"))
    assert "auth" in config["http"]["middlewares"]


def test_traefik_reads_the_file_for_the_chosen_mode():
    command = _compose()["services"]["traefik"]["command"]
    assert "--providers.file.filename=/etc/traefik/auth-${FALCON_AUTH:-basic}.yml" in command


def test_a_refused_user_is_not_sent_back_to_the_sign_in():
    # 403 is "signed in, but not allowed": redirecting it to the sign-in would loop.
    config = yaml.safe_load((COMPOSE_DIR / "traefik" / "auth-oidc.yml").read_text(encoding="utf-8"))
    assert config["http"]["middlewares"]["auth-errors"]["errors"]["status"] == ["401"]


def test_the_groups_gate_does_not_ask_for_a_groups_scope():
    # oauth2-proxy adds a `groups` scope of its own when allowed groups are set,
    # unless the scope is given; Keycloak and Entra ID refuse it (invalid_scope).
    env = _compose()["services"]["oauth2-proxy"]["environment"]
    scope = env["OAUTH2_PROXY_SCOPE"]
    assert scope == "${OIDC_SCOPE:-openid email profile}"
    assert "groups" not in scope.split(":-")[1].rstrip("}").split()


def test_unverified_emails_are_refused_unless_asked_for():
    env = _compose()["services"]["oauth2-proxy"]["environment"]
    assert env["OAUTH2_PROXY_INSECURE_OIDC_ALLOW_UNVERIFIED_EMAIL"] == "${OIDC_ALLOW_UNVERIFIED_EMAIL:-false}"


def test_oauth2_proxy_only_runs_for_oidc():
    assert _compose()["services"]["oauth2-proxy"]["profiles"] == ["oidc"]
