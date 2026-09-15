# OpenCharm bench 指标采集脚本（S1-T07）
# 用法：powershell -File bench/collect-metrics.ps1 [-Runs 3]
# 产出：冷启动时间 + 内存（主进程 + WebView2 子进程），写入 bench/reports/metrics-<date>.md

param(
    [int]$Runs = 3,
    [string]$Exe = "$PSScriptRoot\..\shell\src-tauri\target\release\opencharm-shell.exe"
)

$ErrorActionPreference = "Stop"
$exe = (Resolve-Path $Exe).Path
if (-not (Test-Path $exe)) { Write-Error "找不到 $exe（先跑 cargo build --release）"; exit 1 }

$results = @()
for ($i = 1; $i -le $Runs; $i++) {
    # 清理旧实例
    Get-Process opencharm-shell -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 500

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proc = Start-Process $exe -PassThru
    # 轮询等待主窗口出现（比固定 sleep 准确）
    while (-not $proc.MainWindowHandle -or $proc.MainWindowHandle -eq 0) {
        Start-Sleep -Milliseconds 50
        $proc.Refresh()
        if ($sw.ElapsedMilliseconds -gt 30000) { break }
    }
    $sw.Stop()
    $startupMs = $sw.ElapsedMilliseconds

    # 等待 WebView2 子进程稳定
    Start-Sleep -Seconds 4
    $proc.Refresh()
    $mainMb = [math]::Round($proc.WorkingSet64 / 1MB, 0)

    # WebView2 子进程树（主进程的直接子进程 + 其后代）
    $allWv = Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'"
    $wvIds = @($proc.Id)
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($p in $allWv) {
            if ($wvIds -contains $p.ParentProcessId -and -not ($wvIds -contains $p.ProcessId)) {
                $wvIds += $p.ProcessId
                $changed = $true
            }
        }
    }
    $wvProcs = $allWv | Where-Object { $wvIds -contains $_.ProcessId }
    $wvMb = [math]::Round(($wvProcs | Measure-Object WorkingSetSize -Sum).Sum / 1MB, 0)

    $totalMb = $mainMb + $wvMb
    $results += [PSCustomObject]@{
        Run = $i; StartupMs = $startupMs; MainMB = $mainMb; WebViewMB = $wvMb; TotalMB = $totalMb
    }
    Write-Host ("run {0}: startup={1}ms main={2}MB webview={3}MB total={4}MB" -f $i, $startupMs, $mainMb, $wvMb, $totalMb)

    Get-Process opencharm-shell -ErrorAction SilentlyContinue | Stop-Process -Force
}

# 汇总
$avgStartup = [math]::Round(($results | Measure-Object StartupMs -Average).Average, 0)
$avgTotal = [math]::Round(($results | Measure-Object TotalMB -Average).Average, 0)
$avgMain = [math]::Round(($results | Measure-Object MainMB -Average).Average, 0)
$avgWv = [math]::Round(($results | Measure-Object WebViewMB -Average).Average, 0)

Write-Host ""
Write-Host ("=== 汇总（{0} 次平均）===" -f $Runs)
Write-Host ("冷启动: {0} ms（红线 < 1500 ms）" -f $avgStartup)
Write-Host ("内存: 主 {0} + WebView2 {1} = {2} MB（红线 <= 600 MB）" -f $avgMain, $avgWv, $avgTotal)

# 报告落盘
$reportDir = Join-Path $PSScriptRoot "reports"
New-Item -ItemType Directory -Force $reportDir | Out-Null
$date = Get-Date -Format "yyyyMMdd-HHmmss"

$rows = foreach ($r in $results) {
    ('| {0} | {1} | {2} | {3} | {4} |' -f $r.Run, $r.StartupMs, $r.MainMB, $r.WebViewMB, $r.TotalMB)
}
$startupVerdict = if ($avgStartup -lt 1500) { "PASS" } else { "FAIL" }
$memVerdict = if ($avgTotal -le 600) { "PASS" } else { "FAIL" }

$reportLines = @(
    "# bench 指标报告 $date",
    "",
    ('| 次数 | 冷启动 (ms) | 主进程 (MB) | WebView2 (MB) | 合计 (MB) |'),
    ('|---|---|---|---|---|')
)
$reportLines += $rows
$reportLines += @(
    ('| **平均** | **{0}** | **{1}** | **{2}** | **{3}** |' -f $avgStartup, $avgMain, $avgWv, $avgTotal),
    "",
    ("- 红线：冷启动 1500 ms 以内；内存 600 MB 以内（技术方案 v3 §1.1）"),
    ("- 判定：冷启动 {0}；内存 {1}" -f $startupVerdict, $memVerdict)
)
$report = $reportLines -join "`r`n"
$reportPath = Join-Path $reportDir "metrics-$date.md"
Set-Content -Path $reportPath -Value $report -Encoding UTF8
Write-Host "报告已写入: $reportPath"

# 红线纳入断言（tech-debt #7，供 CI 门禁复用）：任一红线破则非零退出
if ($startupVerdict -eq "FAIL" -or $memVerdict -eq "FAIL") {
    Write-Host "bench 红线未达标：冷启动 $startupVerdict / 内存 $memVerdict" -ForegroundColor Red
    exit 1
}
Write-Host "bench 红线达标：冷启动 PASS / 内存 PASS" -ForegroundColor Green
