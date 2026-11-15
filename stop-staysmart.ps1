# Stops the StaySmart frontend, backend and the local MongoDB server.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "staysmart-recovery-pack\fixed\hotel-booking-backend"

# The dev servers run as: cmd /c npm run dev  ->  npm  ->  node (vite / ts-node-dev -> node)
$wrappers = Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" |
  Where-Object { $_.CommandLine -match 'npm run dev' -and $_.CommandLine -match '(backend|frontend)\.log' }
foreach ($w in $wrappers) {
  taskkill /PID $w.ProcessId /T /F | Out-Null
  Write-Host "Stopped $(if ($w.CommandLine -match 'backend') { 'backend' } else { 'frontend' }) (pid $($w.ProcessId))"
}

# Anything still holding the ports (e.g. servers started by hand)
foreach ($port in 5174, 5001) {
  Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | ForEach-Object {
    taskkill /PID $_.OwningProcess /T /F | Out-Null
    Write-Host "Stopped process on port $port"
  }
}

if (Get-NetTCPConnection -State Listen -LocalPort 27017 -ErrorAction SilentlyContinue) {
  # Clean shutdown so the database files are flushed.
  Push-Location $backend
  node -e "const {MongoClient}=require('mongodb');MongoClient.connect('mongodb://127.0.0.1:27017/admin').then(c=>c.db('admin').command({shutdown:1}).catch(()=>{})).then(()=>console.log('MongoDB stopped')).catch(e=>console.log('MongoDB:',e.message))"
  Pop-Location
}
