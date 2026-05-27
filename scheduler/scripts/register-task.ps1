param(
    [Parameter(Mandatory=$true)]
    [string]$WorkspaceDir,
    [string]$NodePath = "node",
    [string]$CronHour = "7,12,19"
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SchedulerDir = Split-Path -Parent $ScriptDir
$EntryPoint = Join-Path $SchedulerDir "dist\index.js"

$TaskName = "InvestmentStudioScheduler"

$Triggers = @()
foreach ($hour in $CronHour.Split(",")) {
    $Triggers += New-ScheduledTaskTrigger -Daily -At "${hour}:00"
}

$Action = New-ScheduledTaskAction -Execute $NodePath -Argument "`"$EntryPoint`" `"$WorkspaceDir`"" -WorkingDirectory $SchedulerDir

$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Triggers -Settings $Settings -Description "Investment Studio - Automated research skill execution" -Force

Write-Host "[OK] Task '$TaskName' registered successfully."
Write-Host "Workspace: $WorkspaceDir"
Write-Host "Schedule: Daily at $CronHour"
