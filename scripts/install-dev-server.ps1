param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$taskName = 'GOMS-Dev-Server-5173'
$workspace = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $PSScriptRoot 'run-dev-server.ps1'
$legacyEntry = Join-Path $PSScriptRoot 'dev-server-watchdog.mjs'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Actions.Arguments -notlike "*$entry*" -and $existing.Actions.Arguments -notlike "*$legacyEntry*") {
    throw 'A different task already uses this name; it was preserved.'
}
if ($Uninstall) {
    if ($existing) {
        Stop-ScheduledTask -TaskName $taskName
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
    Write-Output 'GOMS dev-server startup removed. Source and data were preserved.'
    exit
}
$powershell = (Get-Command powershell.exe).Source
$action = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$entry`"" -WorkingDirectory $workspace
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$recovery = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($trigger, $recovery) -Principal $principal -Settings $settings -Description 'Keep the GOMS built preview on 127.0.0.1:5173; start at sign-in, restart after failure, and recover missing supervision every minute.' -Force | Select-Object TaskName,State
Start-ScheduledTask -TaskName $taskName
Write-Output 'GOMS dev-server supervision enabled at http://127.0.0.1:5173.'
