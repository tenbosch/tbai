$root = $PSScriptRoot
$pidsFile = "$root\.tbai.pids.json"

if (-not (Test-Path $pidsFile)) {
    Write-Host "No .tbai.pids.json found — is tBai running?" -ForegroundColor Yellow
    exit 1
}

$pidMap = Get-Content $pidsFile -Raw | ConvertFrom-Json

Write-Host "Stopping tBai..." -ForegroundColor Cyan

# Stop in reverse start order; /T kills the full process tree (catches npm -> node, uvicorn reloader, etc.)
foreach ($svc in @("tunnel", "frontend", "backend", "ollama")) {
    $id = $pidMap.$svc
    if ($id) {
        $null = taskkill /PID $id /T /F 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  $svc stopped (PID $id)" -ForegroundColor Green
        } else {
            Write-Host "  $svc (PID $id) was not running" -ForegroundColor Yellow
        }
    }
}

Remove-Item $pidsFile -Force
Write-Host ""
Write-Host "tBai stopped." -ForegroundColor Cyan
