r"""Workers fijos en Azure; el PC solo corre el servidor de inferencia. Usa las VMs que crea Terraform.

Uso (con el .venv del repo, desde cualquier carpeta):
  python deploy/azure/workers_azure.py comprobar     construye la imagen en el PC y la prueba; no toca Azure
  python deploy/azure/workers_azure.py subir --capacidad 6     crea las 3 VMs y despliega el commit actual (requiere TAILSCALE_AUTHKEY)
  python deploy/azure/workers_azure.py autoescalar --capacidad 4     enciende y apaga VMs según las cámaras activas
  python deploy/azure/workers_azure.py bajar       detiene con calma, comprueba que no queden clips y destruye las VMs
  python deploy/azure/workers_azure.py desplegar | estado | encender | apagar

Se despliega `git archive HEAD`: nunca viaja un .env ni código sin commit. Los secretos van en un archivo con permiso 600
en cada VM, necesario para que el contenedor vuelva solo tras un reinicio.
"""
import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

from azure_comun import HERE, KNOWN_HOSTS, REMOTE, TERRAFORM_DIR, load_nodes, scp_to, ssh

REPO = HERE.parents[1]
DOCKERFILE = HERE / "Dockerfile"
RESOURCE_GROUP = "sentrix-escalamiento"
IMAGE, CONTAINER = "sentrix-worker-prod", "sx-worker"
MEDIAMTX = "100.107.21.15"
INFERENCE_PORT = 8099
PATHS = ["backend", "modelo/metadata.json", "modelo/infer_onnx.py", "modelo/vadclip/metadata.json"]
COPIED = ("SENTRIX_DATABASE_URL", "SENTRIX_CONTROL_API_KEY", "SENTRIX_RTSP_PROTOCOL", "SENTRIX_RTSP_HOST", "SENTRIX_RTSP_PORT",
          "SENTRIX_RTSP_USER", "SENTRIX_RTSP_PASSWORD", "SENTRIX_CLIPS_S3_ENDPOINT", "SENTRIX_CLIPS_BUCKET",
          "SENTRIX_CLIPS_ACCESS_KEY_ID", "SENTRIX_CLIPS_SECRET_ACCESS_KEY", "TA2_QUEUE_SIZE")
HEALTH = "python -c \"import urllib.request as u; print(u.urlopen('http://127.0.0.1:8000/health', timeout=8).read().decode())\""


