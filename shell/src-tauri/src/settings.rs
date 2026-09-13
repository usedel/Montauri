// 全局设置（P25-T08/T09）：<data_root>/config/settings.json。
// 读取链：settings.json → 前端内存 → Monaco/editor.updateOptions。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

use crate::util::opencharm_home;

/// 默认快捷键（PyCharm 风格）：id 语义与前端 keybindings.ts 的 KEYBINDING_META 保持一致，
/// 新增/改键需同步三处（此处 + state.ts DEFAULT_SETTINGS + keybindings.ts META）。
fn default_keybindings() -> HashMap<String, String> {
    let mut m = HashMap::new();
    m.insert("save".into(), "Ctrl+S".into());
    m.insert("run".into(), "Ctrl+F10".into());
    m.insert("stop".into(), "Ctrl+F2".into());
    m.insert("run_selection".into(), "Alt+Shift+E".into());
    m.insert("global_search".into(), "Ctrl+Shift+F".into());
    m.insert("goto_definition".into(), "Ctrl+B".into());
    m.insert("duplicate_line".into(), "Ctrl+D".into());
    m.insert("comment_line".into(), "Ctrl+/".into());
    m.insert("comment_block".into(), "Ctrl+Shift+/".into());
    m.insert("template_palette".into(), "Ctrl+J".into());
    m.insert("surround".into(), "Ctrl+Alt+T".into());
    // P0（PyCharm 调研）：Optimize Imports / 最近文件（与前端 KEYBINDING_META / DEFAULT_SETTINGS 三处同步）
    m.insert("optimize_imports".into(), "Ctrl+Alt+O".into());
    m.insert("recent_files".into(), "Ctrl+E".into());
    // P1（PyCharm 调研）：转到文件 / 转到行 / 导航后退前进 / 本地历史
    //（与前端 KEYBINDING_META / DEFAULT_SETTINGS 三处同步）
    m.insert("goto_file".into(), "Ctrl+Shift+N".into());
    m.insert("goto_line".into(), "Ctrl+G".into());
    m.insert("nav_back".into(), "Ctrl+Alt+Left".into());
    m.insert("nav_forward".into(), "Ctrl+Alt+Right".into());
    m.insert("local_history".into(), "Ctrl+Shift+H".into());
    // 调试五件套（debug dev plan §6.6；与前端 KEYBINDING_META / DEFAULT_SETTINGS 三处同步）
    m.insert("debug".into(), "F5".into());
    m.insert("debug_stop".into(), "Shift+F5".into());
    m.insert("debug_step_over".into(), "F10".into());
    m.insert("debug_step_into".into(), "F11".into());
    m.insert("debug_step_out".into(), "Shift+F11".into());
    // P1：断点处求值表达式（与前端 KEYBINDING_META / DEFAULT_SETTINGS 三处同步）
    m.insert("debug_evaluate".into(), "Alt+F8".into());
    // P2：调试打磨组 + 书签 / 草稿 / 运行历史
    m.insert("debug_run_to_cursor".into(), "Alt+F9".into());
    m.insert("bookmark_toggle".into(), "Ctrl+F11".into());
    m.insert("bookmark_list".into(), "Ctrl+Shift+F11".into());
    m.insert("scratch_new".into(), "Ctrl+Alt+Shift+Insert".into());
    m.insert("run_history".into(), "Ctrl+Shift+R".into());
    // Markdown 预览开关（markdown preview dev plan §5-T4；与前端 KEYBINDING_META / DEFAULT_SETTINGS 三处同步）
    m.insert("markdown_preview".into(), "Ctrl+Shift+V".into());
    // P1（UX 审查）：高频操作补键位（与前端 KEYBINDING_META / DEFAULT_SETTINGS 三处同步）
    m.insert("close_tab".into(), "Ctrl+F4".into());
    m.insert("new_file".into(), "Ctrl+Alt+Insert".into());
    m.insert("open_settings".into(), "Ctrl+Alt+S".into());
    m.insert("toggle_sidebar".into(), "Ctrl+Shift+F12".into());
    m.insert("toggle_bottom".into(), "Alt+F12".into());
    m
}

fn settings_path() -> std::path::PathBuf {
    opencharm_home().join("config").join("settings.json")
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Settings {
    /// "vs-dark" | "vs"
    pub theme: String,
    /// 字号（Ctrl+滚轮 8-32）
    pub font_size: u32,
    /// 编辑器字体族（D3 起默认为常用等宽栈；空串 = Monaco 内置默认）
    pub font_family: String,
    /// 连字（font ligatures）
    pub font_ligatures: bool,
    /// Tab 宽度（1-8）
    pub tab_size: u32,
    /// 用空格替换 Tab 缩进
    pub insert_spaces: bool,
    /// 自动换行："off" | "on"
    pub word_wrap: String,
    /// 迷你地图开关
    pub minimap: bool,
    /// 自动保存："off" | "delay" | "blur"
    pub autosave: String,
    /// delay 模式的延迟毫秒
    pub autosave_delay: u64,
    /// 运行时探针开关（关闭时 run_script 不注入）
    pub probe_enabled: bool,
    /// LSP 引擎默认值："pyrefly" | "basedpyright"
    pub lsp_engine: String,
    /// 保存时用 ruff 格式化（Ctrl+S 联动）
    pub format_on_save: bool,
    /// 保存时用 ruff 整理导入（Ctrl+Alt+O 的保存联动，与 format_on_save 同模式）
    pub optimize_imports_on_save: bool,
    /// 运行时智能层（opencharm-intel）开关——关闭时 LSP 桥不启动 intel（P3-T09）
    pub runtime_intel_enabled: bool,
    /// 终端默认启动目录："workspace"（工作区根）| "file"（活动文件所在目录）
    pub terminal_cwd: String,
    /// 集成终端默认 shell："auto" | "pwsh" | "powershell" | "cmd"
    /// （"auto" 按 pwsh → powershell → cmd 依次回退；Unix 忽略该项用 $SHELL）
    pub terminal_shell: String,
    /// PyPI 包源（uv 拉取依赖用；默认官方源，国内网络可在设置面板切镜像）
    pub pypi_index: String,
    /// 快捷键自定义（id → 键位串如 "Ctrl+D"；空串 = 解绑）。
    /// 旧配置文件缺此字段时经 struct 级 #[serde(default)] 整体回落 default_keybindings；
    /// 部分键缺失（手改文件）由前端 loadSettings 逐项兜底。
    pub keybindings: HashMap<String, String>,
    /// 日志：总开关（关闭后仅 error 仍落盘）
    pub log_enabled: bool,
    /// 日志级别阈值："error" | "warn" | "info" | "debug"
    pub log_level: String,
    /// 日志轮转保留份数（1-10）
    pub log_keep: usize,
    /// 日志是否同时打印 stdout（dev 终端可见；release 无控制台可关）
    pub log_stdout: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: "vs-dark".into(),
            font_size: 14,
            // D3 P-14：与前端 DEFAULT_SETTINGS.font_family 保持同步
            font_family: "Consolas, \"Cascadia Code\", \"JetBrains Mono\", monospace".into(),
            font_ligatures: false,
            tab_size: 4,
            insert_spaces: true,
            word_wrap: "off".into(),
            minimap: false,
            autosave: "off".into(),
            autosave_delay: 1000,
            probe_enabled: true,
            lsp_engine: "pyrefly".into(),
            format_on_save: false,
            optimize_imports_on_save: false,
            runtime_intel_enabled: true,
            terminal_cwd: "workspace".into(),
            terminal_shell: "auto".into(),
            pypi_index: "https://pypi.org/simple".into(),
            keybindings: default_keybindings(),
            log_enabled: true,
            log_level: "info".into(),
            log_keep: 3,
            log_stdout: false,
        }
    }
}

pub(crate) fn load() -> Settings {
    let p = settings_path();
    if !p.is_file() {
        return Settings::default();
    }
    fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
        .unwrap_or_default()
}

/// 读取设置（文件不存在返回默认值；无效字段回落默认）
#[tauri::command]
pub fn get_settings() -> Result<Settings, String> {
    Ok(load())
}

