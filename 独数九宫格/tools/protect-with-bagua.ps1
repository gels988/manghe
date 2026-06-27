param(
    [string[]]$TargetFiles = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$baguaScript = Join-Path $projectRoot 'js\bagua.protect.js'
$bitsToBagua = @{
    "000" = "8"
    "001" = "4"
    "010" = "6"
    "011" = "2"
    "100" = "7"
    "101" = "3"
    "110" = "5"
    "111" = "1"
}

function Convert-ToBaguaPayload {
    param([Parameter(Mandatory = $true)][string]$Text)

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $bitBuilder = [System.Text.StringBuilder]::new()
    foreach ($byte in $bytes) {
        [void]$bitBuilder.Append(([Convert]::ToString($byte, 2)).PadLeft(8, "0"))
    }

    $bitStream = $bitBuilder.ToString()
    $originalBitLength = $bitStream.Length
    $padding = (3 - ($bitStream.Length % 3)) % 3
    if ($padding -gt 0) {
        $bitStream += ("0" * $padding)
    }

    $baguaBuilder = [System.Text.StringBuilder]::new()
    for ($i = 0; $i -lt $bitStream.Length; $i += 3) {
        $chunk = $bitStream.Substring($i, 3)
        [void]$baguaBuilder.Append($bitsToBagua[$chunk])
    }

    return [pscustomobject]@{
        BitLength = $originalBitLength
        Payload   = $baguaBuilder.ToString()
    }
}

function Get-RelativePathCompat {
    param(
        [Parameter(Mandatory = $true)][string]$FromPath,
        [Parameter(Mandatory = $true)][string]$ToPath
    )

    $fromFull = [System.IO.Path]::GetFullPath($FromPath)
    if (-not $fromFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $fromFull += [System.IO.Path]::DirectorySeparatorChar
    }

    $fromUri = [System.Uri]$fromFull
    $toUri = [System.Uri]([System.IO.Path]::GetFullPath($ToPath))
    return $fromUri.MakeRelativeUri($toUri).ToString()
}

function Protect-HtmlFile {
    param([Parameter(Mandatory = $true)][string]$FilePath)

    if (-not (Test-Path -LiteralPath $FilePath)) {
        throw "FILE_NOT_FOUND: $FilePath"
    }

    $raw = Get-Content -LiteralPath $FilePath -Raw -Encoding UTF8
    $bodyMatch = [regex]::Match($raw, '(?is)<body\b[^>]*>(.*?)</body>')
    if (-not $bodyMatch.Success) {
        throw "BODY_NOT_FOUND: $FilePath"
    }

    $bodyInner = $bodyMatch.Groups[1].Value
    $scriptPattern = '(?is)\s*<script\b[^>]*\bsrc\s*=\s*"([^"]+)"[^>]*>\s*</script>\s*'
    $scriptMatches = [regex]::Matches($bodyInner, $scriptPattern)
    $pageScripts = @($scriptMatches | ForEach-Object { $_.Value.Trim() }) -join "`r`n    "
    $bodyMarkup = [regex]::Replace($bodyInner, $scriptPattern, "")
    $bodyMarkup = $bodyMarkup.Trim("`r", "`n")

    $encoded = Convert-ToBaguaPayload -Text $bodyMarkup
    $relativeBagua = Get-RelativePathCompat -FromPath (Split-Path -Parent $FilePath) -ToPath $baguaScript

    $protectedBody = @"
<body>
    <div id="bagua-protected-root"></div>
    <script type="application/x-bagua" data-bagua-target="bagua-protected-root" data-bagua-bits="$($encoded.BitLength)">
$($encoded.Payload)
    </script>
    <script src="$relativeBagua"></script>
    $pageScripts
</body>
"@

    $updated = [regex]::Replace($raw, '(?is)<body\b[^>]*>.*?</body>', [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $protectedBody }, 1)
    Set-Content -LiteralPath $FilePath -Value $updated -Encoding UTF8

    [pscustomobject]@{
        File      = $FilePath
        BitLength = $encoded.BitLength
        Digits    = $encoded.Payload.Length
    }
}

if ($TargetFiles.Count -eq 0) {
    $TargetFiles = @(
        (Join-Path $projectRoot 'index.html\index.html'),
        (Join-Path $projectRoot 'juanzeng.html'),
        (Join-Path $projectRoot 'zixitong.html')
    )
}

$results = foreach ($file in $TargetFiles) {
    Protect-HtmlFile -FilePath $file
}

$results | Format-Table -AutoSize
