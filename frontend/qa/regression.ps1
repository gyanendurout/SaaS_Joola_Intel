<#
.SYNOPSIS
  joola-intel-nextjs regression suite. Runs every check that must pass before a push.

.DESCRIPTION
  4 stages, run sequentially:
    1. Typecheck   — npx tsc --noEmit
    2. Build       — npm run build  (skippable with -SkipBuild)
    3. Route smoke — HTTP GET each known route, assert 200 (skippable with -SkipRoutes)
    4. Playwright  — npx playwright test e2e/ (skippable with -SkipPlaywright)
    5. Tooltips    — qa/tooltip-check.mjs (every (?) popup actually renders)

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

$unverified = [System.Collections.ArrayList]@()

# A stage that could not run is NOT a stage that passed. Deliberate skips
# (-SkipBuild / -SkipRoutes / -SkipPlaywright) are an explicit opt-out and stay
# green; incidental skips (no dev server, tool missing) withhold the pass flag,
# because .husky/pre-push and scripts/deploy.ps1 treat that flag as permission
# to ship.
function SkipStage($stage, $detail, [switch]$Deliberate) {
  Record $stage 'SKIP' $detail
  if (-not $Deliberate) { [void]$unverified.Add($stage) }
}

# Run a native executable without letting its stderr abort the script.
# PowerShell 5.1 wraps native stderr in ErrorRecords; under
# $ErrorActionPreference='Stop' one harmless notice (e.g. node's "NO_COLOR is
# ignored due to FORCE_COLOR") throws before the stage can record a result.
# Only $LASTEXITCODE decides pass/fail here.
function Invoke-Native {
  param([string]$File, [string[]]$Arguments)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $out  = & $File @Arguments 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  [pscustomobject]@{ Output = $out; ExitCode = $code }
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
  Write-Host "[1/5] Typecheck (npx tsc --noEmit)..."
  $tscRun = Invoke-Native 'npx' @('tsc','--noEmit')
  $tscOut = $tscRun.Output
  $tscExit = $tscRun.ExitCode
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
    SkipStage 'build' '-SkipBuild' -Deliberate
  } else {
    $sw.Restart()
    Write-Host "[2/5] Build (npm run build)..."
    $buildRun = Invoke-Native 'npm' @('run','build')
    $buildOut = $buildRun.Output
    $buildExit = $buildRun.ExitCode
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
    SkipStage 'routes' '-SkipRoutes' -Deliberate
  } else {
    $sw.Restart()
    Write-Host "[3/5] Route smoke (HTTP GET $($ROUTES.Count) routes against $BaseUrl)..."
    $reachable = $false
    try {
      $head = Invoke-WebRequest -Uri $BaseUrl -Method Head -TimeoutSec 30 -UseBasicParsing -ErrorAction Stop
      $reachable = $true
    } catch { $reachable = $false }

    if (-not $reachable) {
      SkipStage 'routes' "dev server not reachable at $BaseUrl"
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
    SkipStage 'playwright' '-SkipPlaywright' -Deliberate
  } else {
    $sw.Restart()
    Write-Host "[4/5] Playwright E2E (npx playwright test e2e/)..."
    $playwrightInstalled = Test-Path 'node_modules/@playwright/test'
    if (-not $playwrightInstalled) {
      SkipStage 'playwright' 'not installed -- run: npm install && npx playwright install chromium'
    } else {
      $serverReachable = $false
      try {
        Invoke-WebRequest -Uri $BaseUrl -Method Head -TimeoutSec 30 -UseBasicParsing -ErrorAction Stop | Out-Null
        $serverReachable = $true
      } catch { $serverReachable = $false }

      if (-not $serverReachable) {
        SkipStage 'playwright' "dev server not reachable at $BaseUrl"
      } else {
        $env:PLAYWRIGHT_BASE_URL = $BaseUrl
        $pwRun = Invoke-Native 'npx' @('playwright','test','e2e/','--reporter=line')
        $pwOut = $pwRun.Output
        $pwExit = $pwRun.ExitCode
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

  # ── 5. Tooltip visibility ────────────────────────────────────────────
  # Guards the 2026-08-24 regression: `.si-popup` carried `display:none` with no
  # rule to un-hide it, so every (?) tooltip site-wide mounted but rendered
  # invisible. A DOM-presence check would have passed — this asserts computed
  # visibility and a non-zero box, which is the only thing that catches it.
  $sw.Restart()
  Write-Host "[5/5] Tooltip visibility (qa/tooltip-check.mjs)..."
  $serverUp = $false
  try {
    Invoke-WebRequest -Uri $BaseUrl -Method Head -TimeoutSec 30 -UseBasicParsing -ErrorAction Stop | Out-Null
    $serverUp = $true
  } catch { $serverUp = $false }

  if (-not (Test-Path 'node_modules/playwright-core')) {
    SkipStage 'tooltips' 'playwright-core not installed'
  } elseif (-not $serverUp) {
    SkipStage 'tooltips' "server not reachable at $BaseUrl"
  } else {
    $ttRun = Invoke-Native 'node' @('qa/tooltip-check.mjs', $BaseUrl)
    $ttOut = $ttRun.Output
    $ttExit = $ttRun.ExitCode
    $sw.Stop()
    if ($ttExit -eq 0) {
      Record 'tooltips' 'PASS' ("{0}s" -f [int]$sw.Elapsed.TotalSeconds)
    } else {
      Record 'tooltips' 'FAIL' ("exit={0}" -f $ttExit)
      Add-Content -Path $LogFile -Value ($ttOut -join "`n") -Encoding utf8
      Fail "tooltip check failed"
    }
  }

  # ── Summary ──────────────────────────────────────────────────────────
  Write-Host ""
  Write-Host "=== Summary ===" -ForegroundColor Cyan
  $results | Format-Table -AutoSize | Out-Host

  $hardFails = @($results | Where-Object { $_.Status -eq 'FAIL' })
  if ($hardFails.Count -eq 0 -and $unverified.Count -eq 0) {
    Set-Content -Path $FlagFile -Value (Get-Date -Format o) -Encoding utf8
    Write-Host "PASS -- flag written: $FlagFile" -ForegroundColor Green
    exit 0
  } elseif ($hardFails.Count -eq 0) {
    if (Test-Path $FlagFile) { Remove-Item $FlagFile -Force }
    Write-Host "INCOMPLETE -- could not verify: $($unverified -join ', ')" -ForegroundColor Yellow
    Write-Host "Nothing failed, but these stages never ran, so this is not a pass." -ForegroundColor Yellow
    Write-Host "Start the dev server (npm run dev), or pass the matching -Skip switch to opt out on purpose." -ForegroundColor DarkGray
    Write-Host "Flag NOT written: $FlagFile" -ForegroundColor DarkGray
    exit 1
  } else {
    if (Test-Path $FlagFile) { Remove-Item $FlagFile -Force }
    Write-Host "FAIL -- $($hardFails.Count) stage(s) failed. Flag cleared." -ForegroundColor Red
    Write-Host "Full log: $LogFile" -ForegroundColor DarkGray
    exit 1
  }
} finally {
  Pop-Location
}
