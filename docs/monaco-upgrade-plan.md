# Monaco Editor 0.52.2 → 0.57.0 升级计划

- **日期**：2026-10-16（调研与撰写）
- **状态**：待执行（用户已批准，本文件即执行蓝本）
- **当前版本**：`monaco-editor@0.52.2`（精确锁定）+ `patches/monaco-editor+0.52.2.patch`（TD-029 vendor 修复）
- **目标版本**：`monaco-editor@0.57.0`

---

## 1. 背景与动机

- 0.52.2（2025-02）落后 0.57.0 **5 个 minor、约 20 个月**，跨 VS Code 内核同步 0.53→0.57 全部修复（hover/suggest/decorations 稳定性、性能、安全更新如 DOMPurify 3.4.15）。
- TD-029（悬停闪现）已实证**升级不解决该问题**（`_installLinkGesture`/`_updateHintsDecorators`/`_getInlineHintsForRange` 在 0.57.0 逐行相同）——升级动机是**滞纳成本控制**：越晚升跨度越大，0.58+ 只会更痛。
- 我们的 vendor patch 与 heal 探针在 0.52.2 上已稳定，本次升级必须**平移**它们而不是放弃。

## 2. 版本差异调研结论（0.53 → 0.57）

| 版本 | 上游变更 | 对本项目影响 |
|---|---|---|
| 0.53.0 | AMD 构建废弃；Next Edit Suggestion；Edit Context | 无（我们已是纯 ESM + Vite） |
| 0.54.0 | `mouseMiddleClickAction` 选项 | 无（未使用） |
| 0.55.0 | 嵌套命名空间迁移（`languages.css`→`css` 等）；原生 LSP client API | 无（不用 css/html 语言 worker；我们自有 LSP 客户端） |
| **0.56.0** | **ESM 模块重组**：新增官方 tree-shakeable 入口（`esm/vs/features/*`、`esm/vs/languages/definitions/*/register.js`）；**`basic-languages` 目录整体迁移**；`stackOridinal`→`stackOrdinal`；移除废弃 worker API 类型；Markdown 视为不受信（安全） | **核心影响**：见 §3-1 |
| 0.57.0 | `wordWrapIndicator`、`fullwidthCharacterWidth`、`languages.score`；DOMPurify 3.4.15 | 无（未使用新 API，安全更新免费获得） |

### 2.1 已实证的包结构变化（0.57.0 实测，非推断；复核修订版）

**⚠️ 复核重大修正（2026-10-16）**：0.57.0 的 `package.json` 新增了 `exports` 字段（`"./*": "./esm/vs/*.js"`）。**所有旧式深路径 import（`monaco-editor/esm/vs/X`）会被 exports 重映射到 `esm/vs/esm/vs/X.js`（不存在）而解析失败**——沙盒实测 Node ESM、CJS、**vite@6.4.4 build 三种解析器全部拦截**（Rollup: failed to resolve import）。这是比 basic-languages 迁移更大的硬破坏：**我们的 41 条深路径 import（1 条 editor.api + 24 条 contrib + 16 条语言 + worker）全部不可达**，与文件是否存在无关。

**解法（沙盒实测通过）**：`vite.config.ts` 加一条 alias，把深路径重定向到实际文件（绕开 exports）。主项目是 ESM 配置且已有 `root`（realpath 规范化，Windows 盘符大小写纪律），直接复用：

```ts
// vite.config.ts 顶部已有：const root = realpathSync.native(process.cwd());
resolve: {
  alias: [{
    // monaco 0.57 exports 字段拦截深路径（"./*" 重映射致 esm/vs/esm/vs/*），
    // alias 直连实际文件绕开；详见 docs/monaco-upgrade-plan.md §2.1
    find: /^monaco-editor\/esm\/vs\/(.*)$/,
    replacement: join(root, "node_modules/monaco-editor/esm/vs/$1"),
  }],
},
```

