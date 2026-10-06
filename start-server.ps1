# Run the Express (Node) server.
# Usage: right-click -> "Run with PowerShell", or from a terminal: .\start-server.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $root "server")

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing server dependencies (first run only)..." -ForegroundColor Yellow
    npm install
}

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created server\.env from example - add your API keys before chat/quiz will work." -ForegroundColor Yellow
}

Write-Host "Starting Express server on http://localhost:5000 ..." -ForegroundColor Green
npm run dev
