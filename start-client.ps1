# Run the React (Vite) client.
# Usage: right-click -> "Run with PowerShell", or from a terminal: .\start-client.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $root "client")

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing client dependencies (first run only)..." -ForegroundColor Yellow
    npm install
}

Write-Host "Starting client on http://localhost:5173 ..." -ForegroundColor Green
npm run dev
