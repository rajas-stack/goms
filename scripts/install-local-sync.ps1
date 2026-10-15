param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$taskName = 'GOMS-AllAgents-Sync-8088'
$workspace = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $PSScriptRoot 'local-sync.mjs'
if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Output 'GOMS sync schedule removed. Source and running services were preserved.'
    exit
}
if ((Get-TimeZone).Id -ne 'India Standard Time') {
    throw 'This schedule is anchored to 00:00 IST. Set up an IST-aware trigger before installing on another host timezone.'
}
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Actions.Arguments -notlike "*$entry*") {
    throw 'A different task already uses this name; it was preserved.'
}
$node = (Get-Command node.exe).Source
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$entry`" --scheduled" -WorkingDirectory $workspace
$nextBoundary = [DateTime]::Today.AddHours(2 * ([Math]::Floor((Get-Date).Hour / 2) + 1))
$trigger = New-ScheduledTaskTrigger -Once -At $nextBoundary -RepetitionInterval (New-TimeSpan -Hours 2)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 110) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Gather saved Claude, Codex, and Gemini updates; fully build and host on 8088 every 2h; publish privacy-safe Shubham_Side snapshots every 4h (IST).' -Force | Select-Object TaskName,State
Get-ScheduledTaskInfo -TaskName $taskName | Select-Object NextRunTime,LastTaskResult
