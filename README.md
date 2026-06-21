# Antigravity Super Sentinel

Agents Utility Dashboard for Google Antigravity IDE. Crafted by Kadzura with absolute precision and premium design metrics.

## Description

Engineered by Kadzura to deliver a highly precise, luxurious utility suite for advanced agent workflows. This extension provides direct visual analytics, automated permission handling, and live quota telemetry for the Antigravity IDE.

## Style Philosophy

- **Interface Aesthetics**: Kadzura sense of style standard.

## Features

- **Zero-Lag Live Quota Telemetry**: Direct memory scanning of local Go Language Server (LSP) telemetry data (active models list, remaining quotas, and reset times).
- **Auto-Approvals (Smart Clicker)**: Automatic prompt bypass injection directly into the IDE's main workbench window, avoiding confirmation delays.
- **Vibrant Status Bar Indicator**: Unified bottom-left status bar pill displaying active/paused state, active model, remaining quota percentage, and the countdown until reset.
- **Multi-Account Analytics Dashboard**: Premium sidebar showing session stats, token usage progress gauges, and detailed model quotas.

## Technology Stack

- **Extension Core**: Node.js & VS Code Extension API.
- **Dashboard UI**: Vanilla HTML, JS, and CSS with deep-dark glassmorphism, featuring a cyberpunk purple-pink theme.
- **LSP Telemetry**: Process memory query via local HTTPS Basic Auth.

## Prerequisites

- **Linux OS** (specifically Arch Linux).
- **Python 3** (database fallback queries).
- **lsof** utility (`sudo pacman -S lsof`).
- Write permissions on `/opt/antigravity-ide/` (`sudo chown -R $USER:$USER /opt/antigravity-ide`).
# super-sentinel-antigravity-IDE-extension
