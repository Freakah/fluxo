# One-click Windows launcher: installs what Fluxo needs (first run only), starts the server
# in the background if it isn't running, adds a desktop icon and opens Fluxo in its own window.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$url = 'http://localhost:3000'
Set-Location $repo

function Say($msg) { Write-Host "  $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "`n  $msg`n" -ForegroundColor Red; exit 1 }
# shortcut: assumes the default port 3000; read PORT from .env if people start changing it.
function Test-Up { try { (Invoke-WebRequest 'http://127.0.0.1:3000/api/health' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false } }

if (-not (Test-Up)) {
  # 1. Node.js 24 or newer
  $nodeOk = $false
  try { & node -e "process.exit(+process.versions.node.split('.')[0] >= 24 ? 0 : 1)"; $nodeOk = $LASTEXITCODE -eq 0 } catch {}
  if (-not $nodeOk) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      Start-Process 'https://nodejs.org/en/download'
      Fail 'Fluxo needs Node.js (version 24 or newer). Install the LTS version from the page that just opened, then double-click "Start Fluxo" again.'
    }
    Say 'Installing Node.js (one time only)...'
    & winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    $env:Path = "$env:ProgramFiles\nodejs;$env:Path"
    try { & node -e "process.exit(+process.versions.node.split('.')[0] >= 24 ? 0 : 1)"; $nodeOk = $LASTEXITCODE -eq 0 } catch {}
    if (-not $nodeOk) { Fail 'Node.js could not be installed automatically. Install it from https://nodejs.org (LTS), then try again.' }
  }

  # 2. Libraries and the web interface
  if (-not (Test-Path "$repo\node_modules")) {
    Say 'Downloading the parts Fluxo is built from (one time only, a few minutes)...'
    & npm.cmd ci --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) { Fail 'Download failed. Check your internet connection and try again.' }
  }
  if (-not (Test-Path "$repo\web\dist\index.html")) {
    Say 'Preparing the app (one time only)...'
    & npm.cmd run build --silent
    if ($LASTEXITCODE -ne 0) { Fail 'Preparing the app failed.' }
  }

  # 3. Start the server in the background (it keeps running after the window is closed)
  Say 'Starting Fluxo...'
  New-Item -ItemType Directory -Force "$repo\data" | Out-Null
  Start-Process -FilePath 'node' -ArgumentList '--env-file-if-exists=.env', 'server/index.ts' -WorkingDirectory $repo -WindowStyle Hidden `
    -RedirectStandardOutput "$repo\data\server.log" -RedirectStandardError "$repo\data\server-error.log"
  for ($i = 0; $i -lt 60 -and -not (Test-Up); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Up)) { Fail "Fluxo did not start. Details: $repo\data\server-error.log" }
}

# 4. Desktop and Start menu icons pointing back to this launcher
$shell = New-Object -ComObject WScript.Shell
$startMenu = [Environment]::GetFolderPath('Programs')
foreach ($link in @("$([Environment]::GetFolderPath('Desktop'))\Fluxo.lnk", "$startMenu\Fluxo.lnk")) {
  $s = $shell.CreateShortcut($link)
  $s.TargetPath = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  $s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""
  $s.WorkingDirectory = $repo
  $s.IconLocation = "$PSScriptRoot\fluxo.ico,0"
  $s.WindowStyle = 7
  $s.Description = 'Open Fluxo'
  $s.Save()
}

# 5. Open Fluxo in its own window (Edge ships with Windows; fall back to the default browser)
try { Start-Process 'msedge.exe' "--app=$url" } catch { Start-Process $url }
