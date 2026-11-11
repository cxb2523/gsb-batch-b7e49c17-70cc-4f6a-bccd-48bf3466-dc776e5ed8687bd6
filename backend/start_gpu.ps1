param(
    [string]$BindHost = "127.0.0.1"
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw 'Falta .venv en la raiz del repo. Ejecutar: python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r backend/requirements-gpu.txt'
}
$taskProbeHost = if ($BindHost -in @('0.0.0.0', '::')) { '127.0.0.1' } else { $BindHost }
if ($taskProbeHost.Contains(':')) { $taskProbeHost = "[$taskProbeHost]" }
$taskHealthUrl = "http://${taskProbeHost}:8000/health"
$taskExistingHealth = $null
try {
    $taskExistingHealth = Invoke-RestMethod -Uri $taskHealthUrl -TimeoutSec 3
} catch {
    # Si no responde, continuar con el arranque normal.
}
if ($taskExistingHealth.status -eq 'ok' -and $taskExistingHealth.model_loaded -eq $true -and $taskExistingHealth.gpu_active -eq $true -and $taskExistingHealth.video_transport -eq 'rtsp') {
    Write-Host "El backend ya esta encendido y la GPU esta activa: $taskHealthUrl"
    Write-Host 'No se inicia otra instancia. Para aplicar cambios, reinicia la instancia existente.'
    $global:LASTEXITCODE = 0
    return
}
# El modelo lo decide SENTRIX_PREDICTOR (backend/.env); por defecto el híbrido VadCLIP + VideoMAE.
$env:SENTRIX_PROVIDER = 'cuda'
$env:SENTRIX_VIDEO_TRANSPORT = 'rtsp'
& $pythonPath (Join-Path $PSScriptRoot 'setup_postgres.py') --ensure-running
if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar o encontrar PostgreSQL; revisar el mensaje anterior.' }
Push-Location $PSScriptRoot
try {
    & $pythonPath (Join-Path $PSScriptRoot 'run_server.py') --host $BindHost --port 8000 --also-loopback
} finally {
    Pop-Location
}
if ($LASTEXITCODE -ne 0) { throw "El backend finalizo con codigo $LASTEXITCODE" }
