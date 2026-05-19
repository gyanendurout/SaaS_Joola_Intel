<#
.SYNOPSIS
  joola-intel-nextjs regression suite. Runs every check that must pass before a push.

.DESCRIPTION
  4 stages, run sequentially:
    1. Typecheck   — npx tsc --noEmit
    2. Build       — npm run build  (skippable with -SkipBuild)
    3. Route smoke — HTTP GET each known route, assert 200 (skippable with -SkipRoutes)
    4. Playwright  — npx playwright test e2e/ (skippable with -SkipPlaywright)

  On overall PASS: writes c:\tmp\joola-intel-qa-passed.flag (read by .husky/pre-push and scripts/deploy.ps1).
  On overall FAIL: deletes the flag and exits with code 1.

  -Continue prints failures but keeps running through all stages.

.EXAMPLE
  pwsh ./qa/regression.ps1                          # full run
  pwsh ./qa/regression.ps1 -SkipBuild               # skip slow build step
  pwsh ./qa/regression.ps1 -SkipBuild -SkipPlaywright -Continue
#>

[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [switch]$SkipRoutes,
  [switch]$SkipPlaywright,
  [switch]$Continue,
  [string]$BaseUrl = $(if ($env:PLAYWRIGHT_BASE_URL) { $env:PLAYWRIGHT_BASE_URL } else { 'http://localhost:3000' })
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$FlagFile    = 'c:\tmp\joola-intel-qa-passed.flag'
$LogFile     = 'c:\tmp\joola-intel-qa-run.log'

# Keep this in sync with e2e/smoke.spec.ts PAGES and the live sidebar.
$ROUTES = @(
  '/v2',
  '/v2/instagram',
  '/v2/youtube',
  '/v2/reddit',
  '/v2/comments',
  '/v2/influencers',
  '/v2/ads',
  '/v2/promotions',
  '/v2/products',
  '/v2/market',
  '/v2/twitter',
  '/v2/tiktok'
)

if (-not (Test-Path 'c:\tmp')) { New-Item -ItemType Directory -Path 'c:\tmp' -Force | Out-Null }
"" | Out-File -FilePath $LogFile -Encoding utf8

$results = [System.Collections.ArrayList]@()
function Record($stage, $status, $detail) {
  $row = [pscustomobject]@{ Stage = $stage; Status = $status; Detail = $detail }
  [void]$results.Add($row)
  $line = "{0,-14} {1,-6} {2}" -f $stage, $status, $detail
  Write-Host $line -ForegroundColor $(if ($status -eq 'PASS') { 'Green' } elseif ($status -eq 'SKIP') { 'DarkGray' } else { 'Red' })
  Add-Content -Path $LogFile -Value $line -Encoding utf8
}

function Fail($msg) {
  Write-Host ""
  Write-Host "STAGE FAILED: $msg" -ForegroundColor Red
  if (-not $Continue) {
    if (Test-Path $FlagFile) { Remove-Item $FlagFile -Force }
    Write-Host "Run with -Continue to see all stage results." -ForegroundColor DarkGray
    exit 1
  }
}

Push-Location $ProjectRoot
try {
  Write-Host "=== joola-intel regression ===" -ForegroundColor Cyan
  Write-Host "Project: $ProjectRoot"
  Write-Host "Base URL: $BaseUrl"
  Write-Host ""

  # ── 1. Typecheck ─────────────────────────────────────────────────────
  $sw = [Diagnostics.Stopwatch]::StartNew()
  Write-Host "[1/4] Typecheck (npx tsc --noEmit)..."
  $tscOut = & npx tsc --noEmit 2>&1
  $tscExit = $LASTEXITCODE
  $sw.Stop()
  if ($tscExit -eq 0) {
    Record 'typecheck' 'PASS' ("{0}s" -f [int]$sw.Elapsed.TotalSeconds)
  } else {
    Record 'typecheck' 'FAIL' ("exit={0}, see log" -f $tscExit)
    Add-Content -Path $LogFile -Value ($tscOut -join "`n") -Encoding utf8
    Fail "tsc reported errors"
  }

  # ── 2. Build ─────────────────────────────────────────────────────────
  if ($SkipBuild) {
    Record 'build' 'SKIP' '-SkipBuild'
  } else {
    $sw.Restart()
    Write-Host "[2/4] Build (npm run build)..."
    $buildOut = & npm run build 2>&1
    $buildExit = $LASTEXITCODE
    $sw.Stop()
    if ($buildExit -eq 0) {
      Record 'build' 'PASS' ("{0}s" -f [int]$sw.Elapsed.TotalSeconds)
    } else {
      Record 'build' 'FAIL' ("exit={0}" -f $buildExit)
      Add-Content -Path $LogFile -Value ($buildOut -join "`n") -Encoding utf8
      Fail "next build failed"
    }
  }

  # ── 3. Route smoke ───────────────────────────────────────────────────
  if ($SkipRoutes) {
    Record 'routes' 'SKIP' '-SkipRoutes'
  } else {
    $sw.Restart()
    Write-Host "[3/4] Route smoke (HTTP GET $($ROUTES.Count) routes against $BaseUrl)..."
    $reachable = $false
    try {
      $head = Invoke-WebRequest -Uri $BaseUrl -Method Head -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
      $reachable = $true
    } catch { $reachable = $false }

    if (-not $reachable) {
      Record 'routes' 'SKIP' "dev server not reachable at $BaseUrl"
    } else {
      $failedRoutes = @()
      foreach ($route in $ROUTES) {
        try {
          $r = Invoke-WebRequest -Uri "$BaseUrl$route" -TimeoutSec 15 -UseBasicParsing -ErrorAction Stop
          if ($r.StatusCode -ne 200) { $failedRoutes += "$route -> $($r.StatusCode)" }
        } catch {
          $failedRoutes += "$route -> $($_.Exception.Message)"
        }
      }
      $sw.Stop()
      if ($failedRoutes.Count -eq 0) {
        Record 'routes' 'PASS' ("{0} routes in {1}s" -f $ROUTES.Count, [int]$sw.Elapsed.TotalSeconds)
      } else {
        Record 'routes' 'FAIL' ("{0} routes failed" -f $failedRoutes.Count)
        Add-Content -Path $LogFile -Value ($failedRoutes -join "`n") -Encoding utf8
        Fail "route smoke failed: $($failedRoutes -join '; ')"
      }
    }
  }

  # ── 4. Playwright E2E ────────────────────────────────────────────────
  if ($SkipPlaywright) {
    Record 'playwright' 'SKIP' '-SkipPlaywright'
  } else {
    $sw.Restart()
    Write-Host "[4/4] Playwright E2E (npx playwright test e2e/)..."
    $playwrightInstalled = Test-Path 'node_modules/@playwright/test'
    if (-not $playwrightInstalled) {
      Record 'playwright' 'SKIP' 'not installed — run: npm install && npx playwright install chromium'
    } else {
      $serverReachable = $false
      try {
        Invoke-WebRequest -Uri $BaseUrl -Method Head -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop | Out-Null
        $serverReachable = $true
      } catch { $serverReachable = $false }

      if (-not $serverReachable) {
        Record 'playwright' 'SKIP' "dev server not reachable at $BaseUrl"
      } else {
        $env:PLAYWRIGHT_BASE_URL = $BaseUrl
        $pwOut = & npx playwright test e2e/ --reporter=line 2>&1
        $pwExit = $LASTEXITCODE
        $sw.Stop()
        if ($pwExit -eq 0) {
          Record 'playwright' 'PASS' ("{0}s" -f [int]$sw.Elapsed.TotalSeconds)
        } else {
          Record 'playwright' 'FAIL' ("exit={0}" -f $pwExit)
          Add-Content -Path $LogFile -Value ($pwOut -join "`n") -Encoding utf8
          Fail "playwright failed"
        }
      }
    }
  }

  # ── Summary ──────────────────────────────────────────────────────────
  Write-Host ""
  Write-Host "=== Summary ===" -ForegroundColor Cyan
  $results | Format-Table -AutoSize | Out-Host

  $hardFails = @($results | Where-Object { $_.Status -eq 'FAIL' })
  if ($hardFails.Count -eq 0) {
    Set-Content -Path $FlagFile -Value (Get-Date -Format o) -Encoding utf8
    Write-Host "PASS — flag written: $FlagFile" -ForegroundColor Green
    exit 0
  } else {
    if (Test-Path $FlagFile) { Remove-Item $FlagFile -Force }
    Write-Host "FAIL — $($hardFails.Count) stage(s) failed. Flag cleared." -ForegroundColor Red
    Write-Host "Full log: $LogFile" -ForegroundColor DarkGray
    exit 1
  }
} finally {
  Pop-Location
}
