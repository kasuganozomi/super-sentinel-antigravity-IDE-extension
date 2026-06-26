# Changelog

All notable changes to **Antigravity Super Sentinel** are documented here.

---

## [2.5.0] — 2026-06-26

### 🎯 Kombinasi Terbaik — Best-of-Both Architecture

This release is a deliberate architectural merge: the proven, fully-functional webview dashboard from `v2.2.0` combined with the lean, high-performance extension engine from `v2.4.x`.

### ✅ What Works Now (Fixed)
- **Tab navigation restored** — Radar, Skills/MCP, and Clicker tabs all respond to clicks. Root cause was a self-introduced CSP `nonce` that silently blocked all `onclick` handlers. Resolved by reverting to the v2.2.0 webview (no CSP meta tag).
- **Live dashboard** — Active model, context window gauge, model quota bars, and account info now update every 5 seconds in real-time parity with the status bar.
- **Context window gauge** — Correctly reads `estimatedTokens` from transcript character count and displays usage percentage.
- **Skills/MCP tab** — Shows active skills and MCP servers, loaded from the Antigravity config files.

### ⚡ Performance (Preserved from v2.4.x)
- **Zero IDE lag** — Removed all `execSync` calls to agentapi (the primary lag source in v2.2.0).
- **No subagents scanning** — Removed subagents tree tab and its associated heavy session enumeration.
- **Lean 5s poll** — `gatherSentinelData()` uses a 4-second TTL cache. Zero blocking on hot paths.
- **Transcript-based model detection** — Active model read from transcript events, not SQLite. Fast, reliable, no fallback drama.

### 🆕 New in v2.5.0
- **Skill copy format** — Copy Prompt button now copies in backtick format: `` `skill-name` ``.
- **"Copied!" indicator** — Button turns green with checkmark for 1.5s after copy.
- **Description truncation** — Skill card descriptions are limited to 3 lines (CSS `line-clamp`).
- **Reliable clipboard** — Switched from `navigator.clipboard` (unreliable in VS Code webview) to `vscode.env.clipboard` via `postMessage`.

### 🗑️ Removed
- **Subagents tab** — Removed entirely. Was dependent on heavy `execSync` agentapi calls that caused IDE stuttering.
- **CSP meta tag** — Removed the nonce-based CSP that was silently breaking tab onclick handlers.
- **`getNonce()`** — Removed unused nonce generator from extension.js.

---

## [2.4.x] — 2026-06 (Internal — Lean Rewrite)

- Rewrote extension.js for lean performance (removed agentapi execSync calls)
- Introduced transcript-based active model detection
- Improved status bar: live model name, quota %, reset countdown
- Introduced selective permission modes (All / Selective / Paused)
- Multi-account history cache
- ⚠️ Dashboard webview broken (tab onclick blocked by self-introduced CSP nonce)

---

## [2.2.0] — 2026-06 (Stable but Laggy)

- Fully functional dashboard (4 tabs: Radar, Subagents, Skills/MCP, Clicker)
- Live session telemetry, context window, quota bars
- ⚠️ Heavy lag caused by agentapi `execSync` for subagent tree enumeration
- ⚠️ Large `steps[]` array serialized into webview on every poll
- ⚠️ Status bar model detection used SQLite with multiple fallback layers
