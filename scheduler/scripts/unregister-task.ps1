$TaskName = "InvestmentStudioScheduler"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "[OK] Task '$TaskName' unregistered."
