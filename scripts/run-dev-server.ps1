$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $PSScriptRoot 'dev-server-watchdog.mjs'
$stateDir = Join-Path (Split-Path -Parent $workspace) '.goms-dev-server'
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$node = (Get-Command node.exe).Source
$process = Start-Process -FilePath $node -ArgumentList "`"$entry`"" -WorkingDirectory $workspace -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $stateDir 'watchdog.out.log') -RedirectStandardError (Join-Path $stateDir 'watchdog.err.log')
exit $process.ExitCode
