# 🛸 Antigravity Super Sentinel

<div align="center">

[![Author](https://img.shields.io/badge/AUTHOR-IKADZURA-a855f7?style=for-the-badge&logo=github&logoColor=white)](https://github.com/kasuganozomi)
[![Style](https://img.shields.io/badge/STYLE-KADZURA%20STANDARD-f472b6?style=for-the-badge)](#🎨-style-philosophy)
[![Security](https://img.shields.io/badge/SECURITY-100%25%20LOCAL-10b981?style=for-the-badge)](#🚀-features)
[![Platform](https://img.shields.io/badge/PLATFORM-ANTIGRAVITY%20IDE-2563eb?style=for-the-badge)](#🛠️-prerequisites)

**An ultra-premium agents monitoring utility dashboard for Google Antigravity IDE.**

*Crafted by Kadzura with absolute architectural precision and sleek glassmorphic aesthetics.*

---

</div>

## 📖 Overview

**Antigravity Super Sentinel** is a luxurious, real-time analytics suite and permission-bypass clicker designed exclusively for the **Antigravity IDE**. It provides live model quota tracking, automated approval prompt bypasses, and multi-session telemetry visualization in a cyberpunk-themed interface.

---

## 🎨 Style Philosophy

- **Interface Aesthetics**: Designed to comply with the strict *Kadzura Standard of Excellence*. Features clean grid alignments, rich neon gradients, deep-dark glassmorphism, and smooth micro-animations.

---

## 🚀 Features

- **⚡ Zero-Lag Telemetry**: Instantly query local Go Language Server (LSP) memory to track active models, remaining quotas, and reset countdowns.
- **🦾 Smart Auto-Clicker**: Bypass safety prompts immediately via direct script injection into the main workbench framework, eliminating approval latency.
- **📊 Unified Status Bar Indicator**: A highly visible status bar pill displaying active model, remaining quota fractions, and relative reset countdowns.
- **💻 Deep-Dark Dashboard**: Access detailed step hierarchies, active skills registries, MCP configurations, and token usage estimates inside a dedicated sidebar panel.

---

## 🌐 Supported OS & Platforms

The Sentinel suite is engineered to run seamlessly across local and remote developer environments:

| Platform | Telemetry Strategy | Host Execution Scope |
| :--- | :--- | :--- |
| ![Linux Native](https://img.shields.io/badge/Linux_Native-Supported-e11d48?style=flat-square&logo=linux) | Direct socket memory parsing & file system transcripts scanning. | Native Local |
| ![Windows Native](https://img.shields.io/badge/Windows_Native-Supported-0078d4?style=flat-square&logo=windows) | PowerShell process query, netstat scanner, and SQLite queries. | Native Local |
| ![WSL Remote](https://img.shields.io/badge/WSL_Remote-Supported-3b82f6?style=flat-square&logo=linux) | Remote telemetry loop inside WSL mapped to local Windows AppData. | Windows-to-WSL Bridge |

---

## 🛠️ Prerequisites

Ensure these dependencies are configured in your development environment:

### Linux Native / WSL Remote
- ![Python 3](https://img.shields.io/badge/Python-3-3776AB?style=flat-square&logo=python&logoColor=white) — Used to decode protobuf preference stores.
- ![lsof](https://img.shields.io/badge/lsof-required-purple?style=flat-square) or ![ss](https://img.shields.io/badge/ss-fallback-blue?style=flat-square) — Used for telemetry port resolution.
- Command to install:
  ```bash
  # Arch Linux
  sudo pacman -S python lsof
  # Ubuntu / Debian
  sudo apt update && sudo apt install python3 lsof
  ```

### Windows Native
- ![Python 3](https://img.shields.io/badge/Python-3-3776AB?style=flat-square&logo=python&logoColor=white) — Verify "Add Python to PATH" is checked during setup.

---

## 📁 Source of Truth & Directory Mapping

To prevent filesystem cross-contamination, the Sentinel parses folders relative to the active extension host context:

### 1. ![Windows Native](https://img.shields.io/badge/MODE-WINDOWS_NATIVE-0078d4?style=for-the-badge&logo=windows)
* **Execution Host**: Local Windows Extension Host.
* **Paths & Directories**:
  * **Skills Registry**: `C:\Users\<Windows-User>\.gemini\config\skills\`
  * **Session Transcripts**: `C:\Users\<Windows-User>\.gemini\antigravity-ide\brain\`
  * **Settings SQLite Database**: `%APPDATA%\Antigravity IDE\User\globalStorage\state.vscdb`
* **How to Run**:
  1. Open Antigravity IDE on Windows.
  2. Install the compiled `.vsix` file.

### 2. ![WSL Remote](https://img.shields.io/badge/MODE-WSL_REMOTE-3b82f6?style=for-the-badge&logo=linux)
* **Execution Host**: Remote WSL/Linux Extension Host.
* **Paths & Directories**:
  * **Skills Registry**: `/home/<Linux-User>/.gemini/config/skills/` *(Inside WSL)*
  * **Session Transcripts**: `/home/<Linux-User>/.gemini/antigravity-ide/brain/` *(Inside WSL)*
  * **Settings SQLite Database**: `/home/<Linux-User>/.antigravity-ide-server/data/User/globalStorage/state.vscdb` *(Dynamically maps to the Windows client)*
* **How to Run**:
  1. Open your workspace inside a Remote WSL window in Antigravity IDE.
  2. Install the `.vsix` directly within the remote connection.

### 3. ![Linux Native](https://img.shields.io/badge/MODE-LINUX_NATIVE-e11d48?style=for-the-badge&logo=linux)
* **Execution Host**: Local Linux Extension Host.
* **Paths & Directories**:
  * **Skills Registry**: `/home/<Linux-User>/.gemini/config/skills/`
  * **Session Transcripts**: `/home/<Linux-User>/.gemini/antigravity-ide/brain/`
  * **Settings SQLite Database**: `/home/<Linux-User>/.config/Antigravity IDE/User/globalStorage/state.vscdb`
* **How to Run**:
  1. Open Antigravity IDE on Linux.
  2. Install the compiled `.vsix` file.

---

## ⚠️ Important Reminders & Troubleshooting

### ⚠️ CRITICAL PATH REMINDER
> [!WARNING]
> **Active Environment Skills Mapping Warning:**
> 
> Because file scanning is executed by the active Extension Host, the extension looks for configurations inside the OS where the host runs:
> - If you are in **WSL Remote mode**, the Sentinel scans folders inside your remote WSL instance (`/home/<Linux-User>/.gemini/config/skills/`), **NOT** your Windows host files.
> - Skills located in the Windows `.gemini` folder **will not show up** while in a WSL remote session. Make sure to sync your skills and config files to the active environment's `.gemini` directory!

### ![Troubleshoot](https://img.shields.io/badge/TROUBLESHOOT-workbench.html_not_found-yellow?style=for-the-badge&logo=alert)
> [!NOTE]
> **Why am I seeing `[Sentinel] workbench.html not found!` in WSL / Remote mode?**
> 
> In remote WSL/SSH architectures, the graphical user interface (`workbench.html`) is located on your local Windows machine while the extension's execution code runs on the remote headless server. Because the headless server contains no visual layout files, auto-clicker script injection is automatically skipped to prevent warnings.
> 
> **Resolution**: This warning is expected and completely safe to ignore. The status bar pill and live telemetry dashboard will function fully.

### ![Terminology](https://img.shields.io/badge/TERMINOLOGY-Workspace_Extension-blue?style=for-the-badge)
> [!IMPORTANT]
> The `"extensionKind": ["workspace"]` flag in `package.json` is a standard internal configuration of the extension framework. It does **not** limit the tool to a single local workspace folder; rather, it directs the IDE to run the extension host on the remote machine (where server logs and telemetry exist) instead of the local UI client.
