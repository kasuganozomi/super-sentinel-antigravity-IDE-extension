# Antigravity Super Sentinel

<p align="center">
  <img src="https://img.shields.io/badge/version-2.2.1-purple.svg?style=for-the-badge&logo=visual-studio-code" alt="Version" />
  <img src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20WSL-blue.svg?style=for-the-badge" alt="Platform" />
  <img src="https://img.shields.io/badge/license-MIT-green.svg?style=for-the-badge" alt="License" />
  <img src="https://img.shields.io/badge/Built%20For-Antigravity%20IDE-orange.svg?style=for-the-badge" alt="Built For" />
</p>

---

## 🔮 Overview

**Antigravity Super Sentinel** is an ultra-premium agent dashboard utility designed specifically for the **Google Antigravity IDE**. Engineered to deliver a highly precise, luxurious developer dashboard and bypass validation bottlenecks, this extension provides direct telemetry metrics, auto-approval configurations, and seamless workflow automation.

---

## ✨ Features

*   **⚡ Zero-Lag Live Quota Telemetry**: Direct memory scanning of local Go Language Server (LSP) telemetry data (active models list, remaining quotas, and reset times).
*   **🤖 Auto-Approvals (Smart Clicker)**: Automatic prompt bypass injection directly into the IDE's main workbench window, avoiding confirmation delays.
*   **📊 Multi-Account Analytics Dashboard**: Premium sidebar showing session stats, token usage progress gauges, and detailed model quotas.
*   **🎨 Vibrant Status Bar Indicator**: Unified bottom-left status bar pill displaying active/paused state, active model, remaining quota percentage, and the countdown until reset.

---

## 💻 Supported Environments

| Platform | Extension Host OS | Client UI OS | Auto-Clicker Injection Target | Required Setup |
| :--- | :--- | :--- | :--- | :--- |
| **🐧 Linux Native** | Linux (e.g. Arch) | Linux (Native) | `/opt/antigravity-ide/resources/app/out/...` | Requires directory ownership |
| **🪟 Windows Native** | Windows | Windows (Native) | `%LOCALAPPDATA%/Programs/Antigravity IDE/...` | None (Automatic) |
| **🌐 WSL Remote** | Linux (WSL) | Windows (WSL Client) | `/mnt/c/Users/<user>/AppData/Local/Programs/Antigravity IDE/...` | None (Automatic via WSL mount) |

---

## ⚙️ Prerequisites & Setup Guide

Ensure the following prerequisites are installed based on your target system:

### 1. General Requirements
*   **Python 3** must be installed (used to run fallback database queries).
*   **lsof** utility (required on Linux/WSL for active LSP port scanning).

### 2. Environment Specific Installation Steps

#### 🐧 Linux Native
1. Install `lsof` tool via your package manager:
   ```bash
   sudo pacman -S lsof   # Arch Linux
   sudo apt install lsof # Debian/Ubuntu
   ```
2. Grant write permissions to the IDE installation directory so the clicker script can be injected:
   ```bash
   sudo chown -R $USER:$USER /opt/antigravity-ide
   ```

#### 🪟 Windows Native
1. Ensure Python 3 is installed and added to your system environment variables (`PATH`).
2. No extra commands are needed! The IDE installs directly into your user's AppData directory (`%LOCALAPPDATA%\Programs\Antigravity IDE`), allowing the extension to handle setup automatically.

#### 🌐 Windows via WSL (Remote - WSL)
1. Ensure Python 3 is installed inside your WSL instance.
2. The extension dynamically detects the WSL environment and automatically injects the clicker script into your Windows host's AppData path (`/mnt/c/Users/<user>/AppData/...`).
3. No manual folder ownership commands are required.

---

## 🛠️ Custom Skills Configuration

The extension scans for custom agent skills to display in the sidebar analytics. Place your custom skill folders in the paths listed below based on your active OS:

*   **🐧 Linux Native**: `~/.gemini/config/skills/`
*   **🪟 Windows Native**: `C:\Users\<user>\.gemini\config\skills\`
*   **🌐 WSL Remote**: `/home/<wsl-user>/.gemini/config/skills/` *(Place them inside the WSL filesystem)*

### Skill Folder Directory Structure
To be detected correctly, your skill must follow this layout:
```text
.gemini/
└── config/
    └── skills/
        └── my-custom-skill-folder/
            ├── SKILL.md        <-- Must contain name and description in frontmatter
            └── scripts/        <-- (Optional helper scripts)
```

#### Example `SKILL.md` Frontmatter:
```markdown
---
name: My Custom Agent Skill
description: Executing advanced code refactoring pipelines with precision.
---
# Instructions
Detail your skill's instructions here...
```

---

## 🎨 Technology Stack

*   **Extension Core**: Node.js & VS Code Extension API.
*   **Dashboard UI**: HTML, JS, and CSS with deep-dark glassmorphism, featuring a cyberpunk purple-pink theme.
*   **LSP Telemetry**: Process memory query via local HTTPS Basic Auth.

---
*Crafted by Kadzura with absolute precision and premium design metrics.*

---

## 📋 Changelog

### v2.2.1 — Performance Refactor (2026-06-25)

> **Critical performance fix.** This version eliminates the IDE lag caused by the extension.

- ♻️ **Replaced all `execSync` with non-blocking `execAsync`** — powershell, netstat, python subprocess, and agentapi calls no longer block the main thread.
- 🗄️ **Multi-layer TTL cache system** — `gatherSentinelData()` (4s), `isScriptInjected()` (10s), `getWorkbenchPath()` (60s), skills scan (60s), MCP config (30s).
- ⚡ **WSL path detection pinned** — computed once at startup, never repeated.
- 🔀 **Child session scan isolated** — moved to dedicated 30s async background interval (was blocking inline every 2–3s).
- 🔀 **SQLite refresh isolated** — moved to dedicated 8s async background interval.
- ⏱️ **Polling intervals extended** — LSP: 3s → 8s (with concurrency guard), Sidebar: 2s → 5s.
- 🧹 Removed `__metadata` residue from `package.json`.
- ➕ Added `keywords` field for Open VSX/Marketplace discoverability.

### v2.2.0
- Multi-account analytics and account cache saving.
- Child sub-session tracking via agentapi.
- Browser recording frames in dashboard.

### v2.1.x
- LSP telemetry via HTTPS/HTTP with CSRF token.
- SQLite model info fallback via Python script.
- Skills and MCP config scanning.

### v2.0.0
- Sidebar WebView dashboard.
- Status bar with active model, quota, and countdown display.
- State file watcher for real-time sync.
