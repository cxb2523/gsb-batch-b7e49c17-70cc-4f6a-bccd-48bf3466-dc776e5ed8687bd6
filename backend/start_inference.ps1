param(
    [string]$BindHost = "127.0.0.1",
    [int]$Port = 8099
)

# Servidor de inferencia compartido: CLIP + VadCLIP + VideoMAE en la GPU, sin base de datos ni cámaras.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw 'Falta .venv en la raiz del repo. Ejecutar: python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r backend/requirements-gpu.txt'
}
$env:SENTRIX_ROLE = 'inference'
$env:SENTRIX_PROVIDER = 'cuda'
Push-Location $PSScriptRoot
try {
    & $pythonPath (Join-Path $PSScriptRoot 'run_server.py') --host $BindHost --port $Port
} finally {
    Pop-Location
    Remove-Item Env:SENTRIX_ROLE -ErrorAction SilentlyContinue
}
if ($LASTEXITCODE -ne 0) { throw "El servidor de inferencia finalizo con codigo $LASTEXITCODE" }
