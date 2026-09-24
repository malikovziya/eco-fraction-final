# Starts the full Eco-Fraction stack: Docker infra + backend + frontend.
# Usage: .\start.ps1        (first run installs dependencies automatically)
# Native tools (docker, pip, npm) write progress to stderr, so rely on exit codes, not ErrorAction.
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

$nodeDir = "$env:LOCALAPPDATA\Programs\node-v24.19.0-win-x64"
if (Test-Path $nodeDir) { $env:Path = "$nodeDir;$env:Path" }

Write-Host '[1/3] Starting infrastructure (MQTT, Kafka, chain)...' -ForegroundColor Cyan
if (Get-NetTCPConnection -LocalPort 8100 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host 'Eco-Fraction already appears to be running. Run .\stop.ps1 first.' -ForegroundColor Yellow
    exit 1
}
cmd /c "docker compose -f `"$root\infra\docker-compose.yml`" up -d 2>&1"
if ($LASTEXITCODE -ne 0) { throw 'Docker compose failed. Is Docker Desktop running?' }

Write-Host '[2/3] Starting backend and IoT layer...' -ForegroundColor Cyan
$venv = "$root\.venv"
if (-not (Test-Path "$venv\Scripts\python.exe")) { python -m venv $venv }
& "$venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check `
    -r "$root\backend\requirements.txt" -r "$root\iot\requirements.txt"
if ($LASTEXITCODE -ne 0) { throw 'Python dependency install failed.' }
# Services run hidden and log to files; a console window can stall request handling.
$logs = "$root\logs"
New-Item -ItemType Directory -Force $logs | Out-Null
Start-Process -FilePath "$venv\Scripts\python.exe" `
    -ArgumentList '-m', 'uvicorn', 'app.main:app', '--reload', '--port', '8100' `
    -WorkingDirectory "$root\backend" -WindowStyle Hidden `
    -RedirectStandardOutput "$logs\backend.out.log" -RedirectStandardError "$logs\backend.log"

# IoT layer: sensor simulator publishes to MQTT, bridge verifies and forwards to Kafka
foreach ($svc in 'simulator', 'bridge') {
    Start-Process -FilePath "$venv\Scripts\python.exe" -ArgumentList '-m', "iot.$svc" `
        -WorkingDirectory $root -WindowStyle Hidden `
        -RedirectStandardOutput "$logs\$svc.log" -RedirectStandardError "$logs\$svc.err.log"
    Start-Sleep -Seconds 2  # simulator provisions device keys before the bridge loads the registry
}

Write-Host '[3/3] Starting frontend...' -ForegroundColor Cyan
if (-not (Test-Path "$root\frontend\node_modules")) { npm --prefix "$root\frontend" install --no-fund --no-audit }
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run dev' `
    -WorkingDirectory "$root\frontend" -WindowStyle Hidden `
    -RedirectStandardOutput "$logs\frontend.log" -RedirectStandardError "$logs\frontend.err.log"

Write-Host ''
Write-Host 'Eco-Fraction is starting:' -ForegroundColor Green
Write-Host '  App             http://localhost:3000'
Write-Host '  API docs        http://localhost:8100/docs'
Write-Host '  Kafka console   http://localhost:8080'
Write-Host '  Local chain     http://localhost:8545'
Write-Host "Logs in $logs | Stop everything with .\stop.ps1"
