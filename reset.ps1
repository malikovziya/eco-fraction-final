# Resets the demo to a clean, identical starting state (fresh chain, database and personas).
# Run before every rehearsal and before going on stage.
param([switch]$Dev)
& "$PSScriptRoot\stop.ps1"
& "$PSScriptRoot\start.ps1" -Dev:$Dev
