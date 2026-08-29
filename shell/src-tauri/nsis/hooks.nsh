; OpenCharm NSIS 安装钩子（Tauri installerHooks 扩展点，见 docs/disk-space-plan.md P2）。
; 使用官方 NSIS 模板，不 fork 完整 installer.nsi；仅挂卸载钩子实现「删除用户数据」询问。
;
; 数据根可能被迁移到自定义位置（指针文件机制，跨平台、无注册表依赖）：
;   - 指针文件：%APPDATA%\OpenCharm\data-root（应用写入，内容 = 数据根绝对路径，无换行）
;   - 默认数据根：%LOCALAPPDATA%\OpenCharm
; 勾选删除数据时需同时清理：默认根 + 指针所指根 + 指针目录本身。
; 用户工具链（uv / pyrefly 所在目录）一律不碰。

!macro NSIS_HOOK_POSTUNINSTALL
  Push $0
  Push $1
  Push $2
  Push $3
  MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除 OpenCharm 用户数据（设置、trace 库、日志等）？$\n$\n此操作不可恢复；已迁移到其他盘的自定义数据目录也会一并删除。" /SD IDNO IDNO opencharm_skip_data_removal
    ; 1) 默认数据根
    RMDir /r "$LOCALAPPDATA\OpenCharm"
    ; 2) 迁移过的数据根：读指针文件（应用自己写入的，内容 = 数据根绝对路径）。
    ;    注意：不碰注册表——OPENCHARM_DATA_ROOT 环境变量是用户自有配置（文档化的高级用法），
    ;    应用从不写入，卸载器也不得删除。
    ClearErrors
    FileOpen $0 "$APPDATA\OpenCharm\data-root" r
    IfErrors opencharm_pointer_done
    FileRead $0 $1
    FileClose $0
    StrCmp $1 "" opencharm_pointer_done
    ; 安全护栏：路径过短或以 \ 结尾（盘根，如 D:\）绝不递归删除
    StrLen $2 $1
    IntCmp $2 4 opencharm_pointer_done opencharm_pointer_done 0
    StrCpy $3 $1 1 -1
    StrCmp $3 "\" opencharm_pointer_done
      RMDir /r "$1"
    opencharm_pointer_done:
    ; 3) 指针目录本身（含指针文件）
    RMDir /r "$APPDATA\OpenCharm"
  opencharm_skip_data_removal:
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend
