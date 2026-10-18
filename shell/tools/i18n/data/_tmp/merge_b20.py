# -*- coding: utf-8 -*-
"""临时：第二十批（main.ts 杂项动态文案）——新开 main 域：映射表追加 + zh 词条合并。

console.warn/error/debug 的日志文案不进范围（16 处）；tree.treeHeaderText 复用 filetree 域既有 key（map 外）。
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
PH = "§"

# 域文件登记手工步骤（main.ts 的 t 导入也手工）：zh-CN/index.ts 与 en-US/index.ts 各 +1 行

MAP_ADD = {
    # ---- 工作区 / 确认 ----
    "存在未保存的修改（将以草稿形式保留，重开工作区自动恢复），确认关闭工作区？": {"key": "main.confirm.closeWorkspace"},
    "存在未保存的修改，确认关闭？": {"key": "main.confirm.closeTabs"},
    "§ 有未保存修改，确认关闭？": {"key": "main.confirm.closeDirty", "params": ["name"]},
    # ---- 最近工作区 ----
    "从列表移除": {"key": "main.recent.remove"},
    "清空最近工作区": {"key": "main.recent.clear"},
    "删除最近工作区": {"key": "main.recent.removeOne"},
    "在新窗口打开工作区": {"key": "main.recent.openInNewWindow"},
    "复制路径": {"key": "main.recent.copyPath"},
    # ---- 标签右键菜单 / 标签页 ----
    "关闭": {"key": "main.tab.close"},
    "关闭其他": {"key": "main.tab.closeOthers"},
    "关闭右侧": {"key": "main.tab.closeRight"},
    "关闭全部": {"key": "main.tab.closeAll"},
    "复制文件名": {"key": "main.tab.copyName"},
    "复制相对路径": {"key": "main.tab.copyRelPath"},
    "复制 file:line 引用": {"key": "main.tab.copyFileLine"},
    "复制绝对路径": {"key": "main.tab.copyAbsPath"},
    "在终端中打开": {"key": "main.tab.openInTerminal"},
    "在资源管理器中显示": {"key": "main.tab.revealInExplorer"},
    "打开预览": {"key": "main.tab.previewOpen"},
    "关闭预览": {"key": "main.tab.previewClose"},
    "§ · 差异": {"key": "main.tab.diffTitle", "params": ["name"]},
    "已修改": {"key": "main.tab.modified"},
    "运行中": {"key": "main.tab.running"},
    "关闭 §": {"key": "main.tab.closeAria", "params": ["name"]},
    # ---- 大纲 / 打开文件 ----
    "无符号": {"key": "main.outline.noSymbols"},
    "打开文件失败：§": {"key": "main.openFile.failed", "params": ["msg"]},
    # ---- 保存 / 自动保存 / 整理导入 ----
    "定位": {"key": "main.save.locate"},
    "自动保存": {"key": "main.save.autosave"},
    "Optimize Imports 仅支持 Python 文件（当前：§）": {"key": "main.imports.pyOnly", "params": ["name"]},
    "已整理导入：§": {"key": "main.imports.done", "params": ["name"]},
    # ---- 调试 ----
    "不是 Python 文件：§": {"key": "main.debug.notPython", "params": ["name"]},
    "已有脚本在运行，请先停止再调试": {"key": "main.debug.runBusy"},
    "已有调试会话在运行，请先停止（Shift+F5）": {"key": "main.debug.sessionBusy"},
    "调试启动异常: §": {"key": "main.debug.startError", "params": ["msg"]},
    "调试启动": {"key": "main.debug.start"},
    "参数 §": {"key": "main.debug.argsLine", "params": ["args"]},
    "环境变量 § 项": {"key": "main.debug.envLine", "params": ["n"]},
    "调试复用运行配置：§": {"key": "main.debug.reuseConfig", "params": ["parts"]},
    "调试环境检测失败: §": {"key": "main.debug.detectError", "params": ["msg"]},
    "调试环境检测": {"key": "main.debug.detect"},
    "未找到自带 debugpy": {"key": "main.debug.noDebugpyTitle"},
    "应用资源目录损坏，或开发环境未运行 tools/fetch-debugpy.ps1 拉取。\\n\\n": {"key": "main.debug.noDebugpyBody1"},
    "请重新安装应用，或在仓库根目录执行：\\n": {"key": "main.debug.noDebugpyBody2"},
    "知道了": {"key": "main.debug.gotIt"},
    "提示：§ 声明了 debugpy —— Montauri 调试使用自带副本，二者互不影响，可按需移除声明。": {"key": "main.debug.depHint", "params": ["files"]},
    "调试启动失败: §": {"key": "main.debug.startFailed", "params": ["msg"]},
    "已新建草稿（不入库，可直接运行 / 调试）": {"key": "main.scratch.created"},
    "新建草稿": {"key": "main.scratch.failAction"},
    "Run to Cursor 需要在调试暂停时使用（先运行到断点处）": {"key": "main.debug.runToCursorHint"},
    # ---- 工具菜单 / 命令面板 ----
    "插件管理…": {"key": "main.cmd.plugins"},
    "保存": {"key": "main.cmd.save"},
    "启动调试 / 继续": {"key": "main.cmd.debugStart"},
    "停止调试": {"key": "main.cmd.debugStop"},
    "求值表达式": {"key": "main.cmd.evaluate"},
    "运行到光标处": {"key": "main.cmd.runToCursor"},
    "切换书签": {"key": "main.cmd.bookmarkToggle"},
    "书签列表": {"key": "main.cmd.bookmarkList"},
    "新建草稿文件": {"key": "main.cmd.scratchNew"},
    "向右分屏": {"key": "main.cmd.splitRight"},
    "删除行": {"key": "main.cmd.deleteLine"},
    "折叠全部": {"key": "main.cmd.foldAll"},
    "展开全部": {"key": "main.cmd.unfoldAll"},
    "括号匹配跳转": {"key": "main.cmd.jumpBracket"},
    "重新打开关闭的标签": {"key": "main.cmd.reopenTab"},
    "上一个编辑位置": {"key": "main.cmd.lastEdit"},
    "没有可重新打开的标签": {"key": "main.cmd.reopenNone"},
    "没有更早的编辑位置": {"key": "main.cmd.noEarlierEdit"},
    "运行历史": {"key": "main.cmd.runHistory"},
    "转到文件": {"key": "main.cmd.gotoFile"},
    "转到文件内符号": {"key": "main.cmd.gotoSymbol"},
    "触发补全建议": {"key": "main.cmd.triggerSuggest"},
    "转到行 / 列": {"key": "main.cmd.gotoLine"},
    "跳转定义": {"key": "main.cmd.gotoDef"},
    "全局搜索": {"key": "main.cmd.globalSearch"},
    "最近打开的文件": {"key": "main.cmd.recentFiles"},
    "整理导入（Optimize Imports）": {"key": "main.cmd.optimizeImports"},
    "本地历史": {"key": "main.cmd.localHistory"},
    "Live Templates 面板": {"key": "main.cmd.ltPalette"},
    "环绕模板（需选区）": {"key": "main.cmd.surround"},
    "Markdown 预览": {"key": "main.cmd.mdPreview"},
    "格式化文档": {"key": "main.cmd.formatDoc"},
    "打开设置": {"key": "main.cmd.openSettings"},
    "新手指南": {"key": "main.cmd.guide"},
    "欢迎页": {"key": "main.cmd.welcome"},
    "新建项目": {"key": "main.cmd.newProject"},
    "Git 面板": {"key": "main.cmd.gitPanel"},
    "Git: 初始化仓库": {"key": "main.cmd.gitInit"},
    "Git: 暂存全部更改": {"key": "main.cmd.gitStageAll"},
    "Git: 丢弃全部更改…": {"key": "main.cmd.gitDiscardAll"},
    "Git: 提交": {"key": "main.cmd.gitCommit"},
    "Git: 提交全部更改": {"key": "main.cmd.gitCommitAll"},
    "Git: 抓取（Fetch）": {"key": "main.cmd.gitFetch"},
    "Git: 拉取（Pull）": {"key": "main.cmd.gitPull"},
    "Git: 推送（Push）": {"key": "main.cmd.gitPush"},
    "Git: 贮藏更改（Stash）": {"key": "main.cmd.gitStash"},
    "Git: 弹出贮藏（Stash Pop）": {"key": "main.cmd.gitStashPop"},
    "Git: 提交历史": {"key": "main.cmd.gitHistory"},
    "Git: 切换分支": {"key": "main.cmd.gitBranches"},
    "Git: 查看同步状态（↑待推 ↓待拉）": {"key": "main.cmd.gitSyncStatus"},
    "同步状态已更新到状态栏": {"key": "main.cmd.syncUpdated"},
    "TODO 工具窗": {"key": "main.cmd.todoPanel"},
    "开发工具面板": {"key": "main.cmd.devtools"},
    "关闭标签": {"key": "main.cmd.closeTab"},
    "新建文件": {"key": "main.cmd.newFile"},
    "切换侧栏": {"key": "main.cmd.toggleSidebar"},
    "切换底部面板": {"key": "main.cmd.toggleBottom"},
    "打开问题面板": {"key": "main.cmd.problems"},
    "工具: §": {"key": "main.cmd.toolPrefix", "params": ["title"]},
    # ---- 运行组菜单（与 tab 菜单/命令面板共用运行脚本/项目/配置） ----
    "运行脚本": {"key": "main.run.script"},
    "运行项目": {"key": "main.run.project"},
    "停止运行": {"key": "main.run.stop"},
    "运行配置…": {"key": "main.run.config"},
    "正在准备运行…": {"key": "main.run.preparingScript"},
    "正在准备运行项目…": {"key": "main.run.preparingProject"},
    "没有正在运行": {"key": "main.run.noneRunning"},
    "需先打开工作区": {"key": "main.run.needWorkspace"},
    # ---- 断点右键菜单 ----
    "编辑条件…": {"key": "main.bp.editCondition"},
    "添加条件断点…": {"key": "main.bp.addCondition"},
    "当前：§": {"key": "main.bp.current", "params": ["value"]},
    "断点条件 · §:§": {"key": "main.bp.conditionTitle", "params": ["name", "line"]},
    "Python 表达式，为真时才断下（如 i > 10）；留空清除条件。": {"key": "main.bp.conditionLabel"},
    "设置命中次数…": {"key": "main.bp.hitCount"},
    "命中次数 · §:§": {"key": "main.bp.hitTitle", "params": ["name", "line"]},
    "数字（第 N 次命中时断下）或比较表达式（>3、%2==0）；留空清除。": {"key": "main.bp.hitLabel"},
    "编辑日志消息…": {"key": "main.bp.editLog"},
    "设为日志点（不打断）…": {"key": "main.bp.setLogpoint"},
    "日志点 · §:§": {"key": "main.bp.logTitle", "params": ["name", "line"]},
    "用 {表达式} 插值，如 i={i}；设置后该行不断下，只把结果打到调试输出。": {"key": "main.bp.logLabel"},
    "转为普通断点": {"key": "main.bp.toPlain"},
    "当前已是普通断点": {"key": "main.bp.alreadyPlain"},
    "禁用断点": {"key": "main.bp.disable"},
    "启用断点": {"key": "main.bp.enable"},
    "该行没有断点": {"key": "main.bp.noBpHere"},
    "删除断点": {"key": "main.bp.remove"},
    "在此添加断点": {"key": "main.bp.addHere"},
    # ---- LSP ----
    "LSP 启动失败: §": {"key": "main.lsp.startFailed", "params": ["msg"]},
    "LSP: 未启动": {"key": "main.lsp.off"},
    "LSP: 启动中…": {"key": "main.lsp.starting"},
    "LSP: 就绪": {"key": "main.lsp.ready"},
    "LSP: 错误": {"key": "main.lsp.error"},
    "LSP: 已退出": {"key": "main.lsp.exited"},
    # ---- 窗口 / 关于 / URL ----
    "还原": {"key": "main.win.restore"},
    "最大化": {"key": "main.win.maximize"},
    "关于 Montauri": {"key": "main.about.title"},
    "Montauri §\\n轻量级 Python IDE（Tauri 2 + Monaco）\\n静态语义：Pyrefly / basedpyright · 运行时：montauri-probe + montauri-intel": {"key": "main.about.body", "params": ["version"]},
    "读取版本失败": {"key": "main.about.versionFail"},
    "打开日志目录": {"key": "main.about.openLogDir"},
    "打开数据目录": {"key": "main.about.openDataDir"},
    "打开浏览器": {"key": "main.url.openBrowser"},
}


def entry_of(tpl: str, params: list[str]) -> str:
    out = []
    idx = 0
    for ch in tpl:
        if ch == PH:
            out.append("{" + (params[idx] if idx < len(params) else f"p{idx}") + "}")
            idx += 1
        else:
            out.append(ch)
    return "".join(out)


# 转义修正：源码级 \n（两字符）在运行时是真实换行——词条值须为真实换行
ZH_OVERRIDES = {
    "main.debug.noDebugpyBody1": "应用资源目录损坏，或开发环境未运行 tools/fetch-debugpy.ps1 拉取。\n\n",
    "main.debug.noDebugpyBody2": "请重新安装应用，或在仓库根目录执行：\n",
    "main.about.body": "Montauri {version}\n轻量级 Python IDE（Tauri 2 + Monaco）\n静态语义：Pyrefly / basedpyright · 运行时：montauri-probe + montauri-intel",
}

# 1) map 追加
map_path = HERE / "main_map.json"
if map_path.exists():
    mapping = json.loads(map_path.read_text(encoding="utf-8"))
else:
    mapping = {}
added = 0
for tpl_, rec in MAP_ADD.items():
    if tpl_ not in mapping:
        mapping[tpl_] = rec
        added += 1
map_path.write_text(json.dumps(dict(sorted(mapping.items())), ensure_ascii=False, indent=1), encoding="utf-8")
print(f"map 追加 {added} 条 → 共 {len(mapping)} 条")

# 2) zh 合并（新建 main_zh.json）
zh_path = HERE / "main_zh.json"
zh = json.loads(zh_path.read_text(encoding="utf-8")) if zh_path.exists() else {}
new_zh = 0
for tpl_, rec in MAP_ADD.items():
    key = rec["key"]
    if key not in zh:
        zh[key] = entry_of(tpl_, rec.get("params") or [])
        new_zh += 1
zh.update(ZH_OVERRIDES)
zh_path.write_text(json.dumps(dict(sorted(zh.items())), ensure_ascii=False, indent=2), encoding="utf-8")
print(f"zh 新增 {new_zh} 条 + override {len(ZH_OVERRIDES)} → 共 {len(zh)} 条")
