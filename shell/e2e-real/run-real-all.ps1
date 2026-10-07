<#
.SYNOPSIS
  真机 CDP 验收「一键全量跑批」+ 汇总报告（improvement_and_roadmap_report.md §2 P0-1 子项 2/3 的本机入口）。

.DESCRIPTION
  9 个真机脚本逐个串行跑（串行是必须的：它们共用 vite 5173 与 CDP 9223，并发必撞），
  每个脚本通过 OC_JSON_OUT 落一份 JSON 汇总（schema 见 lib/real-env.cjs），最后合并成一份 Markdown 报告。

  这是 nightly.yml 的**本机同款实现**——nightly 跑的是同一份脚本清单，因此本机报告与
  CI nightly 产物 schema 一致，可直接跨次对比。

  失败语义与 nightly 一致：**只汇总、不阻断**（除非 -Strict）。

.EXAMPLE
  powershell -File shell/e2e-real/run-real-all.ps1
.EXAMPLE
  powershell -File shell/e2e-real/run-real-all.ps1 -Only db-real -CdpTimeoutSec 1800
.EXAMPLE
  # 发布前验收（含 release-real：验构建产物 / 安装包，失败即非零退出）
  powershell -File shell/e2e-real/run-real-all.ps1 -PreRelease -Strict
#>
param(
  [string]$Only = "",
  [string]$Skip = "release-real,probe-real-lag,probe-mw-lag,probe-watch-multiwin",
  [int]$CdpTimeoutSec = 1500,
  [switch]$Strict,
  # 发布前验收模式：把 release-real（验构建产物）纳入本次跑批。
  # 日常跑批默认跳过它——开发检出里往往没有 release 产物，跑了只会报 ENV。
  [switch]$PreRelease,
  [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
$RealDir = $PSScriptRoot
$ShellDir = (Resolve-Path (Join-Path $RealDir "..")).Path

# —— 套件清单（nightly.yml 的 $scripts 与此保持一致）——
# release-real 排在首位：发布前验收先验**构建产物本身**，再验开发链路。
$All = @(
  "release-real", "db-real", "debug-real", "endpoints-real", "http-real",
  "multi-window-real", "new-project-fastapi-real", "probe-real-lag",
  "probe-mw-lag", "probe-watch-multiwin", "ui-real"
)

if ($PreRelease) { $Skip = "probe-real-lag,probe-mw-lag,probe-watch-multiwin" }

if ($Only) {
  $want = @($Only.Split(",") | ForEach-Object { $_.Trim().Replace(".cjs", "") } | Where-Object { $_ })
  $Scripts = @($All | Where-Object { $want -contains $_ })
} else {
  $skipList = @()
  if ($Skip) { $skipList = @($Skip.Split(",") | ForEach-Object { $_.Trim().Replace(".cjs", "") } | Where-Object { $_ }) }
  $Scripts = @($All | Where-Object { $skipList -notcontains $_ })
}

if ($Scripts.Count -eq 0) { Write-Host "没有选中任何套件（-Only / -Skip 拼写是否有误？）" -ForegroundColor Red; exit 2 }

if (-not $OutDir) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $OutDir = Join-Path $ShellDir "real-reports\$stamp"
}
New-Item -ItemType Directory -Force $OutDir | Out-Null

$Mode = if ($PreRelease) { "发布前验收（含 release-real）" } else { "日常真机跑批" }
Write-Host "=========================================================="
Write-Host " 真机全量验收  共 $($Scripts.Count) 个套件"
Write-Host " 模式：$Mode"
Write-Host " 清单：$($Scripts -join ', ')"
Write-Host " 报告：$OutDir"
Write-Host " CDP 超时：${CdpTimeoutSec}s   严格模式：$Strict"
Write-Host "=========================================================="

# 预检：http-divert-proxy 在跑会让本地浏览器自动化直接挂（net::ERR_PROXY_CONNECTION_FAILED）。
# 它走 WinDivert **驱动层透明拦截**，改环境变量 / --no-proxy-server 都躲不掉，根治只有关掉它。
# 判据（见 .workbuddy-ai/MEMORY.md）：25378(PAC) / 18080(本地监听) / 8888(上游 Fiddler) 是否有监听。
$divertHit = @()
foreach ($dp in @(25378, 18080, 8888)) {
  $c = Get-NetTCPConnection -LocalPort $dp -State Listen -ErrorAction SilentlyContinue
  if ($c) { $divertHit += $dp }
}
if ($divertHit.Count -gt 0) {
  Write-Host "⚠ 疑似 http-divert-proxy 在运行（监听 $($divertHit -join ' / ')）：本地浏览器自动化会 ERR_PROXY_CONNECTION_FAILED。" -ForegroundColor Yellow
  Write-Host "  它走驱动层拦截，环境变量与 --no-proxy-server 都无效——请先关掉再跑，否则整套会全红。" -ForegroundColor Yellow
}

# 预检：端口被占用直接停（否则每个脚本都会各自 exit 2，白等一轮编译）
foreach ($port in @(5173, 9223)) {
  $busy = Test-NetConnection -ComputerName 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
  if ($busy) {
    Write-Host "端口 $port 已被占用。请先停掉 tauri dev / 上一次真机会话（真机脚本共用这两个端口，必须串行）。" -ForegroundColor Red
    exit 2
  }
}

$env:OC_CDP_TIMEOUT = "$CdpTimeoutSec"
$fail = 0
$missing = @()

# 跑一个套件，且**不让它的 stderr 中断整轮跑批**。
#
# 为什么需要这个包装（与 build-release.ps1 的 Invoke-Native 同源、同一个坑）：
# PowerShell 5.1 会把 native 命令写到 stderr 的内容包成 NativeCommandError；本脚本顶部
# `$ErrorActionPreference = "Stop"`，于是**任一真机脚本往 stderr 写一行**（真机脚本在
# 失败/中断路径上必然 console.error）就会终止整个 run-real-all —— 表现为「跑到一半
# 整脚本退出、不写 SUMMARY」，最坏情况是外层管道捕获（`... | Tee-Object`）时必现。
# 2026-10-07 实测：db-real 中断 → stderr → 跑批在第 2 套件直接退出，前 1 套件的结论丢失。
# 局部把 EAP 降为 Continue，并把 ErrorRecord 渲染成纯文本（否则会带 "cmd : ... + CategoryInfo" 噪声）。
function Invoke-RealSuite([string]$scriptPath) {
    $ErrorActionPreference = "Continue"
    & node $scriptPath 2>&1 | ForEach-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { $_ }
    } | Write-Host
}

