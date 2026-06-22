# 🛸 Antigravity Super Sentinel — The Story & Documentation

> **Version**: 2.0.0  
> **Author**: Kadzura (IKadzura)  
> **First Release**: June 2026  
> **License**: MIT

---

## 📖 What Is This Extension?

**Antigravity Super Sentinel** is a real-time agents monitoring utility dashboard and auto-clicker built exclusively for the **Google Antigravity IDE** (a VS Code-based AI coding IDE). It provides:

1. **Live Model Detection** — Accurately displays which AI model is active (Gemini, Claude, GPT-OSS, etc.)
2. **Quota Tracking** — Shows remaining usage fraction and reset countdown per model
3. **Auto-Clicker** — Automatically clicks approval/permission buttons in agent chat panels
4. **Auto-Scroll** — Keeps the chat panel scrolled to the latest content
5. **Cyberpunk Dashboard** — A glassmorphic sidebar panel with real-time telemetry

---

## 🏗️ Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    Antigravity IDE (Electron)                │
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐ │
│  │ workbench    │   │  Extension   │   │  Sidebar Panel   │ │
│  │ .html        │   │  Host (Node) │   │  (WebviewView)   │ │
│  │              │   │              │   │                  │ │
│  │ autoScript   │   │ extension.js │──▶│ settingsHtml.js  │ │
│  │ .js (inject) │   │              │   │ (Dashboard UI)   │ │
│  └──────┬───────┘   └──────┬───────┘   └──────────────────┘ │
│         │                  │                                 │
│         │    ┌─────────────┼──────────────┐                  │
│         │    │             │              │                  │
│         ▼    ▼             ▼              ▼                  │
│  ┌────────┐ ┌──────────┐ ┌────────────┐ ┌────────────────┐  │
│  │ DOM    │ │ LSP      │ │ SQLite DB  │ │ Transcript     │  │
│  │ Click  │ │ gRPC/    │ │ state.vscdb│ │ transcript     │  │
│  │ Events │ │ HTTP API │ │ (protobuf) │ │ .jsonl         │  │
│  └────────┘ └──────────┘ └──────────┬─┘ └────────────────┘  │
│                                     │                        │
│                          ┌──────────▼────────────┐           │
│                          │ query_model_info.py   │           │
│                          │ (Python protobuf      │           │
│                          │  decoder)             │           │
│                          └───────────────────────┘           │
└──────────────────────────────────────────────────────────────┘
```

---

## 📁 File Structure

```
antigravity-super-sentinel/
├── docs/
│   └── the_story_and_documentation.md   ← You are here
├── media/
│   ├── autoScript.js      ← Client-side injected script (runs in renderer)
│   ├── icon.png            ← Extension icon (PNG for marketplace)
│   └── icon.svg            ← Extension icon (SVG for activity bar)
├── src/
│   ├── extension.js        ← Main extension logic (runs in Node.js Extension Host)
│   ├── query_model_info.py ← Python script to decode SQLite protobuf preferences
│   └── settingsHtml.js     ← Generates the full HTML for the sidebar Webview dashboard
├── .gitignore
├── .vscodeignore            ← Files excluded from VSIX package
├── LICENSE
├── README.md
├── package.json             ← Extension manifest (v2.0.0)
└── kadzura-super-sentinel-logo.png  ← High-res logo (excluded from VSIX)
```

---

## 🔧 Technology Stack

### Runtime Environment
| Component | Technology | Purpose |
|---|---|---|
| **IDE** | Google Antigravity IDE (Electron + VS Code base) | Host platform |
| **Extension Host** | Node.js (bundled with IDE) | Runs `extension.js` server-side |
| **Renderer Process** | Chromium (Electron) | Runs `autoScript.js` client-side |
| **Webview Panel** | HTML + CSS + Vanilla JS (WebviewView API) | Dashboard sidebar |
| **SQLite Decoder** | Python 3 (system-installed) | Decodes protobuf blobs from `state.vscdb` |

### Key Node.js APIs Used
| Module | Usage |
|---|---|
| `vscode` | Extension API — status bar, commands, webview, file watchers |
| `fs` | File system reads/writes (transcript, state, workbench.html) |
| `path` | Cross-platform path resolution |
| `http` / `https` | POST requests to local LSP Language Server gRPC endpoint |
| `crypto` | SHA-256 checksums for `product.json` integrity bypass |
| `child_process.execSync` | Shell commands (`ps`, `lsof`, `ss`, `netstat`, PowerShell, Python) |

### Key VS Code Extension APIs Used
| API | Usage |
|---|---|
| `vscode.window.createStatusBarItem()` | Status bar pill showing model + quota |
| `vscode.window.registerWebviewViewProvider()` | Sidebar dashboard panel |
| `vscode.workspace.onDidChangeConfiguration()` | React to settings changes |
| `vscode.commands.registerCommand()` | Enable, Disable, Toggle, DumpConfig, OpenSettings |
| `vscode.env.remoteName` | Detect WSL/SSH remote sessions |
| `vscode.env.appRoot` | Locate `workbench.html` for script injection |
| `fs.watch()` | Real-time watchers on `state.vscdb` and `transcript.jsonl` |

---

## 🧠 Core Systems Deep Dive

### 1. Model Detection — The Most Critical System

This is the heart of the extension. Detecting which AI model is currently active requires **three data sources** and a strict priority chain:

```
Priority 1: Transcript (transcript.jsonl)
   ↓ falls back to
