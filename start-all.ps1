# Starts Mongo (Docker) + all 3 services, each service in its own new PowerShell window.
# Usage: double-click, or from a terminal: .\start-all.ps1
# Run this from the docqa root folder (where docker-compose.yml lives).

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Starting MongoDB container..." -ForegroundColor Cyan
docker compose up -d mongo

Write-Host "Opening NLP service, Server, and Client in separate windows..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-File", (Join-Path $root "start-nlp.ps1")
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-File", (Join-Path $root "start-server.ps1")
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-File", (Join-Path $root "start-client.ps1")

Write-Host ""
Write-Host "All services launching. Once the client window shows 'ready', open:" -ForegroundColor Green
Write-Host "  http://localhost:5173" -ForegroundColor Green