- 沙盒实测：alias + 旧深路径 import 原样保留 → vite build 成功，产物 2.88MB（对照 `monaco-editor/editor` 聚合入口方案 3.25MB——聚合入口会拉入全部功能，**丢掉按需裁剪优势，否决**）；
- alias 方案改动最小（`monaco.ts`/`jsonLiteral.ts`/`inlineMenu.ts` 的 import 语句**全部不动**），但注意：
  - `?worker` 后缀导入（`editor.worker?worker`）经 alias 后仍需验证 worker 构建链（沙盒未覆盖，列入阶段 1 验证项）；
  - vitest 走 vite resolver，同样受益于 alias，但 happy-dom 测试不 import 真实 monaco（全 fake），无实际影响；
  - `manualChunks` 规则匹配 `node_modules/monaco-editor/` 路径形态——alias 重写后模块 id 仍含 `node_modules/monaco-editor/`（replacement 指向该目录），规则继续生效（阶段 4 核对 chunk 数验证）。

**文件存在性（alias 方案下才有意义）**：
- ✅ `esm/vs/editor/editor.api.js|.d.ts`、`editor.worker.js`、`contrib/**`（24 条）、`standaloneServices.js`、`platform/{contextkey,actions,commands}/**`、`languageConfigurationRegistry.js`、`indentRangeProvider.js`——**全部健在**
- ❌ `esm/vs/basic-languages/**`——**整体迁移**至 `esm/vs/languages/definitions/<lang>/`（16 个语言目录全量核实存在，84 目录总）：
  - contribution 文件改名：`*.contribution.js` → `register.js`（内容仍是 `registerLanguage({id, loader})`）
  - python 词法文件：`esm/vs/basic-languages/python/python.js` → `esm/vs/languages/definitions/python/python.js`；**导出形状已核实不变**：`export { conf, language }`（与 0.52.2 相同），`monaco.ts:80` 的具名 import 与 `monaco-python.d.ts` 声明只需改路径
- ✅ TD-029 patch 目标 `contrib/inlayHints/browser/inlayHintsController.js`——文件健在，`_installLinkGesture` 代码与 0.52.2 逐行相同 → **patch 可平移**（hunk 行号需重算）
- ✅ heal 探针符号 `_inlayHintsCache`/`_decorationsMetadata`/`_updateHintsDecorators`——健在（构造器签名微调不影响探针）

**遗留待验证（升级时现场确认）**：patch-package 在 0.57.0 上的 diff/apply 是否受 exports 影响（patch 走文件系统不走 exports，理论无影响，阶段 3 首步验证）。

## 3. 风险清单（基于全仓 API 盘点，按风险分级）

### 3.1 必改项（升级阻塞，安装/编译期即失败）

| # | 项 | 文件 | 改法 |
|---|---|---|---|
| M0 | **exports 字段拦截全部深路径 import**（复核新发现，比 M2/M3 更基础） | `shell/vite.config.ts` | 加 alias 规则：`/^monaco-editor\/esm\/vs\/(.*)$/ → node_modules/monaco-editor/esm/vs/$1`（沙盒实测 vite@6 构建通过；`monaco.ts`/`jsonLiteral.ts`/`inlineMenu.ts` 全部 import 语句不动） |
| M1 | postinstall patch 失配 | `shell/package.json` + `patches/` | 升级前先删 `patches/monaco-editor+0.52.2.patch`（或临时注释 postinstall），装完 0.57.0 后重做 patch（§4 步骤 4） |
| M2 | 16 条 basic-languages contribution 导入路径 | `shell/src/monaco.ts:51-69` | `esm/vs/basic-languages/<l>/<l>.contribution.js` → `esm/vs/languages/definitions/<l>/register.js`（16 语言目录已全量确认存在） |
| M3 | python 词法深导入 | `shell/src/monaco.ts:80` + `shell/src/monaco-python.d.ts` | 改 `esm/vs/languages/definitions/python/python.js`；导出形状已核实不变（`export { conf, language }`），d.ts 声明同步改路径 |

### 3.2 高风险（静默失败类，必须定向回归）

