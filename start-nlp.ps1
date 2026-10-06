# Run the NLP (FastAPI) service.
# Usage: right-click -> "Run with PowerShell", or from a terminal: .\start-nlp.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $root "nlp-service")

$venvPython = ".\.venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "venv not found at nlp-service\.venv - create it first:" -ForegroundColor Red
    Write-Host "  cd nlp-service" -ForegroundColor Yellow
    Write-Host "  python -m venv .venv" -ForegroundColor Yellow
    exit 1
}

# Sanity check: make sure fitz (PyMuPDF) is actually installed in THIS venv
& $venvPython -c "import fitz" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "fitz not installed in nlp-service\.venv - installing requirements now..." -ForegroundColor Yellow
    & $venvPython -m pip install torch --index-url https://download.pytorch.org/whl/cpu
    & $venvPython -m pip install -r requirements.txt
}

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created nlp-service\.env from example." -ForegroundColor Yellow
}

Write-Host "Starting NLP service on http://localhost:8000 ..." -ForegroundColor Green
& $venvPython -m uvicorn app.main:app --reload --port 8000
