$root = $PSScriptRoot

Write-Host "Starting tBai..." -ForegroundColor Cyan

# 1. Ollama
$proc_ollama = Start-Process -FilePath "ollama" -ArgumentList "serve" `
    -PassThru -WindowStyle Normal
Write-Host "  Ollama     started  (PID $($proc_ollama.Id))" -ForegroundColor Green

Start-Sleep -Seconds 1

# 2. Backend
$proc_backend = Start-Process `
    -FilePath "$root\.venv\Scripts\python.exe" `
    -ArgumentList "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000" `
    -WorkingDirectory "$root\backend" `
    -PassThru -WindowStyle Normal
Write-Host "  Backend    started  (PID $($proc_backend.Id))" -ForegroundColor Green

# 3. Frontend
$proc_frontend = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c npm run dev" `
    -WorkingDirectory "$root\frontend" `
    -PassThru -WindowStyle Normal
Write-Host "  Frontend   started  (PID $($proc_frontend.Id))" -ForegroundColor Green

# 4. Cloudflare tunnel
$proc_tunnel = Start-Process -FilePath "$root\cloudflare\cloudflared.exe" `
    -ArgumentList "tunnel", "run", "tbai" `
    -PassThru -WindowStyle Normal
Write-Host "  Tunnel     started  (PID $($proc_tunnel.Id))" -ForegroundColor Green

# Save PIDs so stop.ps1 can find them
@{
    ollama   = $proc_ollama.Id
    backend  = $proc_backend.Id
    frontend = $proc_frontend.Id
    tunnel   = $proc_tunnel.Id
} | ConvertTo-Json | Set-Content -Path "$root\.tbai.pids.json" -Encoding UTF8

Write-Host ""
Write-Host "tBai is running:" -ForegroundColor Cyan
Write-Host "  Local   https://localhost:5173"
Write-Host "  Public  https://<your-tunnel-hostname>"
Write-Host ""
Write-Host "Run .\stop.ps1 to shut everything down."
