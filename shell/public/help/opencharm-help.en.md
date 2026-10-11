# OpenCharm Help

> A high-performance, lightweight Python IDE for developers working with FastAPI, web scrapers, and small scripts.
> Open it from the top menu: **Help → Help Documentation**. The document is rewritten from the copy bundled with the app every time you open it, so it is always current.
>
> Where this document lives: `shell/public/help/opencharm-help.en.md`, shipped with the build output (it is not part of the frontend JS bundle — see the project's size budget policy).

---

## Contents

1. [Quick Start](#quick-start)
2. [Interface Overview](#interface-overview)
3. [Editor and Code Intelligence](#editor-and-code-intelligence)
4. [Running and Terminal](#running-and-terminal)
5. [Debugging](#debugging)
6. [Navigation and Search](#navigation-and-search)
7. [Version Control](#version-control)
8. [Database Tools](#database-tools)
9. [Developer Toolbox](#developer-toolbox)
10. [Runtime Insights](#runtime-insights)
11. [Environments and Dependencies](#environments-and-dependencies)
12. [Projects and Files](#projects-and-files)
13. [Plugin System](#plugin-system)
14. [Personalization](#personalization)
15. [Keyboard Shortcuts](#keyboard-shortcuts)
16. [FAQ](#faq)
17. [Data Directory and Logs](#data-directory-and-logs)

---

## Quick Start

### First launch

On first launch, if required tools are missing (`uv`, the static analysis engine), OpenCharm shows an **environment setup** confirmation dialog that can install them into your user directory with one click, without touching the system environment. You can edit code without them, but package management, environment management, and static diagnostics will be unavailable.

### Get your first program running in three steps

**Step 1 · Create a project**

Top menu **File → New Project**, or the "New Project" button on the welcome page.

- **Location**: where the project goes;
- **Git**: optionally initialize a Git repository;
- **Environment type**: a uv-managed virtual environment (recommended) or the system interpreter;
- **Python version**: uv downloads and installs it automatically if you do not have a suitable one locally.

For an existing project, use **File → Open Workspace** (`Ctrl+K Ctrl+O`), or **File → Clone Repository** to pull from a remote.

**Step 2 · Run a script**

With any `.py` file open, pick one of:

| Method | Entry point |
|---|---|
| Title bar run group | The ▶ button at the top right (hover shows the shortcut) |
| Menu | **Run → Run Script** |
| Shortcut | `Ctrl+F10` run script · `Ctrl+Shift+F10` run project |
| Editor gutter | The small ▶ arrow left of the line numbers (runs the current file) |

Output appears in the bottom run console; `File "…", line N` in a traceback is clickable and jumps to the line.

**Step 3 · Debug with a breakpoint**

1. **Click** left of the line number to place a red breakpoint; right-click a breakpoint to add a condition, hit count, or logpoint;
2. Press `F5` to start debugging;
3. Once stopped: `F10` step over · `F11` step into · `Shift+F11` step out · `Alt+F9` run to cursor · `Alt+F8` evaluate expression;
4. The Debug sidebar shows the call stack, variables, and breakpoint list; the **Debug Console** at the bottom supports interactive evaluation.

### Five things worth trying immediately

| Capability | Entry point |
|---|---|
| Developer toolbox (JSON, regex, timestamps, HTTP requests…) | `Ctrl+Shift+T` |
| Search Everywhere (files / symbols / commands) | Double-tap `Shift` |
| Live Templates | `Ctrl+J` palette · `Ctrl+Alt+T` surround |
| Endpoints view (appears automatically for FastAPI / Flask projects) | "Endpoints" sidebar view |
| Dependency health check | Health icon in the status bar / Dependency Health sidebar view |

---

## Interface Overview

### Title bar

A custom-drawn title bar, left to right:

- **Brand mark + menu bar**: File · Edit · View · Go · Run · Git · Tools · Help;
- **Run group**: Run Script ▶ · Run Project ▶▶ · Stop ⏹ · Run Configuration ⚙;
- **Debug** and **Settings** icon buttons;
- On the right: minimize / maximize-restore / close window buttons.

The menu supports keyboard roaming: `←` `→` switch top-level menus, `↑` `↓` move between items, `Enter` activates, `Esc` closes.

### Activity bar and sidebar

The vertical icon strip on the left maps to 8 sidebar views:

| View | Description |
|---|---|
| Files | Workspace file tree + outline (OUTLINE); the collapsed state is remembered |
| Search | Global search (content search, with filters) |
| TODO | Collects TODO markers across the project |
| Endpoints | FastAPI / Flask route list (scanned only when the view is shown) |
| Git | Changes, branches, history |
| Debug | Call stack / variables / breakpoints / Watches |
| Database | SQLite connections and table browsing |
| Runtime | Runtime hotspots (reads sampled run data) |

> Sidebar views load on demand: TODO, Endpoints, Database, and Runtime only do I/O **when you switch to them**, so startup stays fast.

### Editor area

- A central Monaco editor with multiple tabs (drag to reorder, cycle with the keyboard);
- Read-only preview tabs: **Markdown preview**, **CSV data viewer**, **database query tab**, **Diff** — mutually exclusive with the main editor;
- Floating buttons at the top right: Markdown preview toggle, preview-mode switch, export HTML;
- Breadcrumbs show the symbol path at the cursor.

### Bottom panel

- **Run console / terminal**: a real PTY terminal with multiple sessions;
- **Problems panel** (`Alt+0`): errors and warnings;
- **References panel** (`Alt+F7`): find-usages results;
- **Debug Console**: interactive evaluation while debugging.

Toggle the bottom panel with `Alt+F12` and the sidebar with `Ctrl+Shift+F12`.

### Status bar

Shows the interpreter / virtual environment switcher, LSP engine status, dependency health icon, cursor position, indentation, and more. Click the interpreter area to switch Python environments quickly.

---

## Editor and Code Intelligence

### Completion

Completion merges four layers in a fixed order:

1. **Smart Live Templates** (highest priority)
2. **Runtime observations (intel)** — types and attributes sampled from actual runs
3. **Static analysis (pyrefly / basedpyright)**
4. **Keywords**

How to trigger it:

- Pops up automatically as you type;
- `Alt+/` to trigger manually (Chinese IMEs swallow `Ctrl+Space`, hence this alternative);
- `Ctrl+Shift+J` to force-show all templates (ignoring the member-access gate);
- `Tab` accepts the focused suggestion (replace mode: `Enter` inserts / `Tab` replaces).

Inside string literals you also get **path completion** (for common calls such as `open("...")` or `Path("...")`).

### Navigation and references

| Action | Shortcut |
|---|---|
| Go to definition | `Ctrl+B` (`F12` / `Ctrl+click` are also fixed entries) |
| Find usages | `Alt+F7` (full list in the bottom References panel; `Shift+F12` is a quick peek) |
| Rename symbol (cross-file) | `Shift+F6` (`F2` is the same entry point) |
| Go to symbol in file | `Ctrl+F12` |
| Go to file | `Ctrl+Shift+N` |
| Go to line / column | `Ctrl+G` |

Rename is **in-place**: after the symbol is anchored, a ghost preview is shown, and confirming writes to all files at once. For Pydantic model fields, pyrefly reports zero references, so OpenCharm additionally scans `Model(field=` construction sites and includes them in the edit set (a 2-second scan timeout degrades gracefully); with the basedpyright engine this is covered by the engine itself and the custom layer steps aside.

### Hover and inline hints

- **Hover**: functions show aggregated observed arguments / returns / exceptions; variables show the inferred type and common keys (type labels and structural fingerprints only, never actual values);
- **Inline diagnostics** (inspired by Error Lens): errors and warnings appear at the end of the relevant line with a `+N` collapse;
- **Reference CodeLens** and **regex / format-string / JSON literal CodeLens**: clickable entry points above the literal.

### Editing operations

| Action | Shortcut |
|---|---|
| Toggle line comment | `Ctrl+/` |
| Toggle block comment | `Ctrl+Shift+/` |
| Duplicate line / selection | `Ctrl+D` |
| Delete line | `Ctrl+Y` |
| Move line / selection up | `Ctrl+Shift+↑` |
| Move line / selection down | `Ctrl+Shift+↓` |
| Expand selection (syntax-aware) | `Ctrl+W` |
| Shrink selection (syntax-aware) | `Ctrl+Shift+W` |
| Toggle column selection mode | `Alt+Shift+Insert` |
| Fold all | `Ctrl+Shift+-` |
| Unfold all | `Ctrl+Shift+=` |
| Jump to matching bracket | `Ctrl+Shift+\` |
| Format document | `Shift+Alt+F` |
| Optimize Imports | `Ctrl+Alt+O` |
| Split editor right | `Ctrl+\` |

### Live Templates

Built-in Python templates (including a scraping-oriented group). You can:

- Open the template palette with `Ctrl+J`;
- Surround a selection with `Ctrl+Alt+T`;
- Insert directly from the completion popup (highest priority);
- Define your own templates under **Settings → Live Templates**: create, edit, group, enable/disable, import/export.

### Python library support

Targeted experience for common libraries:

| Scenario | Capability |
|---|---|
| `re` regex | Token-by-token hover explanations; `Ctrl+Alt+R` opens the regex tester |
| Format strings | strftime / logging / format reference tables (the "Format String Preview" tool) |
| JSON | Literal CodeLens; JSON → Python model; JSONPath extraction |
| Expression evaluation | In-place evaluation of expressions in the editor (evaluation bridge) |
| Script arguments | Fill in command-line arguments via a form when running a script |

---

## Running and Terminal

### Ways to run

| Method | Description | Shortcut |
|---|---|---|
| Run script | Run the current file | `Ctrl+F10` |
| Run project | Run via the project entry point | `Ctrl+Shift+F10` |
| Run selection / line | Run only the selected code or the current line | `Alt+Shift+E` |
| Run cell | Run the cell delimited by `# %%` (Jupyter-style) | `Ctrl+Enter` |
| Stop | Stop the current run | `Ctrl+F2` |

The shell injects the run environment: it prepends `PYTHONPATH` with the probe package and sets `OPENCHARM_PROBE_AUTOSTART=1`, which enables runtime sampling (unset means zero interference).

### Run configurations

**Run → Run Configuration** manages per-project run configurations (entry script, arguments, environment variables, working directory, and so on). Configurations persist with the workspace.

### Run console

- A unified real PTY terminal with ANSI colors and interactive input;
- Multiple parallel run instances, with run history attributed per instance;
- In-terminal messages follow the selected language.

### Run history

`Ctrl+Shift+R` opens the run history to review the output and status of previous runs.

### Script argument form

When a script needs command-line arguments, the argument form collects them and assembles the command line, so you do not have to type a long list by hand.

### Scratch files

`Ctrl+Alt+Shift+Insert` creates a scratch file for quick experiments. Scratch files support `# %%` cell execution (`Ctrl+Enter`). To stay lightweight, the scratch interpreter session is **started on demand, can be closed explicitly, and is reclaimed when idle**.

---

## Debugging

Debugging is built on debugpy (bundled with the app — no installation, no network, and switching virtual environments is transparent) plus a custom lightweight DAP bridge.

### Basic flow

1. Click left of a line number to set a breakpoint (red dot);
2. `F5` to start debugging / continue;
3. Step and evaluate once stopped.

| Action | Shortcut |
|---|---|
| Start debugging / continue | `F5` |
| Stop debugging | `Shift+F5` |
| Step over | `F10` |
| Step into | `F11` |
| Step out | `Shift+F11` |
| Run to cursor | `Alt+F9` |
| Evaluate expression | `Alt+F8` |

### Breakpoints

- **Plain breakpoint**: click left of the line number;
- **Conditional breakpoint**: right-click → edit condition, e.g. `i > 10`;
- **Hit count**: e.g. `>3`, stops only on the Nth hit;
- **Logpoint**: e.g. `i={i}, url={url}`, prints without stopping;
- **Enable / disable**: disabling keeps the breakpoint and all its attributes but does not send it to the debugger (gray dot);
- **Remove / convert to plain**: via the right-click menu.

Breakpoints persist with the workspace.

### Debug sidebar and console

- **Call stack**: frames of the current thread; click to switch frames;
- **Variables**: variable tree for the current frame;
- **Watches**: user-defined watch expressions;
- **Breakpoint list**: centralized management of all breakpoints;
- **Debug Console**: interactive evaluation (`Alt+F8` focuses it quickly);
- **Inline values**: variable values shown directly at the end of code lines while debugging.

---

## Navigation and Search

### Search Everywhere

Double-tap `Shift` to open the mixed search and switch between **files / symbols / commands**.

### Direct modes

| Mode | Shortcut |
|---|---|
| Files | `Ctrl+Shift+N` |
| Symbols in file | `Ctrl+F12` |
| Line / column | `Ctrl+G` |
| Command palette (commands only) | `Ctrl+Shift+P` |

### Search

- **Global search** (content): `Ctrl+Shift+F`, with filters (file type, scope, and so on);
- **In-editor find / replace**: `Ctrl+F` / `Ctrl+H`;
- **Recent files**: `Ctrl+E`.

### Navigation history

| Action | Shortcut |
|---|---|
| Back | `Ctrl+Alt+Left` |
| Forward | `Ctrl+Alt+Right` |
| Last edit location | `Ctrl+Shift+Backspace` |
| Reopen closed tab | `Ctrl+Shift+Alt+T` |
| Next / previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` |

### Problems panel

`Alt+0` opens the Problems panel (errors / warnings). Diagnostic navigation:

- `F8` next problem;
- `Shift+F8` previous problem.

### Bookmarks and local history

| Action | Shortcut |
|---|---|
| Toggle bookmark | `Ctrl+F11` |
| Bookmark list | `Ctrl+Shift+F11` |
| Local history | `Ctrl+Shift+H` |

**Local history** snapshots on every save, so you can diff and roll back. **Bookmarks** persist with the workspace.

---

## Version Control

Git integration covers everyday and advanced workflows. Entry points: the **Git top-level menu**, the "Git" sidebar view, and the command palette (search `Git:`).

### Basics

| Action | Description |
|---|---|
| Initialize repository | `git init` in the current directory |
| Stage all | stage all changes |
| Discard all changes | discard all changes |
| Commit | Write a message in the sidebar commit box and commit |
| Commit all | Stage and commit in one step |

### Sync and remotes

- **Sync submenu**: fetch / pull / push;
- **Clone repository**: **File → Clone Repository**, with an optional default branch.

### Branches and history

- **Switch branch**: branch list;
- **Commit history**: history panel for viewing and right-click actions;
- **Advanced workflows**: cherry-pick, reset, rebase, worktree, and more (worktree supports list / add / remove);
- **Blame**: per-line authorship.

### Stash

- **Stash changes**;
- **Pop stash**.

---

## Database Tools

A built-in SQLite tool window (backed by Rust's bundled rusqlite, opened read-only by default).

- **Database sidebar view**: manage connections and browse table structures;
- **Query tab**: write and run SQL in an editor tab, with results rendered as a table;
- **Command palette**: `Database: New Connection`, `Database: New Query`.

> Databases open read-only by default to prevent accidental writes. SQL result row order is stable (sorted with a tiebreaker key).

---

## Developer Toolbox

`Ctrl+Shift+T` opens the developer tools panel; you can also pick by category from the **Tools** menu or search "Tool:" in the command palette.

### Built-in tools

| Category | Tools |
|---|---|
| Encoding | Base64 encode/decode · URL encode/decode · HTML entity encode/decode · Unicode ⇄ plain text · Radix conversion |
| Text | Case / naming style · Sort and dedupe lines · Word count · Text diff |
| JSON | JSON beautify/minify · JSONPath extractor · JSON → Python model |
| Regex and format | Regex tester · Format string preview · Selector tester |
| Generation and digests | MD5 / SHA-256 · UUID generator · Password generator · Timestamp converter · Color converter |
| Network | HTTP request · cURL ⇄ Python |

### HTTP request tool

A built-in HTTP client: build a request, send it, and inspect the response (status, headers, body). Responses can be **forwarded to other tools** for further processing (for example, sending a body into the JSON tool or the cURL converter), closing the loop with observability on both ends of a single request.

### Toolbox and plugins

Tools are registry-driven: built-in tools and **tools registered by plugins** appear uniformly in the panel, the menus, and the command palette, and refresh automatically after a plugin hot reload.

---

## Runtime Insights

This is what sets OpenCharm apart from ordinary editors: it samples types and structures **during actual runs**, then uses them to enhance completion, hover, and signature help.

### Runtime sampling (probe)

While a script runs, the probe uses PEP 669 `sys.monitoring` with a **discovery window + local events + downsampling** strategy and writes runtime observations into a SQLite trace database. Principles:

- Observations record only **compact type representations** (such as `dict[str, int]`) and structural fingerprints — **never actual values**;
- Sampling overhead is bounded by a hard budget (< 1.5x);
- Probe failures only log warnings and never rewrite the user process exit code;
- With `OPENCHARM_PROBE_AUTOSTART=1` unset, there is zero interference.

### Runtime completion and hints (intel)

The runtime intelligence LSP (`opencharm-intel`) opens the trace database read-only to build an index, providing completion, navigation, hover, and signature help. Notes:

- Data comes from real runs, so **code paths that never ran have no runtime observations**;
- Fresh observations override stale ones (with a down-weighting policy);
- It merges with the static engine in the four-layer scheme, with the runtime layer above the static layer.

> Boundary: runtime completion accuracy is measured against our own sample set, and **no side-by-side comparison against PyCharm has been performed**. Any comparative claim must be scoped to "our own sample set".

### Runtime hotspots view

The "Runtime" sidebar view shows run hotspots. The lower half lists code that was **not observed running** — note this means "not observed this time", **not dead code**.

### Performance mode (Profiler)

The built-in profiler is offered as a "performance mode" and is **off by default**, enabled explicitly when needed. Once enabled, a time-cost view helps you locate hot functions.

### Endpoints view

FastAPI / Flask projects automatically get an "Endpoints" view listing route endpoints, with jump-to-definition, request samples, and reverse jumps between a handler and its route (CodeLens). The OpenAPI panel previews the API definition.

---

## Environments and Dependencies

### Python interpreters and virtual environments

- The status bar interpreter area switches Python environments quickly;
- Create a `.venv`, or choose the system interpreter or a uv-managed interpreter;
- A guided setup appears when an environment is missing (one-click install).

### Dependency management

Every "install" button in OpenCharm uses **uv** under the hood. Quick reference:

| pip habit | OpenCharm recommended | Notes |
|---|---|---|
| `pip install requests` | `uv add requests` | Writes the pyproject declaration + updates uv.lock |
| `pip install requests` (no declaration) | `uv pip install requests` | Same syntax as pip, faster |
| `pip install -r requirements.txt` | `uv pip install -r requirements.txt` | Compatible with older projects |
| `pip list --outdated` | `uv pip list --outdated` | List outdated packages |
| `python main.py` | `uv run main.py` | Syncs the environment from the declaration automatically |

> You can still type pip in the terminal; it is just slower and does not write declarations.

### Dependency health

- **Health check**: analyzes dependency style and consistency between declarations and installed packages;
- **Fix actions**: one-click fixes for automatically fixable problems;
- **Ignore list**: mark known-acceptable problems as ignored;
- **Entry points**: the status bar health icon and the Dependency Health sidebar view.

### Storage and disk

**Settings → Storage** shows usage statistics and lets you clean up the trace database, WebView cache, and uv cache, plus migrate data and see the first-run location prompt.

---

## Projects and Files

### Create and clone

| Entry point | Description |
|---|---|
| File → New Project | Create from scratch (Git init, environment type, Python version) |
| File → Clone Repository | Clone from a remote (optional default branch) |
| File → Open Workspace | Open an existing directory |
| File → Open Workspace in New Window | Multi-window parallel development |

### File tree operations

- Create file / folder, rename, delete (with confirmation);
- Drag to move, drag in from outside to import;
- Right-click menu: open in terminal, copy path, and more;
- Click to select (focus stays in the tree for keyboard roaming), double-click to open.

### File types and how they open

| Type | How it opens |
|---|---|
| `.py` and other text | Editor tab |
| `.md` | Markdown preview tab (changeable to edit or split in Settings; "Edit Source" promotes it to an editor tab) |
| `.csv` | CSV data viewer (prefix read + paging for large files; "Edit as Text" or open externally) |
| `.xlsx` / `.docx` / `.pdf` and similar | Opened externally with the system default application |

### Markdown preview

- `Ctrl+Shift+V` toggles the split preview in the editor;
- The preview tab is read-only and supports GFM tables, task lists, strikethrough, and code highlighting;
- Supports anchor jumps, relative `.md` links, and opening external links in the system browser;
- **Export HTML**: produces a self-contained single file (images inlined as base64, fixed light theme).

### Saving and drafts

`Ctrl+S` saves; autosave is configurable. Session snapshots (open tabs, cursor positions, unsaved drafts) persist with the workspace and are restored after a restart.

---

## Plugin System

The toolbox can be extended through plugins. A plugin is an **independent package** that does not intrude on the shell core.

### Using plugins

Under **Settings → Plugins** you can:

- View the real plugin directory path (copy / open it);
- Create a plugin (scaffolds a template that hot-reloads into the app once written);
- Import / export plugin packages (zip distribution);
- Inspect each plugin's metadata, permissions, registered tools, and logs;
- Enable / disable / reload.

Tools registered by plugins appear in the **Tools menu**, the **developer tools panel**, and the **command palette** (prefixed with "Tool: …"). Plugins also support **inline transforms**: with text selected, run them from the editor right-click menu under "Transform Selection ▸".

### Developing plugins

Click **Author Guide (Plugin Development)** (Help menu or the Plugins tab) for the manifest format, host API, kit building blocks, and hot reload documentation.

---

## Personalization

**Settings** is reachable from `Ctrl+Alt+S`, the gear button in the title bar, or **File → Preferences → Settings**.

Settings are organized into 12 categories:

| Category | Main content |
|---|---|
| Appearance | Theme (dark / light), language (简体中文 / English, applied instantly), font size, font family |
| Editor | Indentation, tabs, Markdown open mode, Pydantic construction checks, and more |
| Keybindings | View and customize every keybinding (grouped by function) |
| Save | Autosave policy |
| Python Runtime | Interpreter, static engine (pyrefly / basedpyright), and more |
| Live Templates | Template management |
| Terminal | Terminal shell options |
| Database | SQLite tool options |
| HTTP Request | HTTP tool options |
| Logging | Log level, retention count, stdout output |
| Storage | Usage statistics, cache cleanup, data migration |
| Plugins | Plugin management |

### Theme and font

Switch between dark and light themes in one click; the Monaco editor theme follows. The factory monospace font is JetBrains Mono (bundled with the app, no extra installation).

### Language

Simplified Chinese by default; switch to English under **Appearance → Language**. The UI and built-in strings switch instantly, with no restart required. (This help document also follows the interface language.)

---

## Keyboard Shortcuts

> These are factory defaults and can all be customized under **Settings → Keybindings**.

### Files and tabs

| Shortcut | Action |
|---|---|
| `Ctrl+S` | Save |
| `Ctrl+Alt+Insert` | New file |
| `Ctrl+F4` | Close tab |
| `Ctrl+Shift+Alt+T` | Reopen closed tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+E` | Recent files |
| `Ctrl+Alt+S` | Open settings |

### Editing

| Shortcut | Action |
|---|---|
| `Ctrl+/` | Toggle line comment |
| `Ctrl+Shift+/` | Toggle block comment |
| `Ctrl+D` | Duplicate line / selection |
| `Ctrl+Y` | Delete line |
| `Ctrl+Shift+↑` / `Ctrl+Shift+↓` | Move line / selection up / down |
| `Ctrl+W` / `Ctrl+Shift+W` | Expand / shrink selection |
| `Alt+Shift+Insert` | Toggle column selection mode |
| `Ctrl+Shift+-` / `Ctrl+Shift+=` | Fold / unfold all |
| `Ctrl+Shift+\` | Jump to matching bracket |
| `Shift+Alt+F` | Format document |
| `Ctrl+Alt+O` | Optimize Imports |
| `Ctrl+\` | Split editor right |

### Code intelligence

| Shortcut | Action |
|---|---|
| `Ctrl+B` | Go to definition (same as `F12` / `Ctrl+click`) |
| `Alt+F7` | Find usages |
| `Shift+F6` | Rename symbol (same as `F2`) |
| `Ctrl+F12` | Go to symbol in file |
| `Alt+/` | Trigger completion suggestions |
| `Tab` | Accept suggestion (replace mode) |
| `Ctrl+J` | Live Templates palette |
| `Ctrl+Alt+T` | Surround with template |
| `Ctrl+Shift+J` | Show all templates |
| `Ctrl+Alt+R` | Open in regex tester |

### Navigation and search

| Shortcut | Action |
|---|---|
| Double-tap `Shift` | Search Everywhere |
| `Ctrl+Shift+N` | Go to file |
| `Ctrl+G` | Go to line / column |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+Shift+F` | Global search |
| `Ctrl+F` / `Ctrl+H` | Find / replace |
| `Ctrl+Alt+Left` / `Ctrl+Alt+Right` | Back / forward |
| `Ctrl+Shift+Backspace` | Last edit location |
| `F8` / `Shift+F8` | Next / previous problem |
| `Alt+0` | Open Problems panel |
| `Ctrl+F11` / `Ctrl+Shift+F11` | Toggle bookmark / bookmark list |
| `Ctrl+Shift+H` | Local history |

### Run and debug

| Shortcut | Action |
|---|---|
| `Ctrl+F10` | Run script |
| `Ctrl+Shift+F10` | Run project |
| `Ctrl+F2` | Stop running |
| `Alt+Shift+E` | Run selection / line |
| `Ctrl+Enter` | Run cell |
| `Ctrl+Shift+R` | Run history |
| `F5` | Start debugging / continue |
| `Shift+F5` | Stop debugging |
| `F10` / `F11` / `Shift+F11` | Step over / into / out |
| `Alt+F9` | Run to cursor |
| `Alt+F8` | Evaluate expression |
| `Ctrl+Alt+Shift+Insert` | New scratch file |

### Panels and views

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+F12` | Toggle sidebar |
| `Alt+F12` | Toggle bottom panel |
| `Ctrl+Shift+T` | Developer tools panel |
| `Ctrl+Shift+V` | Markdown preview |

---

## FAQ

**Q: `Ctrl+Space` does not open completion with a Chinese IME.**
Chinese IMEs swallow `Ctrl+Space` (a system-level conflict). Use `Alt+/` to trigger suggestions.

**Q: Where does data live on first launch?**
**Help → Open Data Directory** takes you there. Settings, caches, logs, and the trace database all live inside; a first-run prompt shows the location.

**Q: What happens if uv is missing?**
A toolchain setup prompt appears on first use, offering one-click installation of uv and the static engine. You can still edit code without it, but package and environment management will be unavailable.

**Q: Can I just use pip in the terminal?**
Yes, it works. But `uv add` / `uv pip install` are recommended — faster, and `uv add` writes the project declaration.

**Q: How do I get back to the welcome page / getting-started guide?**
**Help → Welcome Page** (always available); **Help → Getting Started** opens the three-minute guide.

**Q: Why does runtime completion show no candidates?**
Runtime data comes from **actual run sampling** — code paths that have not run have no observations. Run the script once, then return to the editor.

**Q: The hotspots view says "not observed running" — is that dead code?**
No. It only means **not observed this time**, not that the code never executes.

**Q: Why does a Markdown file open in preview instead of the editor?**
Preview is the default. Change it under **Settings → Editor → Markdown open mode** to edit or split; the preview tab also has an "Edit Source" button.

**Q: How do I turn off a static diagnostic I do not want?**
Some diagnostics (such as Pydantic construction checks) can be disabled under **Settings → Editor**; Ruff hints support `# noqa` suppression.

**Q: Can I change the shortcuts?**
Yes. **Settings → Keybindings** lists every binding grouped by function, and each can be customized.

---

## Data Directory and Logs

### Data directory

**Help → Open Data Directory** opens the data root, which contains:

- `settings.json`: application settings;
- `logs/`: logs;
- `docs/`: documents written by the app (including this help document, the getting-started guide, and the plugin author guide);
- `traces/`: runtime trace databases (named by project hash);
- `plugins/`: plugin directory;
- `runtime/`: runtime location for first-party components and the debugger.

### Logs

The unified logging tool is configurable under **Settings → Logging**:

| Field | Default | Description |
|---|---|---|
| Enable logging | on | Master switch (when off, only `error` is written) |
| Log level | `info` | `error` / `warn` / `info` / `debug` |
| Retention count | 3 | Rotates when a file exceeds 1 MiB |
| Output to stdout | off | Whether to also write to standard output |

To troubleshoot, raise the level to `debug`, or use **Help → Open Log Directory** to locate the log file directly. The log file lives at a fixed path under the user home directory: `~/.opencharm/logs/opencharm.log`.

### Privacy

- Runtime sampling records **only type labels and structural fingerprints, never actual values**;
- All data is stored locally in the user directory by default and is never uploaded;
- Telemetry and network requests happen only when you take an action (such as the HTTP tool, Git remotes, or cloning).

---

## About

**Help → About OpenCharm** shows the version.

To report issues or suggestions, use the project repository's issue tracker.