foreach ($s in $Scripts) {
  $cjs = Join-Path $RealDir "$s.cjs"
  if (-not (Test-Path $cjs)) { $missing += $s; continue }
  Write-Host ""
  Write-Host "########## $s ##########"
  $env:OC_JSON_OUT = Join-Path $OutDir "$s.json"
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  Push-Location $ShellDir
  try {
    Invoke-RealSuite $cjs
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  $sw.Stop()
  $el = [int]$sw.Elapsed.TotalSeconds
  if ($code -ne 0) { $fail++; Write-Host ">>> $s 退出码 $code（${el}s）" -ForegroundColor Yellow }
  else { Write-Host ">>> $s 通过（${el}s）" -ForegroundColor DarkGreen }
  Remove-Item Env:\OC_JSON_OUT -ErrorAction SilentlyContinue
}

# —— 合并汇总 ——
$rows = @("| 套件 | 通过 | 失败 | 总数 | 用时 | 结论 |", "|---|---|---|---|---|---|")
$totalCases = 0
$totalFailed = 0
foreach ($s in $Scripts) {
  $j = Join-Path $OutDir "$s.json"
  if (-not (Test-Path $j)) {
    $verdict = if ($missing -contains $s) { "跳过（脚本不存在）" } else { "无报告（未启动？）" }
    $rows += "| $s | — | — | — | — | $verdict |"
    continue
  }
  $data = Get-Content $j -Raw -Encoding UTF8 | ConvertFrom-Json
  $totalCases += $data.total
  $totalFailed += $data.failed
  $verdict = if ($data.ok) { "PASS" } elseif ($data.error) { "ENV（$($data.error)）" } else { "FAIL" }
  $dur = if ($data.durationMs) { "$([int]($data.durationMs / 1000))s" } else { "—" }
  $rows += "| $s | $($data.total - $data.failed) | $($data.failed) | $($data.total) | $dur | $verdict |"
}
$rows += "| **合计** | **$($totalCases - $totalFailed)** | **$totalFailed** | **$totalCases** | — | — |"

$head = (git -C $ShellDir rev-parse --short HEAD 2>$null)
$report = @(
  "# 真机验收汇总 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
  "",
  "- HEAD：``$head``",
  "- 模式：$Mode",
  "- 跑批：``shell/e2e-real/run-real-all.ps1``（套件清单与 ``.github/workflows/nightly.yml`` 一致）",
  "- 判定：失败 $fail 个套件；用例 $totalCases 项 / 失败 $totalFailed 项",
  "",
  ($rows -join "`r`n"),
  "",
  "> 逐项明细见同目录各 ``<suite>.json`` 的 ``cases`` 数组（含每项 detail）。",
  "> 端口 5173 / 9223 为真机脚本共用，**必须串行**；``ENV`` = 环境未就绪（预检未通过 / tauri dev 启动失败），**不是断言回归**——先看 error 字段再谈修代码。"
)
$reportPath = Join-Path $OutDir "SUMMARY.md"
$report | Set-Content $reportPath -Encoding UTF8

Write-Host ""
Write-Host "=========================================================="
Write-Host " 汇总：$($Scripts.Count) 套件 / $totalCases 项 / 失败 $totalFailed 项 / 套件失败 $fail"
Write-Host " 报告：$reportPath"
Write-Host "=========================================================="

if ($Strict -and $fail -gt 0) { exit 1 }
exit 0
