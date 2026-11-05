# ==============================================================================
# Kyrpy UI/UX Designer — One-Click Runner (Windows PowerShell)
# ==============================================================================
# Usage:
#   .\runner.ps1 start     # Start server in background
#   .\runner.ps1 dev       # Start in Dev Mode (bypasses Login/Register page)
#   .\runner.ps1 release   # Start in Release Mode (protects page with Login/Register)
#   .\runner.ps1 stop      # Stop server
#   .\runner.ps1 restart   # Restart server
#   .\runner.ps1 status    # Check server status
# ==============================================================================

param(
  [string]$Command = "start"
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

$EnvFile = Join-Path $RootDir ".env"
if (Test-Path $EnvFile) {
  Get-Content $EnvFile | ForEach-Object {
    if ($_ -match "^\s*([^#][^=]+)=(.*)$") {
      [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
  }
}

$Port = if ($env:PORT) { $env:PORT } else { "5180" }
$HostAddr = if ($env:HOST) { $env:HOST } else { "127.0.0.1" }
$AppMode = if ($env:APP_MODE) { $env:APP_MODE } else { "dev" }
$BypassAuth = if ($env:BYPASS_AUTH) { $env:BYPASS_AUTH } else { "true" }
$PidFile = Join-Path $RootDir ".designer-runner.pid"

function Stop-Designer {
  if (Test-Path $PidFile) {
    $TargetPid = Get-Content $PidFile
    Stop-Process -Id $TargetPid -Force -ErrorAction SilentlyContinue
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped Kyrpy UI/UX Designer (PID $TargetPid)" -ForegroundColor Yellow
  }
}

function Start-Designer([string]$Mode, [string]$Bypass) {
  Stop-Designer
  $env:PORT = $Port
  $env:HOST = $HostAddr
  $env:APP_MODE = $Mode
  $env:BYPASS_AUTH = $Bypass
  Write-Host "Starting Kyrpy UI/UX Designer on http://${HostAddr}:${Port} (APP_MODE=$Mode, BYPASS_AUTH=$Bypass)..." -ForegroundColor Cyan
  $Proc = Start-Process -FilePath "node" -ArgumentList "--disable-warning=ExperimentalWarning", "index.js" -WorkingDirectory (Join-Path $RootDir "src") -PassThru -WindowStyle Hidden
  Set-Content -Path $PidFile -Value $Proc.Id
  Write-Host "[OK] Running (PID $($Proc.Id)) -> http://${HostAddr}:${Port}" -ForegroundColor Green
  Write-Host "Default login credential: username 'admin' / password 'admin'" -ForegroundColor Gray
}

switch ($Command.ToLower()) {
  "start"   { Start-Designer $AppMode $BypassAuth }
  "dev"     { Start-Designer "dev" "true" }
  "release" { Start-Designer "release" "false" }
  "stop"    { Stop-Designer }
  "restart" { Start-Designer $AppMode $BypassAuth }
  "status"  {
    if (Test-Path $PidFile) {
      Write-Host "Kyrpy UI/UX Designer PID: $(Get-Content $PidFile) on http://${HostAddr}:${Port}" -ForegroundColor Green
    } else {
      Write-Host "Kyrpy UI/UX Designer is not running." -ForegroundColor Yellow
    }
  }
  default {
    Write-Host "Usage: .\runner.ps1 [start|dev|release|stop|restart|status]"
  }
}
