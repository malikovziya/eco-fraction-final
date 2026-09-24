# Stops the Eco-Fraction stack started by start.ps1.
$root = $PSScriptRoot

# Kill the whole process tree behind each port: uvicorn --reload and npm spawn child
# processes that otherwise survive and keep the port open.
foreach ($port in 3000, 8100) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        $procId = $_.OwningProcess
        $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId").ParentProcessId
        $parentCmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$parent" -ErrorAction SilentlyContinue).CommandLine
        if ($parentCmd -and $parentCmd -like "*$root*") { $procId = $parent }
        taskkill /T /F /PID $procId 2>&1 | Out-Null
    }
}
cmd /c "docker compose -f `"$root\infra\docker-compose.yml`" down 2>&1"
Write-Host 'Eco-Fraction stopped.' -ForegroundColor Green
