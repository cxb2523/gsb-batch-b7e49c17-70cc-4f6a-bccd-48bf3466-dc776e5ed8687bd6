"""Utilidades compartidas: lista de nodos (salida de Terraform) y comandos SSH/SCP sin mostrar secretos."""
import json
import os
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
TERRAFORM_DIR = HERE / "terraform"
SSH_KEY = Path(os.environ.get("SENTRIX_AZURE_KEY", Path.home() / ".ssh" / "sentrix_azure"))
KNOWN_HOSTS = HERE / ".known_hosts"
REMOTE = "/home/sentrix/sx"
IMAGE = "sentrix-worker"
CONTAINER = "sx-worker"


def load_nodes():
    """Devuelve [{name, public_ip}] y el usuario, leyendo `terraform output`."""
    if not shutil.which("terraform"):
        raise SystemExit("No encuentro terraform en el PATH (ver LEEME.md).")
    result = subprocess.run(["terraform", f"-chdir={TERRAFORM_DIR}", "output", "-json"],
                            capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise SystemExit(f"terraform output falló: {result.stderr.strip()[:300]}")
    output = json.loads(result.stdout)
    if "nodes" not in output or not output["nodes"]["value"]:
        raise SystemExit("Terraform no tiene nodos: ejecuta `terraform apply` primero.")
    return output["nodes"]["value"], output["admin_username"]["value"]


def _options():
    return ["-i", str(SSH_KEY), "-o", "BatchMode=yes", "-o", "ConnectTimeout=15",
            "-o", "StrictHostKeyChecking=accept-new", "-o", f"UserKnownHostsFile={KNOWN_HOSTS}",
            "-o", "ServerAliveInterval=15"]


def ssh(user, node, command, *, check=True, timeout=120, stdin=None):
    """Ejecuta un comando remoto. `stdin` lleva los secretos para que no aparezcan en la línea de comandos local."""
    # Sin secreto que enviar, stdin va a DEVNULL: heredar la consola de Windows dejó colgados los ssh del 09-11.
    source = {"input": stdin} if stdin is not None else {"stdin": subprocess.DEVNULL}
    result = subprocess.run(["ssh", *_options(), f"{user}@{node['public_ip']}", command], **source,
                            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    if check and result.returncode != 0:
        raise RuntimeError(f"[{node['name']}] falló `{command[:70]}`: {(result.stderr or result.stdout).strip()[:400]}")
    return result


def scp_to(user, node, local, remote, timeout=300):
    result = subprocess.run(["scp", *_options(), "-q", str(local), f"{user}@{node['public_ip']}:{remote}"],
                            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(f"[{node['name']}] no se pudo copiar {Path(local).name}: {result.stderr.strip()[:300]}")


def scp_from(user, node, remote, local, timeout=300):
    result = subprocess.run(["scp", *_options(), "-q", "-r", f"{user}@{node['public_ip']}:{remote}", str(local)],
                            capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(f"[{node['name']}] no se pudo traer {remote}: {result.stderr.strip()[:300]}")
