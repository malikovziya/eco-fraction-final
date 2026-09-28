# Starts the full Eco-Fraction stack: Docker infra + backend + frontend.
# Usage: .\start.ps1         production frontend (fast page loads; use this for the demo)
#        .\start.ps1 -Dev    hot-reloading frontend and backend for development
param([switch]$Dev)
# Native tools (docker, pip, npm) write progress to stderr, so rely on exit codes, not ErrorAction.
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

$nodeDir = "$env:LOCALAPPDATA\Programs\node-v24.19.0-win-x64"
if (Test-Path $nodeDir) { $env:Path = "$nodeDir;$env:Path" }

# Prerequisites: fail early with a clear message instead of a cryptic error later
$missing = @()
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { $missing += 'Docker Desktop  https://www.docker.com/products/docker-desktop' }
elseif (-not (cmd /c "docker info >nul 2>&1 && echo ok")) { $missing += 'Docker Desktop is installed but not running: start it and wait until it is ready' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { $missing += 'Node.js 20 or newer  https://nodejs.org' }
$python = $null
foreach ($candidate in @('python', 'py')) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) {
        $version = & $candidate -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
        if ($version -and [version]$version -ge [version]'3.10') { $python = $candidate; break }
    }
}
if (-not $python -and -not (Test-Path "$root\.venv\Scripts\python.exe")) { $missing += 'Python 3.10+ (3.12 recommended)  https://www.python.org/downloads/  (tick "Add to PATH")' }
if ($missing) {
    Write-Host 'Cannot start, missing prerequisites:' -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  - $_" }
    exit 1
}

function Test-ChainHasContracts {
    # True when the local chain answers and our deployed USDC contract exists on it
    try {
        $address = (Get-Content "$root\contracts\deployments\localhost.json" -Raw | ConvertFrom-Json).contracts.usdc.address
        $body = @{ jsonrpc = '2.0'; id = 1; method = 'eth_getCode'; params = @($address, 'latest') } | ConvertTo-Json -Compress
        $reply = Invoke-RestMethod -Uri 'http://127.0.0.1:8545' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 5
        return [bool]($reply.result -and $reply.result -ne '0x')
    } catch {
        return $false
    }
}

Write-Host '[1/4] Starting infrastructure (MQTT, Kafka, chain)...' -ForegroundColor Cyan
if (Get-NetTCPConnection -LocalPort 8100 -State Listen -ErrorAction SilentlyContinue) {
    if (Test-ChainHasContracts) {
        Write-Host 'Eco-Fraction is already running. Use .\reset.ps1 for a fresh demo, or .\stop.ps1 to stop it.' -ForegroundColor Yellow
        exit 1
    }
    # e.g. Docker restarted and recreated an empty chain under a still-running backend
    Write-Host '   Found a stale run whose blockchain was reset. Stopping it and starting fresh...' -ForegroundColor Yellow
    & "$root\stop.ps1"
}
# The chain is recreated on every start so each demo begins from the same clean state
cmd /c "docker compose -f `"$root\infra\docker-compose.yml`" up -d 2>&1 && docker compose -f `"$root\infra\docker-compose.yml`" up -d --force-recreate chain 2>&1"
if ($LASTEXITCODE -ne 0) { throw 'Docker compose failed. Is Docker Desktop running?' }
$logs = "$root\logs"
New-Item -ItemType Directory -Force $logs | Out-Null

Write-Host '[2/4] Deploying smart contracts...' -ForegroundColor Cyan
if (-not (Test-Path "$root\contracts\node_modules")) { npm --prefix "$root\contracts" install --no-fund --no-audit }
Push-Location "$root\contracts"
cmd /c "npx hardhat run scripts/deploy.js --network localhost > `"$logs\deploy.log`" 2>&1"
$deployExit = $LASTEXITCODE
Pop-Location
if ($deployExit -ne 0) { throw "Contract deployment failed, see $logs\deploy.log" }
Get-Content "$logs\deploy.log" | Select-Object -Skip 1 -First 8 | ForEach-Object { Write-Host "   $_" }

Write-Host '[3/4] Starting backend and IoT layer...' -ForegroundColor Cyan
$venv = "$root\.venv"
if (-not (Test-Path "$venv\Scripts\python.exe")) { & $python -m venv $venv }
& "$venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check `
    -r "$root\backend\requirements.txt" -r "$root\iot\requirements.txt"
if ($LASTEXITCODE -ne 0) { throw 'Python dependency install failed.' }
if (-not (Test-Path "$root\backend\models\anomaly_xgb.json")) {
    Write-Host '   Training AI models (first run, ~2 minutes)...'
    Push-Location "$root\backend"
    & "$venv\Scripts\python.exe" -m app.ai.train | Out-Host
    Pop-Location
}
# Services run hidden and log to files; a console window can stall request handling.
Start-Process -FilePath "$venv\Scripts\python.exe" `
    -ArgumentList (@('-m', 'uvicorn', 'app.main:app', '--port', '8100') + $(if ($Dev) { @('--reload') } else { @() })) `
    -WorkingDirectory "$root\backend" -WindowStyle Hidden `
    -RedirectStandardOutput "$logs\backend.out.log" -RedirectStandardError "$logs\backend.log"

# IoT layer: sensor simulator publishes to MQTT, bridge verifies and forwards to Kafka
foreach ($svc in 'simulator', 'bridge') {
    Start-Process -FilePath "$venv\Scripts\python.exe" -ArgumentList '-m', "iot.$svc" `
        -WorkingDirectory $root -WindowStyle Hidden `
        -RedirectStandardOutput "$logs\$svc.log" -RedirectStandardError "$logs\$svc.err.log"
    Start-Sleep -Seconds 2  # simulator provisions device keys before the bridge loads the registry
}

Write-Host '[4/4] Starting frontend...' -ForegroundColor Cyan
if (-not (Test-Path "$root\frontend\node_modules")) { npm --prefix "$root\frontend" install --no-fund --no-audit }
$frontendCmd = 'npm run dev'
if (-not $Dev) {
    # Rebuild only when a frontend source is newer than the last production build
    $buildId = "$root\frontend\.next\BUILD_ID"
    $latest = Get-ChildItem "$root\frontend\src", "$root\frontend\next.config.ts", "$root\frontend\package.json" -Recurse -File |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not (Test-Path $buildId) -or $latest.LastWriteTime -gt (Get-Item $buildId).LastWriteTime) {
        Write-Host '   Building production frontend (only after code changes, ~1 minute)...'
        Push-Location "$root\frontend"
        cmd /c "npx next build > `"$logs\frontend-build.log`" 2>&1"
        $buildExit = $LASTEXITCODE
        Pop-Location
        if ($buildExit -ne 0) { throw "Frontend build failed, see $logs\frontend-build.log" }
    }
    $frontendCmd = 'npm run start'
}
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $frontendCmd `
    -WorkingDirectory "$root\frontend" -WindowStyle Hidden `
    -RedirectStandardOutput "$logs\frontend.log" -RedirectStandardError "$logs\frontend.err.log"

Write-Host ''
Write-Host 'Eco-Fraction is starting:' -ForegroundColor Green
Write-Host '  App             http://localhost:3000'
Write-Host '  API docs        http://localhost:8100/docs'
Write-Host '  Kafka console   http://localhost:8080'
Write-Host '  Local chain     http://localhost:8545'
Write-Host "Logs in $logs | Stop everything with .\stop.ps1"