Priority 2: SQLite Database (state.vscdb via Python protobuf decoder)
   ↓ falls back to
Priority 3: First model in LSP response list
```

> [!IMPORTANT]
> **The V1 lesson**: Never prioritize SQLite over transcript. SQLite stores persistent user 
> preferences but updates are delayed (especially in WSL where `drvfs` mount caches file 
> metadata). The transcript captures real-time "Model Selection" events the instant the user 
> changes models in the chat dropdown.

#### Source 1: Transcript Parsing

The extension finds the **most recently modified** `transcript.jsonl` file under:
```
~/.gemini/antigravity-ide/brain/<session-id>/.system_generated/logs/transcript.jsonl
```

Each line is a JSON object. The extension scans for lines containing `"Model Selection"` and extracts the "to" model name:

```
Model Selection` from Claude Sonnet 4.6 (Thinking) to Claude Opus 4.6 (Thinking).
```

Regex used:
```javascript
/Model Selection[`'"\\]*\s+from\s+(.*?)\s+to\s+(.*?)(?:\.\s|\n|<|$)/i
```

The **last** match in the file is the current active model. Matching against LSP `modelsList` is done **by `.name`** (display label).

#### Source 2: SQLite + Protobuf Decoder

The IDE stores user preferences in a SQLite database (`state.vscdb`). The active model preference is stored as a **Protocol Buffers blob** inside a `vscdb` key.

The Python script `query_model_info.py`:
1. Opens `state.vscdb` (copies to temp file first to avoid locking)
2. Queries for the `cascadeModelSelection` key
3. Decodes the protobuf binary blob (hand-written varint parser, no protobuf library needed)
4. Extracts `activeModelId` (the model's internal ID, e.g. `gemini-2.5-flash-thinking-preview-06-06`)
5. Returns JSON with both `activeModel` (display name) and `activeModelId` (internal ID)

SQLite matching uses **model ID** (`m.id`), not display name, because:
- The ID is the stable internal identifier
- Display names can vary between LSP responses and DB entries

#### Source 3: LSP Language Server HTTP API

The extension discovers the running Go Language Server process and communicates via JSON-RPC over HTTP:

1. **Process Discovery**: Scans running processes for `language_server` binaries
   - Linux: `ps -ef | grep language_server`
   - Windows: `Get-CimInstance Win32_Process` via PowerShell
   - WSL: Falls back to `powershell.exe` to query Windows-side processes
   
2. **CSRF Token Extraction**: Parses `--csrf_token` from the process command line
   
3. **Port Discovery**: Finds listening ports for each PID
   - Linux: `lsof -nP -iTCP -sTCP:LISTEN -a -p <PID>` (fallback: `ss -lntp`)
   - Windows: `netstat -ano`
   - WSL: `netstat.exe -ano` (calls Windows netstat from WSL)

4. **API Call**: POST to `http(s)://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/GetUserStatus`

