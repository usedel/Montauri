# v0.1.0 首次发版执行清单

> 性质：**对外分发的执行清单 + 可粘贴文案**，不是技术方案、不排期功能。与 `docs/python_ide_dev_plan_v2.md` 冲突时以开发计划为准。
> 版本真源：`shell/src-tauri/tauri.conf.json`、`shell/src-tauri/Cargo.toml`、`shell/package.json` 三处均为 `0.1.0` → tag 用 `v0.1.0`。
> 取数时点：2026-11-05，git HEAD `bdd6f531`。**引用任何数字前先核 HEAD**（口径见 §5 / `improvement_and_roadmap_report.md` §9）。
> 本清单只列命令与文案；**打 tag 与 push 由维护者显式确认后执行**，不在自动交付里做。

---

## 0. 发版前置：先确认 CI 宿主在哪一侧

这是当前最容易踩空的一条，发版前必须先回答：

- `.github/workflows/ci.yml` 的 `on.push.tags: ["v*"]` → `test`（4 矩阵 + 2 门禁）→ `package-smoke`（NSIS 打包 + bench 回归 + 上传 artifact）→ `softprops/action-gh-release@v2` 自动建 **GitHub Release** 并附上 exe，且 `generate_release_notes: true`。
- 但本地 `git remote -v` 的 `origin` 只有 `https://gitee.com/usedel/Montauri.git`；`improvement_and_roadmap_report.md` 把「Gitee + GitHub 双托管」仍登记为待复审，**「迁移到 GitHub 后首次 push 的 Actions run 记录」也仍是待外部事件**。
- ⇒ **只在 Gitee 侧打 tag，GitHub Actions 不会被触发，Release 不会自动出现**；反之，自动建出来的 Release 在 GitHub 侧，Gitee 的下载页仍为空。

按实际情况二选一（**不擅自假定已双托管**）：

| 情况 | 动作 |
|---|---|
| A · GitHub 侧已有可跑 Actions 的镜像 | tag 推到 GitHub 侧触发 §2 的自动链路；Gitee Release 需同步或手动上传同一 exe |
| B · 目前只有 Gitee | 走本地 `build-release.ps1 -Verify` 出包，手动在 Gitee Releases 建 `v0.1.0`、上传 exe、粘贴 §3 文案；CI 自动 Release 等双托管落地后再启用 |

两条路径都要求：**同一个 exe、同一份 sha256、同一份文案**，不要两侧各写一套。

---

## 1. 产物清单

| # | 产物 | 必须 | 来源 / 命令 | 验收 |
|---|---|---|---|---|
| 1 | NSIS 安装包 `Montauri_0.1.0_x64-setup.exe`（以实际文件名为准） | ✅ | CI artifact 或 `powershell -File .\build-release.ps1 -SkipNpmInstall -Verify`，产物在 `shell/src-tauri/target/release/bundle/nsis/` | 双击安装（currentUser，无需管理员）→ 开始菜单项存在 → 启动不报错 |
| 2 | sha256 校验和 | ✅ | `Get-FileHash .\Montauri_0.1.0_x64-setup.exe -Algorithm SHA256 \| Select-Object -ExpandProperty Hash` | 值写进 §3 文案与两侧 Release 正文，下载页可核对 |
| 3 | Release Notes | ✅ | 本文 §3（CI 的 `generate_release_notes: true` 是自动提交日志，**发版后需人工替换/编辑为 §3 文案**） | 两侧正文一致、无 §5 禁用表述 |
| 4 | 首屏静态图 `docs/assets/hero-dark.png` / `hero-light.png` | ✅ | `cd shell && node scripts/readme-assets.mjs`（已产出） | README 首屏渲染正常、深浅双主题 |
| 5 | 演示动图 `docs/assets/demo.gif` | ⭕ 首版可缺 | §4 分镜 + 外部录屏工具 | **缺时不放空 `<img>`**（破图比没图更糟）；≤ 3 MB |
| 6 | 版本号一致性 | ✅ | `tauri.conf.json` / `Cargo.toml` / `package.json` / tag 四处 | 全部 `0.1.0`；改任一处必须同步四处 |
| 7 | 随包资源齐备 | ✅ | `bundle.resources`：`montauri-intel.exe`、`probe/src/`、`vendor/debugpy/`（`tools/fetch-debugpy.ps1` 按 `ci/versions.toml` 的 sha256 拉取） | 安装包里能定位到三者；首次启动调试不需另装 debugpy |
| 8 | 发布前真机验收报告 | ✅ | `build-release.ps1 -Verify` → `shell/real-reports/<stamp>/SUMMARY.md`（release-real + 6 套，约 12 min，失败即非零退出） | 全绿；前置：5173 / 9223 空闲、http-divert-proxy 未运行、Python 3.13 可用 |
| 9 | 第三方许可声明 | ✅ | MIT（`LICENSE`）+ JetBrains Mono SIL OFL 1.1（`shell/public/fonts/OFL.txt`） | 安装包 / Release 正文可查 |

