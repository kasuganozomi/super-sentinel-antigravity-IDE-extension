# Antigravity Super Sentinel

<p align="center">
  <img src="https://img.shields.io/badge/version-2.5.0-purple.svg?style=for-the-badge&logo=visual-studio-code" alt="Version" />
  <img src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20WSL-blue.svg?style=for-the-badge" alt="Platform" />
  <img src="https://img.shields.io/badge/license-MIT-green.svg?style=for-the-badge" alt="License" />
  <img src="https://img.shields.io/badge/Built%20For-Antigravity%20IDE-orange.svg?style=for-the-badge" alt="Built For" />
</p>

---

## 🔮 Overview

**Antigravity Super Sentinel** is a precision agent dashboard and automation utility built specifically for the **Google Antigravity IDE**. It delivers a real-time telemetry sidebar, smart auto-approval workflows, and a zero-lag status bar — all without interrupting your agent session.

Engineered for **lean performance**: no stuttering, no IDE lag, no heavy background operations.

---

## ✨ Features

*   **⚡ Live Status Bar**: A bottom-left indicator showing the active model name, remaining quota percentage, and a countdown to reset — updated in real-time via transcript analysis. No SQLite, no heavy polling.
*   **🤖 Smart Auto-Clicker**: Automatic approval bypass injection into the IDE's workbench, with configurable click patterns, intervals, and selective permission modes (All / Selective / Paused).
*   **📊 Session Radar Dashboard**: Premium sidebar with:
    *   Active session status, session ID, and active model (live)
    *   Context window usage gauge with compaction warnings
    *   Full model quota list with remaining fraction bars and reset timers
    *   Account plan info and multi-account history cache
*   **🧠 Skills & MCP Inspector**: Browse all active skills and MCP servers. One-click copy of the skill activation prompt (backtick format) with a visual "Copied!" confirmation.
*   **🎛️ Clicker Config Panel**: Full control over click patterns, scroll behavior, intervals, and per-tool permission grants.

---

## 🚀 Installation

1.  Download the `.vsix` file from [Releases](https://github.com/kasuganozomi/super-sentinel-antigravity-IDE-extension/releases).
2.  In VS Code / Antigravity IDE: `Extensions` → `...` → `Install from VSIX...`
3.  Reload the window.
4.  The **Super Sentinel** icon will appear in the Activity Bar.

---

## 🖥️ Usage

### Status Bar
The status bar pill at the bottom-left updates automatically:
- Shows `ACTIVE` / `PAUSED` / `NOT INSTALLED` state
- Displays active model name and remaining quota %
- Shows countdown until quota resets (HH:MM:SS)

### Dashboard Tabs

| Tab | Description |
|-----|-------------|
| **Radar** | Live session metrics, context window, model list |
| **Skills/MCP** | Active skills and MCP servers with copy-prompt |
| **Clicker** | Auto-click configuration and activity log |

### Auto-Clicker Modes
- **All Permissions**: Auto-approve everything
- **Selective**: Choose which tool types to auto-approve (browser, command, files, planning)
- **Paused**: Disable all auto-approvals

---

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `antigravity-super-sentinel.enabled` | `true` | Master toggle for auto-click and auto-scroll |
| `antigravity-super-sentinel.scrollEnabled` | `true` | Toggle auto-scroll |

---

## 🏗️ Architecture

```
Extension Host (Node.js)
├── Status Bar        ← Lean 5s poll, transcript-based model detection
├── Webview Dashboard ← 5s poll via postMessage, zero blocking calls
├── Auto-Clicker      ← workbench.html injection with V8 cache clear
└── State             ← Lightweight JSON persistence
```

**Performance design:**
- Status bar reads transcript file directly — no SQLite, no network, no fallbacks
- Dashboard poll uses a 4s TTL cache — `gatherSentinelData()` never blocks the IDE
- No `execSync` on hot paths — all periodic work is non-blocking async

---

## 📋 Requirements

- Google Antigravity IDE (VS Code-based)
- Linux, Windows (with WSL), or macOS
- Antigravity agent session must be active for live telemetry

---

## 📄 License

MIT — see [LICENSE.txt](LICENSE.txt)