Response provides:
- `userStatus.email` — User account
- `userStatus.userTier.name` — Plan tier (Free/Premium)
- `userStatus.cascadeModelConfigData.clientModelConfigs[]` — All available models with:
  - `.label` — Display name
  - `.modelOrAlias.model` — Internal model ID
  - `.quotaInfo.remainingFraction` — Quota remaining (0.0–1.0)
  - `.quotaInfo.resetTime` — ISO timestamp when quota resets

### 2. Auto-Clicker System (`autoScript.js`)

The auto-clicker runs **inside the Electron renderer process**, injected into `workbench.html` via a `<script>` tag. It operates in a completely separate context from the Extension Host.

#### Injection Mechanism

1. Extension locates `workbench.html` in `vscode.env.appRoot`
2. Reads the template from `media/autoScript.js`
3. Interpolates the workbench directory path (for state file access)
4. Writes the interpolated script to `ag-super-sentinel-script.js` alongside workbench.html
5. Injects a `<script src="...">` tag before `</body>` in workbench.html
6. Recalculates SHA-256 checksums in `product.json` to suppress "corrupt installation" warnings
7. Clears V8 code cache to force Electron to recompile modified files

#### Click Logic

Every 1 second (configurable), the script:

1. Scans the DOM for clickable elements (`button`, `[role="button"]`, etc.)
2. Normalizes button text (strips keyboard shortcut suffixes like `Alt+A`)
3. Matches against configurable patterns: `["Allow", "Always Allow", "Retry", ...]`
4. **Safety guards**:
   - Skips editor merge/diff areas
   - Skips VS Code activity bar and status bar
   - Skips `"Accept Changes"` (editor merge actions)
   - Only clicks if button is inside the Agent panel **OR** has a Deny/Reject sibling
5. **Selective mode**: Classifies prompts by category (browser, command, files, planning) and respects per-category allow/deny settings
6. Records click statistics and logs to a JSON state file

#### Scroll Logic

Every 500ms (configurable), the script:

1. Monitors the chat panel for DOM mutations (new content)
2. If content activity detected and no manual scroll interrupt:
   - Finds the deepest scrollable container in the agent panel
   - Scrolls to bottom
   - Also clicks any "Jump to Bottom" floating button
3. Pauses auto-scroll for 7 seconds (configurable) after manual user scroll

#### Communication Architecture

The auto-clicker and Extension Host communicate via a **shared JSON state file** on disk:

```
<workbench-dir>/ag-super-sentinel-state.json
```

- **Extension Host writes**: enabled/disabled, scroll settings, click patterns, allow mode
- **Auto-clicker reads**: Polls the file every 2 seconds for config changes
- **Auto-clicker writes**: Click statistics, click logs, total click count
- **Extension Host reads**: Picks up stats for dashboard display

This file-based approach is used because the renderer script has no direct access to the VS Code extension API.

### 3. Dashboard Sidebar (`settingsHtml.js`)

The dashboard is a single-page HTML application built by `settingsHtml.js` as a template literal. It uses:

- **Pure CSS** with CSS custom properties (no framework)
- **Glassmorphism** design with `backdrop-filter: blur()` and translucent panels
- **Neon cyberpunk palette**: Deep purple-black base, pink/purple accents, emerald green indicators
- **Micro-animations**: Pulse effects, gradient text, hover transitions
- **postMessage API**: Real-time bidirectional communication with Extension Host