---

## 2. 发版步骤

1. **对齐版本**：核对 §1 第 6 项四处版本；不一致先修，不要靠 tag 名蒙混。
2. **口径复核**：按 §5 过一遍 README 首屏「为什么是它」与 §3 文案的数字、边界表述。
3. **生成本轮素材**：`cd shell && node scripts/readme-assets.mjs`（深浅两张 hero 图）；动图按 §4 录制（可缺）。
4. **本地全量门禁**：`npm run build` / `npm test` / `cargo test` / `node shell/scripts/budget-check.mjs --no-write` / `python tools/ui/audit_tokens.py`，全绿后再出包。
5. **出包 + 真机验收**：`powershell -File .\build-release.ps1 -SkipNpmInstall -Verify`；记录 `SUMMARY.md` 路径与结论。
6. **算 sha256**，填进 §3 文案。
7. **提交并确认宿主**：按 §0 选定 A/B；把 README / `docs/first_release.md` / `docs/assets/` / `shell/scripts/readme-assets.mjs` 一起提交。
8. **打 tag**：`git tag v0.1.0`，推送需维护者显式确认（A 路径推到跑 Actions 的一侧）。**严禁自动 push。**
9. **等 CI**：`test` → `package-smoke` → artifact → GitHub Release；确认 bench 红线通过（失败则不会建 Release）。B 路径跳过本步，手动在 Gitee 建 Release 并上传同一 exe。
10. **人工收尾**：把自动生成的 release notes 替换为 §3；填 sha256；Gitee 侧补齐（A 路径）；从 Releases 下载实测一遍（安装 → 启动 → 打开样例 → 运行 → 断点，参照 `shell/e2e-real/release-real.cjs` 的 7 项）。
11. **回填**：按 §6 更新 README 状态文案与交付记录。

---

## 3. Release Notes 文案（可直接粘贴）

```markdown
## Montauri v0.1.0

首个公开版本：面向「FastAPI + 爬虫 + 小脚本」开发者的高性能 · 轻量 Python IDE（Windows 10/11 x64）。

### 这个版本有什么

- **编辑**：Tauri 2 + Monaco，Pyrefly（默认）/ basedpyright（备选）提供补全 / 跳转 / Hover / 诊断；中英双语界面、深浅双主题
- **运行**：脚本 / 项目两种运行 + 统一 PTY 控制台，traceback 的 `File "...", line N` 点击跳转
- **调试**：debugpy 随包分发（版本锁 `ci/versions.toml`）+ 自研轻量 DAP 桥，断点 / 单步 / 调用栈 / 变量
- **测试**：侧栏 pytest 测试树，绿箭头逐用例运行 / 调试，失败一键跳转
- **差异化**：PEP 669 运行时采样 + `montauri-intel` 运行时 LSP，把「跑过的代码」观测到的类型喂给补全
- 另有 Git 集成 / 全局搜索 / SQLite 查看 / HTTP 工具 / Markdown 预览 / Live Templates，完整清单见 `docs/delivery-overview.md`

### 安装

1. 下载 `Montauri_0.1.0_x64-setup.exe`；
2. 双击安装（当前用户安装，无需管理员权限，自动创建开始菜单项）；
3. 首次启动自动检测 `uv` / `pyrefly`，缺失时由「环境引导」一键装到用户目录，不动系统环境。

### 系统要求

Windows 10 / 11 x64 + WebView2 Runtime（Win11 内置）。macOS / Linux 暂不支持。

### 本项目自测口径（不是跨产品对比）

- 运行时探针开销 **1.35x**（项目红线 < 1.5x，见 `docs/run_acceptance_record.md`）
- 运行时补全在**自有样例集**上 **23/23**（期望 label 进入 top-5，口径与撤项记录见 README「已知边界」）；**未与其他 IDE 做横向对比**
- 冷启动 < 1.5 s、空闲内存 ≤ 600 MB 为项目**验收红线**，数值真源 `docs/python_ide_dev_plan_v2.md` §1.2

### 已知限制

- 仅 Windows x64；**暂无自动更新通道**，新版本需重新下载安装
- 运行时补全依赖「先运行过代码」产生观测；Pydantic 构造校验是轻量文本解析，跨文件继承链 / 多行构造调用不覆盖
- 完整边界见 README「已知边界」

### 校验与反馈

- SHA256：`<发版前用 Get-FileHash 填入>`
- 开源许可：MIT；随包字体 JetBrains Mono 遵循 SIL OFL 1.1
- 问题与建议：Gitee Issues（安全漏洞请按 `SECURITY.md` 私密报告）
```

