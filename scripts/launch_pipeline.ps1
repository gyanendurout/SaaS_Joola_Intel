# JOOLA Intel — Unattended pipeline launcher
# Streams pipeline output to terminal AND appends to pipeline.log
# Auto-retries up to 3 times; progress monitor appends snapshots every 5 min.
#
# Run: powershell -ExecutionPolicy Bypass -File scripts\launch_pipeline.ps1

Set-Location "C:\Workspace\joola-intel-nextjs"

$LogFile     = "C:\Workspace\joola-intel-nextjs\pipeline.log"
$MonitorLog  = "C:\Workspace\joola-intel-nextjs\monitor.log"
$MaxRetries  = 3

# ── Clear old logs ────────────────────────────────────────────────────────────
Remove-Item $LogFile    -Force -ErrorAction SilentlyContinue
Remove-Item $MonitorLog -Force -ErrorAction SilentlyContinue

$startMsg = @"

================================================================
  JOOLA INTEL PIPELINE  $(Get-Date -Format "yyyy-MM-dd HH:mm") UTC
  Phases: scrape -> enrich -> facts -> sales-intelligence
  Parallel: YES   Retry: $MaxRetries x   Incremental: YES (fresh checkpoint)
  Log: $LogFile
================================================================
"@
Write-Host $startMsg -ForegroundColor Cyan
Add-Content -Path $LogFile -Value $startMsg -Encoding UTF8

# ── Start progress monitor (background job in this session) ───────────────────
$monJob = Start-Job -ScriptBlock {
    Set-Location "C:\Workspace\joola-intel-nextjs"
    & python -u scripts\progress_monitor.py
}
Write-Host "[$(Get-Date -Format HH:mm:ss)] Progress monitor running (5-min snapshots to monitor.log)" -ForegroundColor Green

# ── Redirect monitor output to monitor.log (background) ──────────────────────
$null = Start-Job -ScriptBlock {
    param($jobId)
    while ($true) {
        $out = Receive-Job -Id $jobId -ErrorAction SilentlyContinue
        if ($out) { Add-Content -Path "C:\Workspace\joola-intel-nextjs\monitor.log" -Value $out -Encoding UTF8 }
        Start-Sleep -Seconds 10
    }
} -ArgumentList $monJob.Id

# ── Pipeline retry loop ───────────────────────────────────────────────────────
$attempt  = 0
$exitCode = 1

while ($attempt -lt $MaxRetries) {
    $attempt++

    $separator = "`n$('-' * 64)`n  ATTEMPT $attempt / $MaxRetries  $(Get-Date -Format 'HH:mm:ss')`n$('-' * 64)"
    Write-Host $separator -ForegroundColor Yellow
    Add-Content -Path $LogFile -Value $separator -Encoding UTF8

    # Build args: --restart on first attempt only
    $runArgs = @("-u", "-m", "backend.scraping.run", "--module", "all")
    if ($attempt -eq 1) { $runArgs += "--restart" }

    # Stream pipeline output: display in terminal AND append to log
    & python @runArgs 2>&1 | Tee-Object -FilePath $LogFile -Append

    $exitCode = $LASTEXITCODE

    $result = if ($exitCode -eq 0) { "SUCCESS (exit 0)" } else { "FAILED (exit $exitCode)" }
    $endLine = "`n[$(Get-Date -Format HH:mm:ss)] Attempt $attempt result: $result"
    Write-Host $endLine -ForegroundColor $(if ($exitCode -eq 0) { "Green" } else { "Red" })
    Add-Content -Path $LogFile -Value $endLine -Encoding UTF8

    if ($exitCode -eq 0) { break }

    if ($attempt -lt $MaxRetries) {
        $retryMsg = "[$(Get-Date -Format HH:mm:ss)] Waiting 90s then retrying..."
        Write-Host $retryMsg -ForegroundColor Yellow
        Add-Content -Path $LogFile -Value $retryMsg -Encoding UTF8
        Start-Sleep -Seconds 90
    }
}

# ── Final summary ─────────────────────────────────────────────────────────────
Stop-Job $monJob.Id -ErrorAction SilentlyContinue
Remove-Job -Force -ErrorAction SilentlyContinue

$finalMsg = if ($exitCode -eq 0) {
    "`n================================================================`n  ALL DONE. Data is in Supabase. $(Get-Date -Format 'HH:mm') UTC`n================================================================"
} else {
    "`n================================================================`n  FINISHED WITH ERRORS after $attempt attempts.`n  To resume: python -m backend.scraping.run --module all`n================================================================"
}

Write-Host $finalMsg -ForegroundColor $(if ($exitCode -eq 0) { "Green" } else { "Red" })
Add-Content -Path $LogFile -Value $finalMsg -Encoding UTF8

Write-Host "`nPress any key to close..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
