<#
.SYNOPSIS
  Deploy joola-intel-nextjs to production. The one command to ship.

.DESCRIPTION
  Step 1. Run qa/regression.ps1 -SkipBuild -Continue. Block and abort on failure.
  Step 2. git add → git commit -m $Message → git push origin main.
  Step 3. Vercel auto-rebuilds from main. Live in ~90s.

  This repo has NO separate staging repo — main IS the deploy branch.

.PARAMETER Message
  Required. The git commit message. No default — be explicit about what changed.

.PARAMETER SkipQa
  Skip the QA gate. Only for docs-only or trivial config changes. Prints a warning.

.EXAMPLE
  pwsh ./scripts/deploy.ps1 -Message "fix(youtube): grammar bug on 1 video"
  pwsh ./scripts/deploy.ps1 -Message "docs: update CLAUDE.md" -SkipQa
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Message,
  [switch]$SkipQa
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Push-Location $ProjectRoot
try {
  Write-Host "=== joola-intel deploy ===" -ForegroundColor Cyan
  Write-Host "Project: $ProjectRoot"
  Write-Host "Message: $Message"
  Write-Host ""

  # ── 1. QA gate ───────────────────────────────────────────────────────
  if ($SkipQa) {
    Write-Host "WARN: -SkipQa set. Skipping regression suite." -ForegroundColor Yellow
    Write-Host "      Only use this for docs-only or trivial config changes." -ForegroundColor Yellow
  } else {
    Write-Host "[1/3] QA gate (qa/regression.ps1 -SkipBuild -Continue)..." -ForegroundColor Cyan
    & "$ProjectRoot\qa\regression.ps1" -SkipBuild -Continue
    if ($LASTEXITCODE -ne 0) {
      Write-Host ""
      Write-Host "DEPLOY BLOCKED: QA regression failed. Fix the issues and re-run." -ForegroundColor Red
      Write-Host "Use -SkipQa only if you're sure (docs-only changes etc)." -ForegroundColor DarkGray
      exit 1
    }
    Write-Host "[1/3] QA PASS." -ForegroundColor Green
  }

  # ── 2. Git status check ──────────────────────────────────────────────
  Write-Host ""
  Write-Host "[2/3] git status..." -ForegroundColor Cyan
  $changes = git status --porcelain
  if (-not $changes) {
    Write-Host "Nothing to commit. Working tree clean." -ForegroundColor Yellow
    Write-Host "If you intended a push of an existing commit, run: git push origin main" -ForegroundColor DarkGray
    exit 0
  }
  $changes | ForEach-Object { Write-Host "  $_" }

  # ── 3. Commit + push ─────────────────────────────────────────────────
  Write-Host ""
  Write-Host "[3/3] git add -A && git commit && git push..." -ForegroundColor Cyan
  git add -A
  if ($LASTEXITCODE -ne 0) { throw "git add failed" }

  git commit -m $Message
  if ($LASTEXITCODE -ne 0) { throw "git commit failed" }

  $branch = (git rev-parse --abbrev-ref HEAD).Trim()
  Write-Host "Pushing branch '$branch' to origin..."
  git push origin $branch
  if ($LASTEXITCODE -ne 0) { throw "git push failed" }

  Write-Host ""
  Write-Host "=== DEPLOY DONE ===" -ForegroundColor Green
  Write-Host "Vercel will auto-rebuild from main in ~90s."
  Write-Host "Watch: https://vercel.com/dashboard"
  Write-Host "Live:  https://saas-joola-intel.vercel.app"
} finally {
  Pop-Location
}
