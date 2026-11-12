# Install Datavloot and open the Crows Nest on the NOAA demo, in one command:
#
#   powershell -ExecutionPolicy ByPass -c "irm https://datavloot.nl/install.ps1 | iex"
#
# No Python, git or admin rights needed. The script:
#   1. installs uv (https://docs.astral.sh/uv/) for the current user, if missing
#   2. creates the demo project in %USERPROFILE%\optimist-demo with `datavloot demo`
#   3. gives it its own Python and packages (`uv sync`), and runs `dbt deps` and `dbt parse`
#   4. starts Dagster and the Crows Nest, opens http://localhost:8080 and, the
#      first time, starts the run that downloads the demo data and builds the models
#
# Running it again starts the existing project; it never overwrites one.
#
# Settings, as environment variables (the one-liner takes no arguments):
#   DATAVLOOT_PROJECT  a project of your own instead of the demo: its GitHub or GitLab
#                      repository, e.g. https://gitlab.com/group/name (`datavloot new --from`)
#   DATAVLOOT_REF      with DATAVLOOT_PROJECT: the tag to install (default: the latest version)
#   DATAVLOOT_PATH     with DATAVLOOT_PROJECT: the project's folder in the repository,
#                      when it cannot be found by itself
#   DATAVLOOT_DIR      where the project goes (default: %USERPROFILE%\optimist-demo, or
#                      %USERPROFILE%\<repository name> with DATAVLOOT_PROJECT)
#   DATAVLOOT_VERSION  a toolkit version, e.g. 0.4.0 (default: the latest release)
#   DATAVLOOT_FROM     install the toolkit from here instead of PyPI, e.g. a checkout
#
# Written for Windows PowerShell 5.1, which every Windows 10 and 11 has.

$PythonVersion = '3.12'
$DagsterPort = 3000
$CrowsNestPort = 8080

function Stop-Install([string]$Message) {
    throw "DATAVLOOT_STOP: $Message"
}

function Invoke-Step([string]$What, [scriptblock]$Command) {
    Write-Host ""
    Write-Host "==> $What" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) {
        Stop-Install "$What failed (exit code $LASTEXITCODE). The output above says why."
    }
}

function Test-Internet {
    try {
        Invoke-WebRequest -Uri 'https://pypi.org/simple/datavloot/' -Method Head `
            -UseBasicParsing -TimeoutSec 20 | Out-Null
    } catch {
        Stop-Install ("Cannot reach pypi.org: $($_.Exception.Message)`n" +
            "Check the internet connection. Behind a proxy, set HTTPS_PROXY " +
            "(for example `$env:HTTPS_PROXY = 'http://proxy:8080') and run this again.")
    }
}

function Install-Uv {
    $userBin = Join-Path $HOME '.local\bin'
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
        if (Test-Path (Join-Path $userBin 'uv.exe')) {
            $env:Path = "$userBin;$env:Path"
        } else {
            # uv's own installer, for the current user: no admin rights. In a
            # process of its own, so whatever it does on exit stays there.
            Invoke-Step 'Installing uv' {
                powershell -NoProfile -ExecutionPolicy ByPass -Command `
                    "irm https://astral.sh/uv/install.ps1 | iex"
            }
            $env:Path = "$userBin;$env:Path"
            if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
                Stop-Install "uv was installed but is not found in $userBin. Open a new terminal and run this again."
            }
        }
    }
    Write-Host "uv: $(uv --version)"
}

function Get-PortUser([int]$Port) {
    # Who listens on the port, or $null when it is free. Asking Windows first:
    # binding 127.0.0.1 can succeed while another program listens on 0.0.0.0.
    try {
        $owner = (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
            Select-Object -First 1).OwningProcess
        try { return (Get-Process -Id $owner -ErrorAction Stop).ProcessName } catch { return "process $owner" }
    } catch {
        # None listening, or Get-NetTCPConnection is unavailable: try the port itself.
    }
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        return $null
    } catch {
        return 'another program'
    } finally {
        if ($listener) { $listener.Stop() }
    }
}

function Assert-PortsFree {
    foreach ($entry in @(@($CrowsNestPort, 'the Crows Nest'), @($DagsterPort, 'Dagster'))) {
        $user = Get-PortUser $entry[0]
        if ($user) {
            Stop-Install ("Port $($entry[0]), which $($entry[1]) needs, is in use by $user.`n" +
                "If Datavloot is already running, open http://localhost:$CrowsNestPort. " +
                "Otherwise close that program and run this again.")
        }
    }
}

function Test-Project([string]$Dir) {
    (Test-Path (Join-Path $Dir 'dbt_project.yml')) -and (Test-Path (Join-Path $Dir 'pyproject.toml'))
}

