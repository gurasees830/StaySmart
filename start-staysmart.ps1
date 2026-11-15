# Starts StaySmart: local MongoDB, the backend API (port 5001) and the
# frontend (port 5174), then opens the site in your browser.
# Usage: double-click start-staysmart.bat   (or: powershell -File start-staysmart.ps1)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Join-Path $root "staysmart-recovery-pack\fixed"
$backend = Join-Path $app "hotel-booking-backend"
$frontend = Join-Path $app "hotel-booking-frontend"
$logs = Join-Path $root "logs"
$mongod = Join-Path $root "tools\mongodb\bin\mongod.exe"
$dbPath = Join-Path $root "mongodb-data\db"
New-Item -ItemType Directory -Force $logs, $dbPath | Out-Null

function Test-Port([int]$port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

function Wait-Port([int]$port, [int]$seconds, [string]$name) {
  for ($i = 0; $i -lt $seconds; $i++) {
    if (Test-Port $port) { return $true }
    Start-Sleep -Seconds 1
  }
  Write-Host "  $name did not start on port $port - see logs\" -ForegroundColor Red
  return $false
}

Write-Host "StaySmart" -ForegroundColor Cyan

# 1. MongoDB
if (Test-Port 27017) {
  Write-Host "  MongoDB already running (27017)"
} elseif (Test-Path $mongod) {
  Write-Host "  Starting MongoDB..."
  Start-Process -FilePath $mongod -ArgumentList @("--dbpath", "`"$dbPath`"", "--bind_ip", "127.0.0.1", "--port", "27017", "--logpath", "`"$logs\mongod.log`"", "--logappend") -WindowStyle Hidden
  [void](Wait-Port 27017 30 "MongoDB")
} else {
  Write-Host "  tools\mongodb\bin\mongod.exe not found - using MONGODB_CONNECTION_STRING from the backend .env" -ForegroundColor Yellow
}

# 2. Dependencies (first run only)
foreach ($dir in @($backend, $frontend)) {
  if (-not (Test-Path (Join-Path $dir "node_modules"))) {
    Write-Host "  Installing dependencies in $(Split-Path -Leaf $dir)..."
    Push-Location $dir; npm install; Pop-Location
  }
}

# 3. Backend API
if (Test-Port 5001) {
  Write-Host "  Backend already running (5001)"
} else {
  Write-Host "  Starting backend API..."
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev > `"$logs\backend.log`" 2>&1" -WorkingDirectory $backend -WindowStyle Hidden
  [void](Wait-Port 5001 60 "Backend")
}

# 4. Frontend
if (Test-Port 5174) {
  Write-Host "  Frontend already running (5174)"
} else {
  Write-Host "  Starting frontend..."
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev > `"$logs\frontend.log`" 2>&1" -WorkingDirectory $frontend -WindowStyle Hidden
  [void](Wait-Port 5174 60 "Frontend")
}

Write-Host ""
Write-Host "  Website:  http://localhost:5174" -ForegroundColor Green
Write-Host "  API:      http://localhost:5001/api/health"
Write-Host "  API docs: http://localhost:5001/api-docs"
Write-Host "  Logs:     $logs"
Start-Process "http://localhost:5174"
