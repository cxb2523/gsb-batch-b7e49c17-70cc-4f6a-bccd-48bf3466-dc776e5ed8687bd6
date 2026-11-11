param(
    [ValidateSet('all', 'unit', 'black-box', 'integration', 'e2e')]
    [string]$Suite = 'all'
)

$ErrorActionPreference = 'Stop'
$taskProjectRoot = Split-Path -Parent $PSScriptRoot
$taskPython = Join-Path $taskProjectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
    throw 'Falta .venv. Instala backend/requirements-test.txt en el entorno del repositorio.'
}
$taskTests = if ($Suite -eq 'all') { 'tests' } else { "tests/$Suite" }
$taskTemp = Join-Path $taskProjectRoot ('.pytest_tmp_backend_' + [guid]::NewGuid().ToString('N'))
Push-Location $PSScriptRoot
try {
    & $taskPython -m pytest $taskTests -q --basetemp=$taskTemp
    $taskTestExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $taskTestExitCode
