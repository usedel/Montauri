<#
.SYNOPSIS
  真机 CDP 验收「一键全量跑批」+ 汇总报告（nightly 编排同款清单的本机入口；发布前验收走 build-release.ps1 -Verify）。

.DESCRIPTION
  13 个真机脚本逐个串行跑（串行是必须的：它们共用 vite 5173 与 CDP 9223，并发必撞），
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
  "multi-window-real", "new-project-fastapi-real", "long-op-real", "probe-real-lag",
  "probe-mw-lag", "probe-watch-multiwin", "ui-real", "pytest-real"
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
# 包装层异常（≠ 套件断言失败）：记录后继续下一套，绝不因此丢掉整轮报告
$wrapperErr = @{}

# node 可执行文件（ProcessStartInfo 不解析 PATH 里的 .cmd/shim，故先解析一次）
$NodeExe = $null
try { $NodeExe = (Get-Command node -ErrorAction Stop).Source } catch { $NodeExe = $null }

# —— 刻意**不**切控制台代码页 ——
# 曾经的乱码根因是「node 输出经过 PowerShell」：PS 用 `[Console]::OutputEncoding`（本机 936）
# 去解码 node 的 UTF-8 字节 → 全变 `鏁版嵁`。而 Invoke-RealSuite 改成继承控制台句柄后，
# node 的 stdout 是真 TTY，**libuv 在 Windows 上对 TTY 走 `WriteConsoleW`（宽字符 API）**，
# 与代码页无关地正确显示——所以乱码已被"绕开 PS"这一步根治。
# 反过来，再叠加 `chcp 65001` + `Console.OutputEncoding=UTF8` 会让 **PS 自身**的表头/汇总行
# 在真实终端里出现 CJK 双写（`汇汇总总`、`（（39 项项`，ASCII 不受影响）。故一律不切。
# 副作用（已知、可接受）：把整轮输出重定向到文件时，node 侧是非 TTY → 写 UTF-8 字节，
# 而 PS 侧写 936 字节 → 同一文件两种编码。看结论请以 SUMMARY.md（始终 UTF-8）为准。

# 发布前验收：release-real 默认优先取注册表安装位，会**默默验到机器上遗留的旧安装**
# （2026-10-07 实测：本机 D:\OpenCharm 躺着 10-04 的旧包，用户 18:29 刚构建的产物根本没被验到）。
# -PreRelease 的语义是「我刚构建出来的包能不能干活」，故显式把 OC_RELEASE_EXE 指向构建产物。
$buildExe = Join-Path $ShellDir "src-tauri\target\release\opencharm-shell.exe"
if ($PreRelease) {
  if (Test-Path $buildExe) {
    $env:OC_RELEASE_EXE = $buildExe
    Write-Host " release-real 目标：构建产物 $buildExe" -ForegroundColor DarkCyan
  } else {
    Write-Host "⚠ 未找到构建产物 $buildExe —— release-real 将回落到注册表安装位（可能不是刚构建的包）" -ForegroundColor Yellow
  }
}

# 跑一个套件：**把 node 的字节直接交给控制台**，不让 PowerShell 的格式化器经手。
#
# 为什么不能用 `& node ... | ForEach-Object {...}`（2026-10-07 用户终端两次踩坑）：
# PowerShell 的格式化器会对**每一行**做折行/显示宽度计算，遇到「长行 + 全角字符」时抛
# `IndexOutOfRangeException`（"索引超出了数组界限"），且是**终止性异常**——局部
# EAP=Continue 拦不住，整轮跑批当场退出、不写 SUMMARY。实测先后打死两条路径：
#   ① `... | Write-Host`（WriteHostCommand）
#   ② 默认输出格式化（out-lineoutput）——把 Write-Host 去掉后它接着炸，证明根因在
#      「输出经过 PowerShell」这件事本身，而不是某个 cmdlet。
# 改为 `ProcessStartInfo` + `RedirectStandard*=false`：子进程**继承控制台句柄**，
# 字节直达控制台。收益是三重的：没有格式化折行、没有 stderr→ErrorRecord 包装
# （原生 stderr 陷阱一并消失）、没有中间缓冲（仍是实时流式）。
# 代价：输出不再经过 PowerShell 管道，外层 `| Tee-Object` 抓不到（要看输出请直接看控制台）。
function Invoke-RealSuite([string]$scriptPath) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    if ($NodeExe -and $NodeExe -like '*.exe') {
        $psi.FileName = $NodeExe
        $psi.Arguments = '"' + $scriptPath + '"'
    } else {
        # node 是 .cmd / 无扩展名 shim（如某些托管运行时）→ 交给 cmd 解析
        $psi.FileName = 'cmd.exe'
        $psi.Arguments = '/c node "' + $scriptPath + '"'
    }
    $psi.WorkingDirectory = $ShellDir
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $false
    $psi.RedirectStandardError = $false
    $proc = [System.Diagnostics.Process]::Start($psi)
    $proc.WaitForExit()
    return $proc.ExitCode
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
    $code = Invoke-RealSuite $cjs
  } catch {
    # 兜底：包装层自身出错（控制台/宿主异常等）也只损失这一套，报告照出
    $code = 1
    $wrapperErr[$s] = $_.Exception.Message
    Write-Host ">>> $s 包装层异常（已记录并继续）：$($_.Exception.Message)" -ForegroundColor Red
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
  $wErr = if ($wrapperErr.ContainsKey($s)) { "包装层异常：$($wrapperErr[$s])" } else { $null }
  if (-not (Test-Path $j)) {
    $verdict = if ($missing -contains $s) { "跳过（脚本不存在）" }
      elseif ($wErr) { $wErr }
      else { "无报告（未启动？）" }
    $rows += "| $s | — | — | — | — | $verdict |"
    continue
  }
  $data = Get-Content $j -Raw -Encoding UTF8 | ConvertFrom-Json
  $totalCases += $data.total
  $totalFailed += $data.failed
  $verdict = if ($wErr) { $wErr }
    elseif ($data.ok) { "PASS" }
    elseif ($data.error) { "ENV（$($data.error)）" }
    else { "FAIL" }
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
  "- 跑批：``shell/e2e-real/run-real-all.ps1``（套件清单与 ``.github/workflows/nightly.yml`` 同源；nightly 按 run_real 语义不含 release-real / long-op-real）",
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