/// 写入完整设置
#[tauri::command]
pub fn set_settings(settings: Settings) -> Result<(), String> {
    let p = settings_path();
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&p, json).map_err(|e| e.to_string())
}

/// 读取设置文件的原始路径（供测试/诊断）
#[allow(dead_code)]
fn _settings_path_debug() -> std::path::PathBuf {
    settings_path()
}

/// 测试辅助：临时重定向 settings 路径不可行（path 固定），
/// 这里验证序列化往返与默认值。
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_defaults() {
        let d = Settings::default();
        assert_eq!(d.theme, "vs-dark");
        assert_eq!(d.font_size, 14);
        assert_eq!(d.font_family, "Consolas, \"Cascadia Code\", \"JetBrains Mono\", monospace");
        assert_eq!(d.font_ligatures, false);
        assert_eq!(d.tab_size, 4);
        assert_eq!(d.insert_spaces, true);
        assert_eq!(d.word_wrap, "off");
        assert_eq!(d.minimap, false);
        assert_eq!(d.autosave, "off");
        assert_eq!(d.probe_enabled, true);
        assert_eq!(d.lsp_engine, "pyrefly");
        assert_eq!(d.format_on_save, false);
        assert_eq!(d.runtime_intel_enabled, true);
        assert_eq!(d.terminal_cwd, "workspace");
        assert_eq!(d.terminal_shell, "auto");
        // 快捷键默认值（PyCharm 风格）
        assert_eq!(d.keybindings.get("save").map(String::as_str), Some("Ctrl+S"));
        assert_eq!(d.keybindings.get("duplicate_line").map(String::as_str), Some("Ctrl+D"));
        assert_eq!(d.keybindings.get("comment_line").map(String::as_str), Some("Ctrl+/"));
        assert_eq!(d.keybindings.get("comment_block").map(String::as_str), Some("Ctrl+Shift+/"));
        assert_eq!(d.keybindings.get("goto_definition").map(String::as_str), Some("Ctrl+B"));
        assert_eq!(d.keybindings.get("stop").map(String::as_str), Some("Ctrl+F2"));
        assert_eq!(d.keybindings.get("debug").map(String::as_str), Some("F5"));
        assert_eq!(d.keybindings.get("debug_stop").map(String::as_str), Some("Shift+F5"));
        assert_eq!(d.keybindings.get("debug_step_over").map(String::as_str), Some("F10"));
        assert_eq!(d.keybindings.get("debug_step_into").map(String::as_str), Some("F11"));
        assert_eq!(d.keybindings.get("debug_step_out").map(String::as_str), Some("Shift+F11"));
        assert_eq!(d.keybindings.get("markdown_preview").map(String::as_str), Some("Ctrl+Shift+V"));
        // P0（PyCharm 调研）：Optimize Imports / 最近文件
        assert_eq!(d.keybindings.get("optimize_imports").map(String::as_str), Some("Ctrl+Alt+O"));
        assert_eq!(d.keybindings.get("recent_files").map(String::as_str), Some("Ctrl+E"));
        // P1（PyCharm 调研）：Search Everywhere 三入口 + 导航历史 + 本地历史 + 求值
        assert_eq!(d.keybindings.get("goto_file").map(String::as_str), Some("Ctrl+Shift+N"));
        assert_eq!(d.keybindings.get("goto_line").map(String::as_str), Some("Ctrl+G"));
        assert_eq!(d.keybindings.get("nav_back").map(String::as_str), Some("Ctrl+Alt+Left"));
        assert_eq!(d.keybindings.get("nav_forward").map(String::as_str), Some("Ctrl+Alt+Right"));
        assert_eq!(d.keybindings.get("local_history").map(String::as_str), Some("Ctrl+Shift+H"));
        assert_eq!(d.keybindings.get("debug_evaluate").map(String::as_str), Some("Alt+F8"));
        // P2：Run to Cursor / 书签 / 草稿 / 运行历史
        assert_eq!(d.keybindings.get("debug_run_to_cursor").map(String::as_str), Some("Alt+F9"));
        assert_eq!(d.keybindings.get("bookmark_toggle").map(String::as_str), Some("Ctrl+F11"));
        assert_eq!(d.keybindings.get("scratch_new").map(String::as_str), Some("Ctrl+Alt+Shift+Insert"));
        // P1（UX 审查）：关闭标签 / 新建文件 / 打开设置 / 切换侧栏 / 切换底部面板
        assert_eq!(d.keybindings.get("close_tab").map(String::as_str), Some("Ctrl+F4"));
        assert_eq!(d.keybindings.get("new_file").map(String::as_str), Some("Ctrl+Alt+Insert"));
        assert_eq!(d.keybindings.get("open_settings").map(String::as_str), Some("Ctrl+Alt+S"));
        assert_eq!(d.keybindings.get("toggle_sidebar").map(String::as_str), Some("Ctrl+Shift+F12"));
        assert_eq!(d.keybindings.get("toggle_bottom").map(String::as_str), Some("Alt+F12"));
        // 键位表条目数 = 前端 KEYBINDING_META 条目数（漂移锁，新增键须同步改这里）
        assert_eq!(d.keybindings.len(), 35);
        assert_eq!(d.optimize_imports_on_save, false);
    }

    #[test]
    fn test_serde_roundtrip() {
        let s = Settings { font_size: 20, autosave: "delay".into(), format_on_save: true, ..Settings::default() };
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.font_size, 20);
        assert_eq!(back.autosave, "delay");
        assert_eq!(back.probe_enabled, true);
        assert_eq!(back.format_on_save, true);
    }

    #[test]
    fn test_partial_json_falls_back_to_default() {
        let json = r#"{"font_size":18}"#;
        let s: Settings = serde_json::from_str(json).unwrap();
        assert_eq!(s.font_size, 18);
        assert_eq!(s.theme, "vs-dark"); // 未提供的字段走 default
        assert_eq!(s.probe_enabled, true);
        assert_eq!(s.format_on_save, false); // 旧配置文件无此字段 → 默认关闭
        assert_eq!(s.terminal_cwd, "workspace"); // 旧配置文件无此字段 → 默认工作区根
        assert_eq!(s.terminal_shell, "auto"); // 旧配置文件无此字段 → 默认自动回退
        assert_eq!(s.pypi_index, "https://pypi.org/simple"); // 旧配置文件无此字段 → 默认官方源
        // 编辑器新增项（P1）：旧配置文件无此字段 → 回落默认
        assert_eq!(s.tab_size, 4);
        assert_eq!(s.insert_spaces, true);
        assert_eq!(s.word_wrap, "off");
        assert_eq!(s.minimap, false);
        assert_eq!(s.font_ligatures, false);
        // 快捷键：旧配置文件无此字段 → 整体回落默认键位表
        assert_eq!(s.keybindings.get("duplicate_line").map(String::as_str), Some("Ctrl+D"));
        assert_eq!(s.keybindings.get("debug").map(String::as_str), Some("F5"));
        assert_eq!(s.keybindings.get("markdown_preview").map(String::as_str), Some("Ctrl+Shift+V"));
        assert_eq!(s.keybindings.get("optimize_imports").map(String::as_str), Some("Ctrl+Alt+O"));
        assert_eq!(s.keybindings.get("recent_files").map(String::as_str), Some("Ctrl+E"));
        // P1 新增键（旧配置无此字段 → 同样回落默认）
        assert_eq!(s.keybindings.get("goto_file").map(String::as_str), Some("Ctrl+Shift+N"));
        assert_eq!(s.keybindings.get("nav_back").map(String::as_str), Some("Ctrl+Alt+Left"));
        assert_eq!(s.keybindings.get("local_history").map(String::as_str), Some("Ctrl+Shift+H"));
        assert_eq!(s.keybindings.get("run_history").map(String::as_str), Some("Ctrl+Shift+R"));
        assert_eq!(s.keybindings.len(), 35);
        assert_eq!(s.optimize_imports_on_save, false); // 旧配置文件无此字段 → 默认关闭
    }
}