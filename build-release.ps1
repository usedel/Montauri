# OpenCharm release packaging script (NSIS installer only).
# Runs the full pipeline: clean -> build opencharm-intel (release) -> npm install -> tauri build.
# Usage (from repo root):
#   powershell -File .\build-release.ps1                  # full build
#   powershell -File .\build-release.ps1 -SkipNpmInstall  # skip npm install
#
# Requires: Rust toolchain (cargo) and Node.js (npm), see ci/versions.toml for pinned versions.
# Note: uv / pyrefly are managed at user runtime, not needed for packaging.
#       opencharm-intel and probe/src are bundled via shell/src-tauri/tauri.conf.json
#       bundle.resources; step 2 builds the release intel binary first.
#       Bundle target is fixed to NSIS (tauri.conf.json bundle.targets = "nsis").

param(
    [switch]$SkipNpmInstall
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

# ---------- 0. prerequisites ----------
Step "Prerequisites (cargo / npm)"
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Fail "cargo not found. Install Rust toolchain (pinned 1.96.0 in ci/versions.toml)"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Fail "npm not found. Install Node.js (pinned 22.12.0 in ci/versions.toml)"
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
    cargo build -p opencharm-intel --release
    if ($LASTEXITCODE -ne 0) { Fail "opencharm-intel release build failed" }
} finally {
    Pop-Location
}

# ---------- 3. npm install (optional) ----------
if (-not $SkipNpmInstall) {
    Step "npm install (frontend deps)"
    Push-Location (Join-Path $Root "shell")
    try {
        npm install
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
    npm run tauri -- build
    if ($LASTEXITCODE -ne 0) { Fail "Tauri build failed" }
} finally {
    Pop-Location
}

# ---------- 5. done ----------
Step "Done"
Write-Host "Bundle output: shell/src-tauri/target/release/bundle/nsis/"
Write-Host "opencharm-intel.exe and probe/src are bundled as resources (see shell/src-tauri/tauri.conf.json bundle.resources)"