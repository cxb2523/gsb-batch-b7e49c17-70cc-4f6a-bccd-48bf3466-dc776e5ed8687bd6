"""Inicializa PostgreSQL local aislado en puerto 55432 y configura backend/.env."""
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
BIN = Path(os.environ.get("SENTRIX_POSTGRES_BIN", "C:/Program Files/PostgreSQL/18/bin"))
DATA = ROOT / "data" / "postgres"
ENV = ROOT / ".env"


def run(tool, *args):
    subprocess.run([str(BIN / (tool + ".exe")), *map(str, args)], check=True)


def ensure_running():
    from dotenv import load_dotenv
    load_dotenv(ENV, override=False)
    url = urlsplit(os.environ.get("SENTRIX_DATABASE_URL", ""))
    if url.scheme not in ("postgresql", "postgres") or not url.hostname:
        raise SystemExit("Configurar SENTRIX_DATABASE_URL en backend/.env")
    host, port = url.hostname, url.port or 5432
    try:
        with socket.create_connection((host, port), timeout=2):
            print(f"PostgreSQL disponible en {host}:{port}", flush=True)
            return
    except OSError:
        pass
    if host not in ("127.0.0.1", "localhost", "::1"):
        raise SystemExit(f"PostgreSQL remoto no responde en {host}:{port}")
    candidates = [DATA, ROOT.parents[1] / "archivo_local/backend/data/postgres"]
    configured_data = os.environ.get("SENTRIX_POSTGRES_DATA")
    if configured_data:
        candidates = [Path(configured_data)]
    for data in candidates:
        if not (data / "PG_VERSION").is_file():
            continue
        result = subprocess.run(
            [str(BIN / "postgres.exe"), "-D", str(data), "-C", "port"],
            capture_output=True, text=True, check=True)
        if int(result.stdout.strip()) != port:
            continue
        print(f"Iniciando PostgreSQL local en el puerto {port}...", flush=True)
        run("pg_ctl", "-D", data, "-l", data.parent / "postgres.log", "-w", "start")
        return
    raise SystemExit(
        f"PostgreSQL no responde en {host}:{port}. "
        "Configurar SENTRIX_POSTGRES_DATA con la carpeta del cluster existente.")


if __name__ == "__main__":
    if sys.argv[1:] == ["--ensure-running"]:
        ensure_running()
        raise SystemExit(0)
    if sys.argv[1:]:
        raise SystemExit("Uso: setup_postgres.py [--ensure-running]")
    if DATA.exists():
        raise SystemExit(f'El cluster ya existe. Arrancar con: "{BIN / "pg_ctl.exe"}" -D "{DATA}" -l "{DATA.parent / "postgres.log"}" -w start')
    existing = ENV.read_text(encoding="utf-8") if ENV.exists() else ""
    if any(line.startswith("SENTRIX_DATABASE_URL=") and line.split("=", 1)[1].strip()
           for line in existing.splitlines()):
        raise SystemExit("Ya hay conexión configurada; no se modifica")
    password = secrets.token_urlsafe(32)
    DATA.parent.mkdir(parents=True, exist_ok=True)
    password_file = DATA.parent / ".pg-init-password"
    try:
        password_file.write_text(password, encoding="utf-8")
        run("initdb", "-D", DATA, "-U", "sentrix", "--auth=scram-sha-256",
            "--pwfile", password_file, "--encoding=UTF8", "--locale=C")
    finally:
        password_file.unlink(missing_ok=True)
    with (DATA / "postgresql.conf").open("a", encoding="utf-8") as output:
        output.write("\nlisten_addresses = '127.0.0.1'\nport = 55432\n")
    admin_url = f"postgresql://sentrix:{password}@127.0.0.1:55432/postgres"
    (DATA.parent / "postgres-admin.env").write_text(f"SENTRIX_ADMIN_DATABASE_URL={admin_url}\n", encoding="utf-8")
    run("pg_ctl", "-D", DATA, "-l", DATA.parent / "postgres.log", "-w", "start")
    import psycopg
    admin_url = f"postgresql://sentrix:{password}@127.0.0.1:55432/postgres"
    app_password = secrets.token_urlsafe(32)
    with psycopg.connect(admin_url, autocommit=True) as connection:
        from psycopg import sql
        connection.execute(sql.SQL("CREATE ROLE sentrix_app LOGIN PASSWORD {}").format(sql.Literal(app_password)))
        connection.execute("CREATE DATABASE sentrix OWNER sentrix_app")
    lines = [line for line in existing.splitlines() if not line.startswith("SENTRIX_DATABASE_URL=")]
    lines.append(f"SENTRIX_DATABASE_URL=postgresql://sentrix_app:{app_password}@127.0.0.1:55432/sentrix")
    ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")
    # Credencial de mantenimiento local fuera del código y excluida de Git.
    (DATA.parent / "postgres-admin.env").write_text(f"SENTRIX_ADMIN_DATABASE_URL={admin_url}\n", encoding="utf-8")
    print("PostgreSQL listo en 127.0.0.1:55432; conexión guardada en backend/.env")