---

## 4. 首屏素材与演示分镜

**静态图（已落地）**：`shell/scripts/readme-assets.mjs` 复用 vite dev + `e2e/mocks/tauri-mock.js`，在临时工作区写一份 FastAPI + 爬虫样例，收起底部输出面板与无解释器 toast，产出干净的主界面图；`--theme dark|light` 可单出一套。README 首屏引用 `docs/assets/hero-dark.png`，浅色图以链接形式给出。

**动图（可选，首版可缺）**：目标 12–15 秒、≤ 3 MB，输出 `docs/assets/demo.gif`。录屏用系统外工具（ShareX / ScreenToGif / OBS 等）即可，**不往仓库引入录屏与转码依赖**（ADR-0010 默认轻量）。分镜：

| 镜头 | 时长 | 操作 | 期望画面 |
|---|---|---|---|
| 1 | 0–2 s | 打开演示工作区（`app.py` / `scraper.py` / `test_app.py`） | 文件树 + FastAPI 路由语法高亮 |
| 2 | 2–5 s | 点编辑器右上角 ▶ 运行脚本 | 统一 PTY 控制台出现输出 / traceback |
| 3 | 5–8 s | 点击输出里的 `File "...", line N` | 光标跳到对应源码行 |
| 4 | 8–11 s | 在 `fetch_rows` 调用处打断点，F5 | 停在断点，调用栈 / 变量面板有值 |
| 5 | 11–14 s | 在编辑器输入 `rows.` | 补全弹层出现带 `⟳ runtime` 标记的候选（需先跑过代码产出 trace 库） |

录制时关掉无解释器 toast 与底部无关输出；镜头 5 依赖真实运行过的 trace 库，**用真机录，不用 mock**。动图接进 README 时追加在 hero 图之后并附一行图注；缺失时保持现状，不要留空 `<img>`。

---

## 5. 对外口径纪律（发版前逐条打勾）

- [ ] **不写**「比 PyCharm 更准」「超越 VS Code」「业界最快」等跨产品对比；可写的只有「在自有样例集上 23/23」这类自证口径（`improvement_and_roadmap_report.md` §5 / §9，永久有效）
- [ ] 23/23 必须带「自有样例集 + top-5 定义 + 未横向对比」；1.35x / < 1.5 s / ≤ 600 MB 必须带「本项目 harness / 验收红线」与真源链接
- [ ] 性能与体积数字引用前核 HEAD 与 bench 报告时点；预算数字会随 `dist/` 漂移
- [ ] **不写**未交付能力：跨平台 / 插件市场 / AI / 自动更新（TD-025 第 2 条待复审）
- [ ] 明确「仅 Windows 10/11 x64 + WebView2」「首启需环境引导装 uv / pyrefly」
- [ ] 发布文案与 README 首屏、§3 文案三者表述一致；两侧 Release 正文一致

---

## 6. 发版后回填

1. README 的「首发状态」段替换为「`v0.1.0` 已发布：[下载安装包](<Release 链接>)」，并去掉「快速开始」方式①里的「tag 尚未打出」。
2. 把 `shell/real-reports/<stamp>/SUMMARY.md` 的结论与 CI run 链接登记到 `docs/delivery-overview.md`（或按文档约定新建验收记录）。
3. `improvement_and_roadmap_report.md` 里「CI 首次跑通证据 / TD-025 复审」两条待外部事件按实际情况更新状态。
4. 复核 §0 的双托管结论：若 GitHub 镜像已落地，后续版本切回 CI 自动 Release，不再手工上传。
