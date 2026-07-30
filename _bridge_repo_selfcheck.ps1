$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$OfficialWebOrigin = 'https://dushu-cd1.pages.dev'
$OfficialApiOrigin = 'https://rome-moss-gained-originally.trycloudflare.com'
$LegacyPublicHost = 'https://gels988.github.io/manghe/'
$OuterGhostDir = Join-Path $RepoRoot 'index.html'
$OuterGhostIndex = Join-Path $OuterGhostDir 'index.html'
$FormalDir = Get-ChildItem -Path $RepoRoot -Directory | Where-Object { $_.Name -ne 'index.html' -and $_.Name -ne '.git' } | Select-Object -First 1
if (-not $FormalDir) {
    throw 'Formal project directory not found.'
}
$FormalIndex = Join-Path $FormalDir.FullName 'index.html\index.html'
$DeployDoc = Join-Path $FormalDir.FullName 'README_DEPLOY.md'

function Write-Step {
    param([string]$Message)
    Write-Host "[SELFCHECK] $Message" -ForegroundColor Cyan
}

function Test-RebaseInProgress {
    $gitDir = Join-Path $RepoRoot '.git'
    return (Test-Path (Join-Path $gitDir 'rebase-merge')) -or (Test-Path (Join-Path $gitDir 'rebase-apply'))
}

function Test-DirtyWorktree {
    $status = git status --short
    return @($status | Where-Object { $_ -and $_ -notmatch '^\?\? \.env$' }).Count -gt 0
}

function Repair-DeployDoc {
    if (-not (Test-Path $DeployDoc)) { return $false }
    $content = Get-Content -Raw -Path $DeployDoc
    $next = $content `
        -replace 'https://[^/\s]+\.github\.io/[^\s]+/register\.html', "$OfficialWebOrigin/register.html" `
        -replace 'https://[^/\s]+\.pages\.dev/register\.html', "$OfficialWebOrigin/register.html"
    if ($next -ne $content) {
        Set-Content -Path $DeployDoc -Value $next -Encoding UTF8
        Write-Step 'README_DEPLOY.md normalized'
        return $true
    }
    return $false
}

function Repair-FormalIndex {
    if (-not (Test-Path $FormalIndex)) { return $false }
    $content = Get-Content -Raw -Path $FormalIndex
    $next = $content `
        -replace [regex]::Escape($LegacyPublicHost), "$OfficialWebOrigin/" `
        -replace 'https://gels988\.github\.io/manghe/?', $OfficialWebOrigin `
        -replace 'https://api\.dushu-cd1\.pages\.dev', $OfficialApiOrigin
    if ($next -ne $content) {
        Set-Content -Path $FormalIndex -Value $next -Encoding UTF8
        Write-Step 'Formal index URL normalized'
        return $true
    }
    return $false
}

function Remove-OuterGhostCopy {
    if ((Test-Path $OuterGhostIndex) -and (Test-Path $FormalIndex)) {
        Remove-Item -Path $OuterGhostDir -Recurse -Force
        Write-Step 'Removed outer ghost copy index.html/'
        return $true
    }
    return $false
}

function Ensure-RemoteSynced {
    if (Test-RebaseInProgress) {
        Write-Step 'Rebase detected, aborting rebase'
        git rebase --abort | Out-Null
    }
    if (Test-DirtyWorktree) {
        Write-Step 'Dirty worktree detected, skip pull and continue local heal'
        return
    }
    git pull origin main -X theirs
}

Push-Location $RepoRoot
try {
    $changed = $false
    Ensure-RemoteSynced
    $changed = (Repair-FormalIndex) -or $changed
    $changed = (Repair-DeployDoc) -or $changed
    $changed = (Remove-OuterGhostCopy) -or $changed

    $status = git status --short
    $hasTrackableChange = @($status | Where-Object { $_ -and $_ -notmatch '^\?\? \.env$' }).Count -gt 0

    if ($changed -or $hasTrackableChange) {
        Write-Step 'Trackable changes found, staging managed files'
        git add -- $FormalDir.Name '_bridge_repo_selfcheck.ps1'
        git add -A -- 'index.html'
        if (-not [string]::IsNullOrWhiteSpace((git diff --cached --name-only))) {
            git commit -m 'Self-heal official domain routing and repo state'
        }
        git push origin main
        Write-Step 'Repo self-heal synced to main'
    } else {
        Write-Step 'Repo already clean'
    }

    Write-Host "OFFICIAL_WEB=$OfficialWebOrigin"
    Write-Host "OFFICIAL_API=$OfficialApiOrigin"
} finally {
    Pop-Location
}