Dashboard sections:
1. **Overwatch HQ** — Model name, email, plan tier
2. **Quota Gauge** — Visual arc/bar showing remaining quota with color coding
3. **Models Grid** — All available models with quota bars and reset countdowns
4. **Steps Timeline** — Live execution step hierarchy with tool call summaries
5. **Auto-Clicker Controls** — Toggle, selective permissions, click patterns
6. **Auto-Scroll Controls** — Toggle, timing configuration
7. **Skills Registry** — Lists installed Gemini skills
8. **MCP Servers** — Lists configured MCP server integrations
9. **Browser Recordings** — Displays recent browser automation screenshots
10. **Click Statistics** — Click counts per pattern and activity log

### 4. Cross-Platform Support

The extension handles three OS environments with distinct strategies:

| Platform | Process Scanner | Port Scanner | DB Path | LSP Transport |
|---|---|---|---|---|
| **Linux Native** | `ps -ef \| grep` | `lsof` → `ss` fallback | `~/.config/Antigravity IDE/...` | HTTP/HTTPS to 127.0.0.1 |
| **Windows Native** | `Get-CimInstance` (PowerShell) | `netstat -ano` | `%APPDATA%\Antigravity IDE\...` | HTTP/HTTPS to 127.0.0.1 |
| **WSL Remote** | `ps -ef` → `powershell.exe` fallback | `netstat.exe` (Windows netstat from WSL) | `~/.antigravity-ide-server/data/...` | HTTP/HTTPS to 127.0.0.1 |

Key WSL considerations:
- The LSP server runs on **Windows**, but the extension runs in the **WSL Extension Host**
- DB path candidates include both Linux-native and WSL-mapped Windows paths
- File watchers on `drvfs` mounts (Windows → WSL) have kernel-cached `mtime`, so the extension enforces maximum cache age of 4 seconds
- Auto-clicker injection is **disabled** in remote mode (no `workbench.html` access)

---

## 📦 Building and Packaging

### Prerequisites

```bash
# Install vsce (VS Code Extension CLI)
npm install -g @vscode/vsce
```

### Build VSIX

```bash
cd antigravity-super-sentinel/
npx -y @vscode/vsce package --no-dependencies --allow-missing-repository
```

This produces `antigravity-super-sentinel-2.0.0.vsix`.

### Files included in VSIX

Only these files are packaged (controlled by `.vscodeignore`):

```
├── package.json
├── readme.md
├── LICENSE.txt
├── media/
│   ├── autoScript.js
│   ├── icon.png
│   └── icon.svg
└── src/
    ├── extension.js
    ├── query_model_info.py
    └── settingsHtml.js
```

### Install the Extension

```bash
# In Antigravity IDE:
# 1. Open Command Palette (Ctrl+Shift+P)
# 2. Run: "Extensions: Install from VSIX..."
# 3. Select the .vsix file
# 4. Reload Window
```

---

## 🔄 Data Flow Diagram

```
User changes model in chat dropdown
        │
        ▼
transcript.jsonl gets new line:
"Model Selection from X to Y"
        │
        ├──► fs.watch() on transcript.jsonl triggers syncOverwatchData()
        │
        ▼
gatherSentinelData() runs:
  1. Parse transcript → extract last "Model Selection to Y"
  2. Match Y against cachedLspData.modelsList by name → ✅ FOUND
  3. Set data.activeModel = matched model name
  4. Set data.activeModelRemainingFraction = matched quota
  5. Set data.activeModelExpiration = matched reset time
        │
        ├──► updateStatusBar() → "$(eye) Kadzura Super Sentinel : ACTIVE | Claude Opus 4.6 (Thinking) 85% (2h 30m)"
        │
        └──► postMessage to Webview → Dashboard updates model, quota gauge, highlights
```

```
Background poll (every 5 seconds):
  queryLsp() → POST to language_server → GetUserStatus
        │
        ▼
  mapLspData(response) → { email, plan, modelsList: [...] }
        │
        ▼
  cachedLspData = mapped data
        │
        └──► syncOverwatchData() → updates status bar + dashboard
```