function Install-Datavloot {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    # With DATAVLOOT_PROJECT, a project of your own from its repository
    # (`datavloot new --from`) instead of the demo.
    $project = $env:DATAVLOOT_PROJECT
    if ($project) {
        Write-Host "Datavloot: installing the toolkit and $project" -ForegroundColor Cyan
        # The repository's name: https://gitlab.com/group/name(.git)(/-/tree/main)
        $defaultName = ((($project -replace '/-/.*$', '').TrimEnd('/') -replace '\.git$', '') -split '/')[-1]
    } else {
        Write-Host "Datavloot: installing the toolkit and the NOAA demo" -ForegroundColor Cyan
        $defaultName = 'optimist-demo'
    }

    $dir = if ($env:DATAVLOOT_DIR) { $env:DATAVLOOT_DIR } else { Join-Path $HOME $defaultName }
    $dir = [System.IO.Path]::GetFullPath($dir)
    $existing = $false
    if (Test-Path $dir) {
        if (Test-Project $dir) {
            $existing = $true
        } elseif (-not (Get-ChildItem -Force $dir | Select-Object -First 1)) {
            Remove-Item $dir   # empty: `datavloot demo` wants to create it itself
        } else {
            Stop-Install ("'$dir' already exists and is not a Datavloot project. " +
                "Nothing in it was changed. Set DATAVLOOT_DIR to another folder and run this again.")
        }
    }

    Test-Internet
    Install-Uv

    if ($existing) {
        Write-Host ""
        Write-Host "Found the project in $dir; its files stay as they are."
    } else {
        $from = if ($env:DATAVLOOT_FROM) {
            $env:DATAVLOOT_FROM
        } elseif ($env:DATAVLOOT_VERSION) {
            "datavloot[optimist]==$($env:DATAVLOOT_VERSION)"
        } else {
            'datavloot[optimist]@latest'
        }
        # Tells `datavloot demo` and `new` not to print the steps this script takes itself.
        $env:DATAVLOOT_INSTALLER = '1'
        if ($project) {
            # Fetches the latest tag (or DATAVLOOT_REF), asks for a token when the
            # repository is private and for the settings in .env.example, and
            # runs uv sync, dbt deps and dbt parse itself.
            $newArgs = @('--python', $PythonVersion, '--from', $from, 'datavloot', 'new', $dir, '--from', $project)
            if ($env:DATAVLOOT_REF) { $newArgs += @('--ref', $env:DATAVLOOT_REF) }
            if ($env:DATAVLOOT_PATH) { $newArgs += @('--path', $env:DATAVLOOT_PATH) }
            Invoke-Step "Installing $project in $dir" { uvx @newArgs }
        } else {
            Invoke-Step "Creating the demo project in $dir" {
                uvx --python $PythonVersion --from $from datavloot demo $dir
            }
        }
    }

    Push-Location $dir
    try {
        # `new --from` has just done these steps. Otherwise they repair a project
        # an earlier attempt left halfway, and are quick when nothing is missing.
        if ($existing -or -not $project) {
            # An installed project gets exactly the versions its maintainer locked.
            $installed = (Test-Path 'uv.lock') -and (Test-Path '.datavloot\install.json')
            Invoke-Step "Installing Python $PythonVersion and the project's packages" {
                if ($installed) { uv sync --python $PythonVersion --locked } else { uv sync --python $PythonVersion }
            }
            if (-not (Test-Path 'dbt_packages')) {
                Invoke-Step 'Installing the dbt packages' { uv run --no-sync dbt deps }
            }
            Invoke-Step 'Compiling the dbt project' { uv run --no-sync dbt parse }
        }

        Assert-PortsFree

        Write-Host ""
        Write-Host "==> Starting Dagster and the Crows Nest" -ForegroundColor Cyan
        Write-Host "The Crows Nest opens at http://localhost:$CrowsNestPort. Keep this window open;"
        # The project's own datavloot rather than `uv run`: a window opened before
        # uv was installed does not have uv on its PATH yet.
        Write-Host "closing it or pressing Ctrl+C stops Datavloot. To start it again later, in PowerShell:"
        Write-Host "    cd `"$dir`"; .venv\Scripts\datavloot start" -ForegroundColor Yellow
        Write-Host "Or have it start at every login, with a shortcut on the desktop and in the Start menu:"
        Write-Host "    cd `"$dir`"; .venv\Scripts\datavloot autostart on" -ForegroundColor Yellow
        Write-Host "Or only the shortcut, without starting at login:"
        Write-Host "    cd `"$dir`"; .venv\Scripts\datavloot shortcut on" -ForegroundColor Yellow
        if (-not $existing -and $project) {
            # No run of its own: a project usually reads files that are not in
            # its repository, and a run before they are there only fails.
            Write-Host "No run has started yet. First put the project's input files in place, usually in"
            Write-Host "    $(Join-Path $dir 'data')" -ForegroundColor Yellow
            Write-Host "(its data folder says what goes there), then click Materialize all in the Crows Nest's"
            Write-Host "Pipelines panel."
        } elseif (-not $existing) {
            Write-Host "The first run downloads the demo's AIS data (41 MB) and builds the models;"
            Write-Host "follow it in the Crows Nest's Pipelines panel."
        }
        Write-Host ""
        $startArgs = @('run', '--no-sync', 'datavloot', 'start')
        # The demo fetches its own data, so it can run straight away.
        if (-not $existing -and -not $project) { $startArgs += '--run' }
        & uv @startArgs
    } finally {
        Pop-Location
    }
}

# Errors are reported here rather than with `exit`: under `irm | iex` in an open
# PowerShell window, `exit` would close that window.
try {
    Install-Datavloot
} catch {
    $message = $_.Exception.Message
    if ($message.StartsWith('DATAVLOOT_STOP: ')) {
        $message = $message.Substring('DATAVLOOT_STOP: '.Length)
    }
    Write-Host ""
    Write-Host "Error: $message" -ForegroundColor Red
    $global:LASTEXITCODE = 1
}
