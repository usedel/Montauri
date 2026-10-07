# OpenCharm release packaging script (NSIS installer only).
# Runs the full pipeline: clean -> build opencharm-intel (release) -> npm install -> tauri build.
# Usage (from repo root):
#   powershell -File .\build-release.ps1                  # full build
#   powershell -File .\build-release.ps1 -SkipNpmInstall  # skip npm install
#   powershell -File .\build-release.ps1 -Verify          # build + 发布前真机验收（推荐发布时用）
#
# -Verify 会在打包完成后跑 `shell/e2e-real/run-real-all.ps1 -PreRelease -Strict`：
#   release-real（验构建产物）+ 开发链路 6 套，约 12 分钟，任一套失败即非零退出。
#   这是真机层唯一有明确触发点的入口——nightly 无 CI 宿主（远端只有 Gitee），
#   光靠"配置已编排"等于没跑（P1-4 结论：脚本存在 ≠ 覆盖存在）。
#   前置：5173 / 9223 空闲；http-divert-proxy 未运行；D:\py\python.exe 存在（或设 OC_REAL_PYTHON）。
#
# Requires: Rust toolchain (cargo) and Node.js (npm), see ci/versions.toml for pinned versions.
# Note: uv / pyrefly are managed at user runtime, not needed for packaging.
#       opencharm-intel and probe/src are bundled via shell/src-tauri/tauri.conf.json
#       bundle.resources; step 2 builds the release intel binary first.
#       Bundle target is fixed to NSIS (tauri.conf.json bundle.targets = "nsis").

param(
    [switch]$SkipNpmInstall,
    [switch]$Verify
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

function Step([string]$msg) {
    Write-Host ""
    Write-Host ("==> " + $msg) -ForegroundColor Cyan
}

function Fail([string]$msg) {
    Write-Host ("ERROR: " + $msg) -ForegroundColor Red
    exit 1
}

# Run a native command without letting its *stderr output* abort the script.
# PowerShell + `$ErrorActionPreference = "Stop"` turns ANY stderr write from a native
# command into a terminating NativeCommandError -- and cargo/npm routinely write
# progress lines ("Finished release profile ...") to stderr, which killed the build
# after ~5s with a bogus failure. Merging stderr into the output stream avoids that;
# $LASTEXITCODE of the native command is still preserved for the caller to check.
function Invoke-Native {
    # Local override: a native command's stderr must not be fatal here (see note above).
    $ErrorActionPreference = "Continue"
    $cmd = $args[0]
    $rest = @()
    if ($args.Count -gt 1) { $rest = $args[1..($args.Count - 1)] }
    # ErrorRecords (from the merged stderr stream) are rendered with the noisy
    # "cmd.exe : ... + CategoryInfo ..." formatting; keep just the message line.
    $text = (& $cmd @rest 2>&1 | ForEach-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { $_ }
    } | Out-String).TrimEnd()
    if ($text) { Write-Host $text }
}

# ---------- 0. prerequisites ----------
Step "Prerequisites (cargo / npm)"
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Fail "cargo not found. Install Rust toolchain (pinned 1.96.0 in ci/versions.toml)"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Fail "npm not found. Install Node.js (pinned 22.12.0 in ci/versions.toml)"
}

# ---------- 0.5 MSVC build environment (link.exe + Windows SDK libs) ----------
# Must happen before any cargo/tauri invocation: tauri CLI overrides rustc's MSVC
# probing, so the *process* environment decides which link.exe and which SDK libs get
# used. See tools/msvc-env.ps1 header for the full backstory (LNK2019 __imp_memchr...).
Step "MSVC build environment (vswhere -> link.exe + SDK libs)"
try {
    . (Join-Path $Root "tools\msvc-env.ps1")
    Import-MsvcEnv
} catch {
    Fail ("MSVC env setup failed: " + $_.Exception.Message)
}

# ---------- 1. clean python caches ----------
Step "Clean __pycache__ under probe/"
$pycache = Get-ChildItem -Path (Join-Path $Root "probe") -Recurse -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue
if ($pycache) {
    $pycache | Remove-Item -Recurse -Force
    Write-Host ("Removed {0} __pycache__ dir(s)" -f @($pycache).Count)
} else {
    Write-Host "No __pycache__ dirs, skip"
}

# ---------- 2. build opencharm-intel (release) ----------
Step "Build opencharm-intel (release, lto, may take a while)"
Push-Location (Join-Path $Root "intel")
try {
    Invoke-Native cargo build -p opencharm-intel --release
    if ($LASTEXITCODE -ne 0) { Fail "opencharm-intel release build failed" }
} finally {
    Pop-Location
}

# ---------- 2.5 fetch vendored debugpy (sha256-pinned, idempotent) ----------
Step "Fetch vendored debugpy (cp310-cp314 win_amd64, pinned in ci/versions.toml)"
Invoke-Native (Join-Path $Root "tools\fetch-debugpy.ps1")
if ($LASTEXITCODE -ne 0) { Fail "fetch-debugpy.ps1 failed" }

# ---------- 3. npm install (optional) ----------
if (-not $SkipNpmInstall) {
    Step "npm install (frontend deps)"
    Push-Location (Join-Path $Root "shell")
    try {
        Invoke-Native npm install
        if ($LASTEXITCODE -ne 0) { Fail "npm install failed" }
    } finally {
        Pop-Location
    }
} else {
    Write-Host ""
    Write-Host "==> skip npm install (-SkipNpmInstall)" -ForegroundColor DarkGray
}

# ---------- 4. tauri build (NSIS only) ----------
Step "Tauri build (nsis)"
Push-Location (Join-Path $Root "shell")
try {
    Invoke-Native npm run tauri -- build
    if ($LASTEXITCODE -ne 0) { Fail "Tauri build failed" }
} finally {
    Pop-Location
}

# ---------- 5. pre-release real E2E verification (opt-in) ----------
# 发布前验收：release-real（验刚产出的 exe）+ 开发链路套件。失败即非零退出（-Strict）。
if ($Verify) {
    Step "Pre-release real E2E (shell/e2e-real/run-real-all.ps1 -PreRelease -Strict)"
    $realAll = Join-Path $Root "shell\e2e-real\run-real-all.ps1"
    if (-not (Test-Path $realAll)) { Fail "run-real-all.ps1 not found: $realAll" }
    # 用独立 powershell 进程跑：run-real-all.ps1 会逐套件起 node/tauri dev，需要干净的
    # $LASTEXITCODE 语义；本脚本的 $ErrorActionPreference=Stop 不适用于子脚本。
    Invoke-Native powershell -NoProfile -ExecutionPolicy Bypass -File $realAll -PreRelease -Strict
    if ($LASTEXITCODE -ne 0) {
        Fail "Pre-release real E2E failed (see shell/real-reports/<stamp>/SUMMARY.md)"
    }
} else {
    Write-Host ""
    Write-Host "==> 跳过发布前真机验收（未加 -Verify）" -ForegroundColor Yellow
    Write-Host "    发布前请跑：powershell -File .\build-release.ps1 -Verify" -ForegroundColor Yellow
    Write-Host "    （release-real + 6 套开发链路，约 12 分钟；真机层唯一有触发点的入口）" -ForegroundColor DarkGray
}

# ---------- 6. done ----------
Step "Done"
Write-Host "Bundle output: shell/src-tauri/target/release/bundle/nsis/"
Write-Host "opencharm-intel.exe and probe/src are bundled as resources (see shell/src-tauri/tauri.conf.json bundle.resources)"