---

## 🧪 Debugging Tips

### Check Current Active Model Detection

Use the command **"Antigravity Super Sentinel: Dump Config"** (`Ctrl+Shift+P` → `dumpConfig`) to see:
- Current workspace configuration values
- Whether the `google.antigravity` extension is loaded
- Extension exports if available

### Check LSP Communication

Manually inspect the LSP response by running this in a Node.js REPL:

```javascript
const http = require('http');
const payload = JSON.stringify({ metadata: { ideName: "vscode", extensionName: "vscode", ideVersion: "1.75.0", locale: "en" }});
const req = http.request({ hostname: '127.0.0.1', port: PORT, path: '/exa.language_server_pb.LanguageServerService/GetUserStatus', method: 'POST', headers: { 'Content-Type': 'application/json', 'x-codeium-csrf-token': CSRF_TOKEN, 'Authorization': `Basic ${CSRF_TOKEN}`, 'Content-Length': Buffer.byteLength(payload) }}, (res) => {
    let body = ''; res.on('data', c => body += c); res.on('end', () => console.log(JSON.parse(body)));
});
req.write(payload); req.end();
```

Replace `PORT` and `CSRF_TOKEN` with values from `ps -ef | grep language_server`.

### Check SQLite Model Preference

```bash
python3 src/query_model_info.py
# Or with explicit path:
python3 src/query_model_info.py ~/.antigravity-ide-server/data/User/globalStorage/state.vscdb
```

Output:
```json
{
  "activeModel": "Claude Opus 4.6 (Thinking)",
  "activeModelId": "claude-opus-4-6-thinking",
  "models": [...],
  "expiration": 1750598400,
  "remainingFraction": 0.85
}
```

---

## 💡 Lessons Learned (v1 → v2)

### ❌ What Went Wrong in v1.0.3 → v1.0.4

1. **SQLite was prioritized over Transcript** — SQLite stores the last *saved* preference, which can be stale. Transcript captures the *real-time* model switch event.

2. **SQLite matched by model NAME instead of ID** — Display names can differ between the DB blob and the LSP response. The internal model ID is the stable identifier.

3. **Aggressive debug logging** — `debugLog()` writing to a file on every poll cycle caused unnecessary I/O overhead and left debug artifacts in production.

4. **Auto-dump on startup** — Writing config to `/tmp` and showing a notification on every startup was development noise that leaked into production.

### ✅ What v2.0.0 Gets Right

1. **Transcript-first priority** — Real-time detection from the chat dropdown's "Model Selection" event
2. **SQLite ID-based fallback** — Matches by stable internal model ID (`m.id`), not display name
3. **Clean production code** — No debug logging, no temp file writes, no startup notifications
4. **Cross-platform preservation** — All Windows/WSL/Linux support from v1.0.4 is retained

### 🧠 Golden Rule for Future Development

> **Never change the model detection priority order without extensive testing across all models.**
> 
> The priority chain must always be:
> 1. Transcript (real-time, most accurate)
> 2. SQLite by model ID (persistent, fallback)
> 3. First model in LSP list (last resort)

---

## 📋 package.json Manifest Reference

```json
{
  "name": "antigravity-super-sentinel",
  "displayName": "Antigravity Super Sentinel",
  "version": "2.0.0",
  "publisher": "IKadzura",
  "extensionKind": ["workspace"],
  "activationEvents": ["onStartupFinished"],
  "main": "./src/extension.js"
}
```

Key manifest fields:
- **`extensionKind: ["workspace"]`** — Runs the extension on the remote machine in WSL/SSH mode (where the LSP and transcripts exist), not on the local UI client
- **`activationEvents: ["onStartupFinished"]`** — Activates after IDE fully loads, not on specific file types
- **`main`** — Points to the Node.js entry point (no bundler, no TypeScript compilation)

### Registered Commands