| # | 项 | 位置 | 回归手段 |
|---|---|---|---|
| H1 | heal 探针私有符号链 | `lsp/inlayHeal.ts`（getContribution ID、`_inlayHintsCache._entries` key 格式、`_decorationsMetadata`、`description==="InlayHint"`） | 真机：inlay 三症状回归（重复/累积/悬停闪现）+ 一次 heal 触发后 dump `dead===0` |
| H2 | vendor patch 平移 | `patches/*` | 重做后跑 TD-029 用户路径（回车→Ctrl+S→悬停 ×2 轮逐帧采样恒单份） |
| H3 | 主题颜色槽位表 | `theme/tokens.ts:86-149`（60+ 槽位） | 真机肉眼：编辑器/弹窗/suggest/gutter/滚动条/括号着色逐项过一遍；未注册槽位静默丢弃，重点核对 0.52 就没有的槽位是否在 0.57 出现（`*.borderRadius`、`editorGutter.foreground`——出现则可启用） |
| H4 | toMonacoHexColor 解析行为 | `theme/tokens.ts:184-277` | 真机：主题色是否仍正确（0.57 若改进 CSS 颜色解析，我们的归一化层变冗余但不冲突） |
| H5 | e2e 内部选择器 | `.view-line`/`.glyph-margin`/`.sticky-widget`/`.squiggly-*`/`.suggest-widget`/`.ghost-text-decoration`/`.monaco-hover` | 全量 e2e（93 spec）跑通即覆盖；失败项按 spec 名定位 |
| H6 | KeyCode 反射查表 + 命令 id 字符串 | `keybindings.ts:284-340`（`monaco.KeyCode[name]` 动态取值；`editor.action.*` 命令族） | e2e keybindings spec + 手动冒烟（每个自定义键位按一遍）；KeyCode 枚举名变化会**静默 null**，需在控制台逐个断言非空 |
| H7 | `showIfCollapsed` 注入文本过滤 | `inlineValues.ts:91`/`inlineDiagnostics.ts:154` | e2e dx/17（squiggle render）+ 调试器内联值真机验证 |
| H8 | IndentRangeProvider 构造签名 | `jsonLiteral.ts:10` | e2e json 相关 spec（JSON 折叠功能） |
| H9 | inlineMenu MenuRegistry 行为 | `extensions/inlineMenu.ts`（`new MenuId()` 私有构造 + contextmenu 递归展开） | 真机：编辑器右键菜单逐项点验 |

### 3.3 中风险（有测试覆盖，跑门禁即暴露）

- editor options 面改名/语义变（`suggest.selectionMode`/`guides.*`）——vitest + e2e 覆盖
- `deltaDecorations` 旧 API（renameWidget/inlayHeal）——已 deprecated 多年未删，风险低
- `setModel(null)` 先复位后 dispose 契约（clipboardDiff）——e2e git/diff spec 覆盖
- 单 worker `getWorker`（0.53+ 若新功能要更多 worker 会报错而非静默）——build + 冒烟
- vite `manualChunks` monaco 路径匹配——build 后核对 chunk 数量与体积（防 1.4MB 双 chunk 回归）
- vitest fake 里的硬编码枚举值（MouseTargetType=2/3/6、MarkerSeverity=8/4/2/1）——这些数值 0.57 未变（已验 d.ts），不主动改

### 3.4 无风险（纯公开稳定 API，盘点确认 61 个类型消费者）

register*Provider 全家族、markers 四桶、create/createDiffEditor/createModel、KeyMod/公开 KeyCode、IModelDecorationOptions 公开字段。

## 4. 执行步骤

### 阶段 0：基线固化（升级前，~10 min）
1. `git status` 干净确认；记录基线：`npm run build` 产物体积、`npm test` 1537 通过数、全量 e2e 通过数。
2. 备份 patch：`patches/monaco-editor+0.52.2.patch` 内容已入 git（5be5ee7），无需额外备份。

### 阶段 1：安装与必改项（~20 min）
3. 删 `patches/monaco-editor+0.52.2.patch`；`package.json` 改 `"monaco-editor": "0.57.0"`；`npm install`（patch-package 无 patch 文件时静默通过）。
4. `vite.config.ts` 加 M0 alias 规则；`monaco.ts`：M2（16 条 contribution 路径）+ M3（python 深路径 + d.ts 声明，导出形状已核实不变）。
5. `npm run build`——预期 TS 编译暴露全部类型级 breaking（61 个类型消费者的第一道网）；**同时验证 `?worker` 导入与 manualChunks（chunk 数量/体积 vs 基线）**。

