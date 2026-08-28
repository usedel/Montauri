# probe overhead benchmark (Gate C: probe overhead < 1.5x)
# Usage: powershell -File bench_probe.ps1   (in bench/sample/unannotated_scraper)
$ErrorActionPreference = "Stop"
$env:PYTHONIOENCODING = "utf-8"
$env:OPENCHARM_PROBE_QUIET = "1"   # suppress probe summary (goes to stderr)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$probeExe = "F:\ai-pro\open-charm\probe\.venv\Scripts\opencharm-probe.exe"

function Get-BenchMs([scriptblock]$runner) {
    $best = [double]::MaxValue
    for ($i = 0; $i -lt 3; $i++) {
        $out = & $runner 2>$null | Select-String "^bench:"
        if (-not $out) { throw "bench output not captured" }
        $ms = [double]($out -replace "bench: ", "" -replace "s \(.*", "") * 1000
        if ($ms -lt $best) { $best = $ms }
    }
    return $best
}

Write-Host "=== plain (best of 3) ==="
$plainMs = Get-BenchMs { param() & uv run python bench_probe.py }
Write-Host ("plain best: {0:F1} ms" -f $plainMs)

Write-Host "=== probed (best of 3) ==="
$probedMs = Get-BenchMs { param() & $probeExe inject -- uv run python bench_probe.py }
Write-Host ("probed best: {0:F1} ms" -f $probedMs)

$ratio = $probedMs / $plainMs
Write-Host ("=== overhead ratio: {0:F2}x (Gate C limit 1.5x) ===" -f $ratio)
if ($ratio -lt 1.5) { Write-Host "PASS" } else { Write-Host "FAIL" }