| Command ID | Title | Purpose |
|---|---|---|
| `antigravity-super-sentinel.enable` | Enable (Inject Script) | Inject auto-clicker into workbench.html |
| `antigravity-super-sentinel.disable` | Disable (Remove Script) | Remove injected script and cleanup |
| `antigravity-super-sentinel.toggle` | Toggle ON/OFF | Toggle auto-clicker enabled state |
| `antigravity-super-sentinel.openSettings` | Open Dashboard | Focus the sidebar panel |
| `antigravity-super-sentinel.dumpConfig` | Dump Config | Debug output of workspace configuration |

---

## 🎨 Design System

The dashboard CSS uses a curated cyberpunk neon palette:

```css
:root {
    --bg-base: #0c0817;        /* Deep cyberpunk purple-black */
    --bg-panel: rgba(26, 15, 46, 0.45);  /* Translucent neon-purple glass */
    --border-color: rgba(244, 114, 182, 0.18);  /* Glowy pinkish border */
    --text-primary: #fdf2f8;    /* Soft pink-white */
    --text-secondary: #d8b4fe;  /* Bright pastel purple */
    --color-blue: #a855f7;      /* Vibrant purple */
    --color-green: #10b981;     /* Emerald green */
    --color-yellow: #f59e0b;    /* Bright gold */
    --color-red: #ef4444;       /* Neon red */
    --color-rose: #f472b6;      /* Neon pink */
}
```

Design principles applied:
- **Glassmorphism**: `backdrop-filter: blur(16px)` with semi-transparent backgrounds
- **Neon accents**: Bright colored borders and text on dark backgrounds
- **Micro-animations**: Pulse effects on status indicators, smooth hover transitions
- **Grid layouts**: Responsive model cards using CSS Grid with `auto-fill` columns

---

## 🛡️ Security Considerations

1. **All data is local** — No network requests to external servers. The only HTTP calls go to `127.0.0.1` (local LSP)
2. **Script injection modifies workbench.html** — This triggers VS Code's "corrupt installation" warning, which is suppressed by recalculating `product.json` checksums
3. **Python subprocess** — `query_model_info.py` is executed via `execSync` with the DB path as argument. Only the bundled script is executed; no user input is passed to shell
4. **File permissions** — The extension reads/writes to the IDE's own data directories (`~/.config/Antigravity IDE/`, `~/.gemini/`)
5. **Auto-clicker safety** — Multiple guards prevent clicking outside the Agent chat panel, and selective mode allows per-category permission control

---

## 🚀 How to Create a Similar Extension From Scratch

### Step 1: Scaffold
```bash
mkdir my-extension && cd my-extension
```

Create `package.json` with extension manifest (see reference above).

### Step 2: Core Extension
Create `src/extension.js`:
- `activate(context)` — Entry point, register commands, status bar, webview provider
- `deactivate()` — Cleanup intervals and watchers

### Step 3: Data Sources
Identify your data sources:
- **Process scanning** → `child_process.execSync` with platform-specific commands
- **HTTP APIs** → `http`/`https` native modules
- **File parsing** → `fs.readFileSync` with `fs.watch` for real-time updates
- **SQLite** → External script (Python) since Node.js doesn't bundle SQLite natively

### Step 4: UI
Create your dashboard as a WebviewViewProvider:
- Generate HTML as a template literal in a separate module
- Use `postMessage` / `onDidReceiveMessage` for bidirectional communication
- Pure CSS with CSS custom properties for theming

### Step 5: Client-Side Scripts (Optional)
If you need to run code in the renderer process:
- Create a JS file in `media/`
- Inject via `workbench.html` modification
- Recalculate `product.json` checksums
- Clear V8 code cache

### Step 6: Package
```bash
npx -y @vscode/vsce package --no-dependencies --allow-missing-repository
```

### Step 7: Deploy
Install the `.vsix` directly in the IDE and reload window.

---

*Crafted with absolute architectural precision by Kadzura. June 2026.*