def repo_env():
    values = {}
    for line in (REPO / "backend" / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            name, value = line.split("=", 1)
            values[name.strip()] = value.strip().strip("\"'")
    return values


def commit():
    return subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()


def bundle(destination):
    subprocess.run(["git", "-C", str(REPO), "archive", "--format=tar.gz", "-o", str(destination), "HEAD", *PATHS], check=True)
    with tarfile.open(destination) as tar:
        if any(Path(name).name.startswith(".env") and Path(name).name != ".env.example" for name in tar.getnames()):
            raise SystemExit("El paquete incluye un .env: se cancela.")


def worker_env(name, capacity, pc_ip):
    secrets = repo_env()
    env = {key: secrets[key] for key in COPIED if secrets.get(key)}
    missing = [key for key in ("SENTRIX_DATABASE_URL", "SENTRIX_CONTROL_API_KEY", "SENTRIX_CLIPS_BUCKET") if key not in env]
    if missing:
        raise SystemExit(f"Faltan en backend/.env: {missing}")
    env.update({"SENTRIX_ROLE": "worker", "SENTRIX_WORKER_ID": f"sx-{name}", "SENTRIX_WORKER_CAPACITY": str(capacity),
                "SENTRIX_PREDICTOR": "hybrid", "SENTRIX_VIDEO_TRANSPORT": "rtsp", "SENTRIX_AUTH_MODE": "api_key",
                "SENTRIX_INFERENCE_URL": f"http://{pc_ip}:{INFERENCE_PORT}"})
    return env


def deploy_node(user, node, package, key, capacity, pc_ip, errors):
    name = node["name"]
    try:
        deadline = time.time() + 420
        while ssh(user, node, "true", check=False, timeout=30).returncode != 0:
            if time.time() > deadline:
                raise RuntimeError("SSH no respondió en 7 min (¿cambió tu IP pública?)")
            time.sleep(5)
        ssh(user, node, "cloud-init status --wait >/dev/null", check=False, timeout=600)
        if ssh(user, node, "sudo tailscale ip -4", check=False).returncode != 0:
            if not key:
                raise RuntimeError("Falta TAILSCALE_AUTHKEY para el primer despliegue")
            ssh(user, node, f"read -r K; K=$(printf %s \"$K\" | tr -d '\\r'); sudo tailscale up --auth-key=\"$K\" --hostname=sx-{name}",
                stdin=key + "\n", timeout=90)
        print(f"[{name}] construyendo la imagen", flush=True)
        ssh(user, node, f"mkdir -p {REMOTE}/ctx {REMOTE}/clips && rm -rf {REMOTE}/ctx/*")
        scp_to(user, node, package, f"{REMOTE}/ctx/paquete.tgz")
        scp_to(user, node, DOCKERFILE, f"{REMOTE}/ctx/Dockerfile")
        ssh(user, node, f"cd {REMOTE}/ctx && tar -xzf paquete.tgz && rm paquete.tgz && sudo docker build -q -t {IMAGE} .", timeout=600)
        handle, path = tempfile.mkstemp(suffix=".env")
        try:
            with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as file:
                file.write("".join(f"{k}={v}\n" for k, v in worker_env(name, capacity, pc_ip).items()))
            ssh(user, node, f"touch {REMOTE}/worker.env; chmod 600 {REMOTE}/worker.env")
            scp_to(user, node, path, f"{REMOTE}/worker.env")
        finally:
            os.remove(path)
        ssh(user, node, f"chmod 600 {REMOTE}/worker.env; sudo docker rm -f {CONTAINER} >/dev/null 2>&1; "
                        f"sudo docker run -d --name {CONTAINER} --restart always --memory 6g --env-file {REMOTE}/worker.env "
                        f"-v {REMOTE}/clips:/app/backend/data/clips {IMAGE} >/dev/null")
        rtsp = ssh(user, node, f"timeout 6 bash -c '</dev/tcp/{MEDIAMTX}/8554'", check=False, timeout=20)
        model = ssh(user, node, f"timeout 6 bash -c '</dev/tcp/{pc_ip}/{INFERENCE_PORT}'", check=False, timeout=20)
        print(f"[{name}] contenedor iniciado · MediaMTX {'OK' if rtsp.returncode == 0 else 'FALLA'} · "
              f"servidor del PC {'OK' if model.returncode == 0 else 'sin respuesta'}", flush=True)
    except Exception as error:  # noqa: BLE001 - se informa por nodo y se sigue con los demás
        errors.append(f"{name}: {error}")


def deploy(capacity):
    pc_ip = subprocess.run(["tailscale", "ip", "-4"], capture_output=True, text=True, timeout=20).stdout.split()[0]
    nodes, user = load_nodes()
    key = os.environ.get("TAILSCALE_AUTHKEY", "").strip()
    handle, package = tempfile.mkstemp(suffix=".tgz")
    os.close(handle)
    errors = []
    try:
        bundle(package)
        print(f"Desplegando {commit()} en {len(nodes)} VMs; servidor de inferencia en {pc_ip}:{INFERENCE_PORT}", flush=True)
        threads = [threading.Thread(target=deploy_node, args=(user, node, package, key, capacity, pc_ip, errors)) for node in nodes]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
    finally:
        os.remove(package)
    if errors:
        sys.exit("Problemas:\n- " + "\n- ".join(errors))
    print("Workers desplegados. Revisar con: python workers_azure.py estado")


def status():
    nodes, user = load_nodes()
    for node in nodes:
        result = ssh(user, node, f"sudo docker inspect -f '{{{{.State.Status}}}} desde {{{{.State.StartedAt}}}} reinicios={{{{.RestartCount}}}}' {CONTAINER}; "
                                 f"sudo docker exec {CONTAINER} {HEALTH}", check=False, timeout=40)
        lines = result.stdout.strip().splitlines()
        print(f"{node['name']}: {lines[0] if lines else (result.stderr.strip()[:200] or 'sin respuesta')}")
        try:
            health = json.loads(lines[-1])
            print("   ", {k: health.get(k) for k in ("role", "worker_id", "policy", "inference", "inference_reachable", "model_loaded")})
        except (IndexError, ValueError):
            print("    /health aún no responde")


def power(action):
    names = [f"sx-w{i}" for i in range(1, 4)]
    existing = subprocess.run(f"az vm list -g {RESOURCE_GROUP} --query [].name -o tsv", shell=True, capture_output=True, text=True).stdout.split()
    targets = [n for n in names if n in existing]
    if not targets:
        sys.exit("No hay VMs: primero terraform apply.")
    verb = "start" if action == "encender" else "deallocate"  # deallocate: sin cobro de VM; quedan disco e IP.
    print(f"{action}: {', '.join(targets)}", flush=True)
    for name in targets:
        subprocess.run(f"az vm {verb} -g {RESOURCE_GROUP} -n {name} --only-show-errors -o none", shell=True, check=True)


class Scaler:
    """Decide con las cámaras deseadas, no con la CPU: cada worker gasta muy poca y la CPU nunca dispararía."""
    ON, OFF = ("VM running", "VM starting"), ("VM deallocated", "VM stopped")

    def __init__(self, capacity, hold=600.0):
        self.capacity, self.hold, self.surplus_since = capacity, hold, None

    def decide(self, desired, vms, cameras, now):
        """vms: {nombre: estado}; cameras: {nombre: cámaras}. Devuelve ('start'|'stop', nombre) o None."""
        on = sorted(name for name, power in vms.items() if power in self.ON)
        off = sorted(name for name, power in vms.items() if power in self.OFF)
        needed = min(len(vms), math.ceil(desired / self.capacity))
        if needed >= len(on):
            self.surplus_since = None
            return ("start", off[0]) if needed > len(on) and off else None
        if self.surplus_since is None:
            self.surplus_since = now
        if now - self.surplus_since < self.hold:
            return None
        target = min(on, key=lambda name: (cameras.get(name, 0), name))
        if cameras.get(target, 0):
            self.surplus_since = now  # Mueve cámaras: la siguiente espera otra vez. Una VM vacía no hace esperar.
        return "stop", target


def az_vms():
    result = subprocess.run([shutil.which("az"), "vm", "list", "-d", "-g", RESOURCE_GROUP, "--query",
                             "[].{name:name,power:powerState}", "-o", "json", "--only-show-errors"],
                            capture_output=True, text=True, timeout=120, check=True)
    return {row["name"]: row["power"] for row in json.loads(result.stdout)}


def demand(connection):
    desired = connection.execute("SELECT count(*) FROM source_control WHERE desired = 'running'").fetchone()[0]
    leases = dict(connection.execute("SELECT worker_id, count(*) FROM camera_leases WHERE expires_at > now() GROUP BY 1").fetchall())
    return desired, leases


def read_only_connection():
    import psycopg
    url = repo_env()["SENTRIX_DATABASE_URL"].replace("-pooler.", ".", 1)
    connection = psycopg.connect(url, autocommit=True, connect_timeout=10)
    connection.execute("SET default_transaction_read_only = on")
    return connection


def stop_worker(user, node):
    """Parada ordenada: suelta las cámaras al instante y termina de subir los clips."""
    return ssh(user, node, f"sudo docker stop -t 60 {CONTAINER}", check=False, timeout=90).returncode == 0


def autoscale(capacity, hold, interval):
    nodes, user = load_nodes()
    by_vm = {f"sx-{node['name']}": node for node in nodes}
    scaler, connection, last = Scaler(capacity, hold), None, None
    print(f"Autoescalador: {capacity} cámaras por VM, espera {hold:.0f} s para apagar. Ctrl+C para salir.", flush=True)
    while True:
        try:
            if connection is None or connection.closed:
                connection = read_only_connection()
            desired, cameras = demand(connection)
            vms = az_vms()
            summary = (desired, tuple(sorted(vms.items())), tuple(sorted(cameras.items())))
            if summary != last:
                print(time.strftime("%H:%M:%S"), f"deseadas={desired}", vms, cameras, flush=True)
                last = summary
            action = scaler.decide(desired, vms, cameras, time.monotonic())
            if action:
                verb, name = action
                print(time.strftime("%H:%M:%S"), "ENCIENDO" if verb == "start" else "APAGO", name, flush=True)
                if verb == "stop" and not stop_worker(user, by_vm[name]):
                    print("  no se pudo detener el worker con calma; se apaga igual", flush=True)
                subprocess.run([shutil.which("az"), "vm", "start" if verb == "start" else "deallocate", "-g", RESOURCE_GROUP, "-n", name,
                                "--no-wait", "--only-show-errors"], check=True, timeout=120)
        except KeyboardInterrupt:
            raise
        except Exception as error:  # noqa: BLE001 - un fallo pasajero de Neon o Azure no debe tumbar el bucle
            print(time.strftime("%H:%M:%S"), "reintentando:", type(error).__name__, flush=True)
            if connection is not None:
                connection.close()
            connection = None
        time.sleep(interval)


def terraform(*args):
    ip = urllib.request.urlopen("https://api.ipify.org", timeout=15).read().decode().strip()
    subprocess.run([shutil.which("terraform"), f"-chdir={TERRAFORM_DIR}", *args, "-auto-approve",
                    "-var", f"allowed_ssh_cidr={ip}/32", "-var", "node_count=3"], check=True, timeout=1800)


def up(capacity):
    KNOWN_HOSTS.unlink(missing_ok=True)  # IPs nuevas o reutilizadas con otra huella
    if not os.environ.get("TAILSCALE_AUTHKEY", "").strip():
        sys.exit("Falta TAILSCALE_AUTHKEY.")
    terraform("apply")
    deploy(capacity)


def down(force):
    terraform("apply")  # Por si cambió tu IP pública desde que se crearon: SSH solo acepta esa IP.
    power("encender")   # Una VM apagada no puede cerrar su sesión de Tailscale ni avisar si le quedan clips.
    nodes, user = load_nodes()
    pending = {}
    for node in nodes:
        deadline = time.time() + 300
        while ssh(user, node, "true", check=False, timeout=30).returncode != 0:
            if time.time() > deadline:
                raise SystemExit(f"{node['name']} no responde por SSH; no se destruye nada.")
            time.sleep(5)
        stop_worker(user, node)
        left = ssh(user, node, f"sudo find {REMOTE}/clips -type f -size +0 | wc -l", check=False, timeout=40).stdout.strip()
        pending[node["name"]] = int(left or 0)
    print("Clips sin subir por VM:", pending, flush=True)
    if any(pending.values()) and not force:
        for node in nodes:
            ssh(user, node, f"sudo docker start {CONTAINER}", check=False, timeout=40)
        sys.exit("Quedan clips sin subir: reinicié los workers para que terminen. Reintenta en unos minutos o usa --forzar.")
    for node in nodes:
        ssh(user, node, "sudo tailscale logout", check=False, timeout=40)
    terraform("destroy")
    KNOWN_HOSTS.unlink(missing_ok=True)
    print("VMs destruidas. No queda nada cobrando de este despliegue.")


def check():
    """Construye la imagen en el PC y arranca un worker sin base real ni modelos, apuntando a un servidor caído."""
    name = "sx-comprobar"
    with tempfile.TemporaryDirectory() as folder:
        package = Path(folder) / "paquete.tgz"
        bundle(package)
        with tarfile.open(package) as tar:
            tar.extractall(folder, filter="data")
        package.unlink()
        (Path(folder) / "Dockerfile").write_bytes(DOCKERFILE.read_bytes())
        subprocess.run(["docker", "build", "-q", "-t", IMAGE, folder], check=True, timeout=1200)
    subprocess.run(["docker", "rm", "-f", name], capture_output=True)
    try:
        subprocess.run(["docker", "run", "-d", "--name", name, "-e", "SENTRIX_ROLE=all", "-e", "SENTRIX_DATABASE_URL=", "-e", "SENTRIX_DETECTION_DB=/tmp/d.db",
                        "-e", "SENTRIX_LOG_DB=/tmp/l.db", "-e", "SENTRIX_CONTROL_API_KEY=k", "-e", "SENTRIX_PREDICTOR=hybrid", "-e", "SENTRIX_CLIPS=0",
                        "-e", "SENTRIX_INFERENCE_URL=http://127.0.0.1:9", IMAGE], check=True, capture_output=True)
        for _ in range(40):
            result = subprocess.run(["docker", "exec", name, "sh", "-c", HEALTH.replace('\\"', '"')], capture_output=True, text=True)
            if result.returncode == 0:
                health = json.loads(result.stdout)
                print({k: health.get(k) for k in ("status", "predictor", "policy", "inference", "inference_reachable", "model_loaded")})
                print("Tamaño de la imagen:", subprocess.run(["docker", "image", "inspect", "-f", "{{.Size}}", IMAGE], capture_output=True, text=True).stdout.strip())
                return
            time.sleep(1)
        print(subprocess.run(["docker", "logs", "--tail", "30", name], capture_output=True, text=True).stderr)
        sys.exit("El contenedor no respondió.")
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("accion", choices=("comprobar", "subir", "bajar", "autoescalar", "desplegar", "estado", "encender", "apagar"))
    parser.add_argument("--capacidad", type=int, default=4)
    parser.add_argument("--espera", type=float, default=600, help="segundos con VMs de más antes de apagar")
    parser.add_argument("--intervalo", type=float, default=20)
    parser.add_argument("--forzar", action="store_true", help="bajar aunque queden clips sin subir")
    args = parser.parse_args()
    if args.accion == "comprobar":
        check()
    elif args.accion == "subir":
        up(args.capacidad)
    elif args.accion == "bajar":
        down(args.forzar)
    elif args.accion == "autoescalar":
        autoscale(args.capacidad, args.espera, args.intervalo)
    elif args.accion == "desplegar":
        deploy(args.capacidad)
    elif args.accion == "estado":
        status()
    else:
        power(args.accion)


if __name__ == "__main__":
    main()