### 阶段 2：类型错误修复（~30 min，量取决于 0.57 d.ts 变化）
6. 逐个修 build 报错；**禁止** `as any` 压制——每个类型不匹配都要判断是"上游改名"（跟改）还是"我们用法过时"（跟新）。
7. 记录遇到的所有 breaking 到本文档 §6（执行后回填）。

### 阶段 3：vendor patch 重做（~15 min）
8. 手工把 0.52.2 patch 的两处修改应用到 0.57.0 的 `node_modules/.../inlayHintsController.js`（代码已实证逐行相同，纯行号平移）：
   - `_installLinkGesture` 内 `_getInlineHintsForRange` → `_getInlineHintsForRangePatched`
   - 新增 `_getInlineHintsForRangePatched` 方法（按 anchor 行列+label 去重）
9. `npx patch-package monaco-editor` 生成 `patches/monaco-editor+0.57.0.patch`；确认 `postinstall` 恢复生效。

### 阶段 4：自动化验证（~40 min）
10. `npm test`（1537 用例）——修复回归。
11. `npm run build` + `node scripts/budget-check.mjs`（monaco 升级不改我们的文件预算，应全 PASS）。
12. 全量 e2e（93 spec）——H5/H6/H7/H8 的主战场；失败项逐个判定「测试过时」vs「真 breaking」。

### 阶段 5：真机回归（~20 min，用户配合）
13. `set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 && npm run tauri dev`。
14. **inlay 三症状**（H1/H2）：开关开启 → 行尾回车→Ctrl+S→悬停 `-> None`/`url=`，两轮逐帧采样恒单份；重复/累积路径复测。
15. **主题逐项过**（H3/H4）：亮暗主题切换，编辑器/gutter/弹窗/suggest/滚动条/括号着色/错误波浪线。
16. **键位冒烟**（H6）：自定义键位逐个按（跳定义/重命名/折叠/建议/移动行）。
17. **右键菜单**（H9）+ JSON 折叠（H8）+ diff 视图（git 面板）。
18. 观察控制台无 monaco 相关报错/警告。

### 阶段 6：收尾（~10 min）
19. 回填本文档执行结果；tech-debt.md 若有依赖 0.52 内部行为的条目（TD-029 遗留注记）更新版本引用。
20. 单笔 commit：`build(deps): monaco-editor 0.52.2 → 0.57.0（ESM 重组适配 + patch 平移）`。

## 5. 回滚方案

- 升级分支独立 commit，任何阶段失败且 30 分钟内无法修复 → `git checkout` 回 `5be5ee7` 基线 + `npm i`（旧 patch 自动恢复）。
- **风险不对称**：我们所有修复（heal/merge/freeze/patch）都不依赖 0.57 的新能力，回滚零损失。

## 6. 执行结果回填（执行时填写）

- 遇到的 breaking changes 清单：_待填_
- e2e 失败项与判定：_待填_
- 真机回归结果：_待填_
- 基线 vs 升级后 build 体积：_待填_

## 7. 工时与排期估算

- 总计 **~2.5 小时**（阶段 0-6 含缓冲）；单人连续执行，中途可停（每阶段结束是安全点）。
- 最耗时的是阶段 2（类型修复，量未知）与阶段 4（e2e 全量 93 spec 约 15-20 min 纯运行时间）。

## 8. 明确不做的事（防蔓延）

- **不迁移**到新的官方 tree-shakeable 入口（`monaco-editor/editor` 聚合入口 / `features/*`）——聚合入口实测 3.25MB vs alias 方案 2.88MB（沙盒最小集，真实差距更大），丢掉按需裁剪优势；alias 方案保留全部现有 import 语句，改动最小。迁移到 features/* 是另一个独立优化（可登记 TD-031，届时应逐 feature 评估体积收益）。
- **不启用** 0.57 新选项（`wordWrapIndicator` 等）——纯升级，不加功能。
- **不动** happy-dom fake 里的硬编码枚举值——已验证 0.57 未变。
- **不重构** keybindings 命令 id——先回归，有问题单独修。
