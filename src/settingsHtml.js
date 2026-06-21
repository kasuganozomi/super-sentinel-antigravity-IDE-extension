module.exports = function buildSettingsHtml(data) {
    const isEnabled = data.enabled !== false;
    const isScrollEnabled = data.scrollEnabled !== false;
    const scrollPauseMs = data.scrollPauseMs || 7000;
    const clickIntervalMs = data.clickIntervalMs || 1000;
    const scrollIntervalMs = data.scrollIntervalMs || 500;
    const clickPatterns = data.clickPatterns || [];
    const totalClicks = data.totalClicks || 0;
    const clickLog = data.clickLog || [];
    const version = data.version || '1.0.0';

    // Selective permissions state
    const allowMode = data.allowMode || 'all'; 
    const selective = data.selectivePermissions || {
        browser: true,
        command: true,
        files: true,
        planning: true
    };

    const overwatch = data.overwatch || {
        sessionActive: false,
        sessionId: '',
        activeModel: 'Gemini 3.5 Flash (High)',
        activeModelExpiration: null,
        modelsList: [],
        stepsCount: 0,
        stepsLimit: 100,
        estimatedTokens: 0,
        contextLimit: 1000000,
        warningThreshold: 750000,
        steps: [],
        skills: [],
        mcpServers: [],
        browserFrames: [],
        childSessions: []
    };

    // Build pattern chips HTML
    const chipsHtml = clickPatterns.map(p => `
        <span class="chip" data-pattern="${p}">
            ${p}
            <span class="remove-chip" onclick="removePatternChip('${p}')">&times;</span>
        </span>
    `).join('');

    // Build log stream HTML
    const logItemsHtml = clickLog.map(log => `
        <div class="log-item">
            <span class="log-time">[${log.time || ''}]</span>
            <span class="log-bullet">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </span>
            <span class="log-text">Clicked <strong class="highlight-btn">${log.button || ''}</strong> (<span class="highlight-pat">"${log.pattern || ''}"</span>)</span>
        </div>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Antigravity Super Sentinel</title>
    <style>
        :root {
            --bg-base: #0c0817; /* Deep cyberpunk purple-black */
            --bg-sidebar: #05030a;
            --bg-panel: rgba(26, 15, 46, 0.45); /* Translucent neon-purple glass */
            --border-color: rgba(244, 114, 182, 0.18); /* Glowy pinkish border */
            
            --text-primary: #fdf2f8; /* Soft pink-white */
            --text-secondary: #d8b4fe; /* Bright pastel purple */
            --text-muted: #7c5b9e; /* Muted neon purple */
            
            --color-blue: #a855f7; /* Vibrant purple */
            --color-green: #10b981; /* Emerald green */
            --color-yellow: #f59e0b; /* Bright gold */
            --color-red: #ef4444; /* Neon red */
            --color-rose: #f472b6; /* Neon pink */
            
            --input-bg: rgba(5, 3, 10, 0.6);
            --input-border: rgba(244, 114, 182, 0.25);
            
            --font-stack: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--font-stack);
            background: var(--bg-base);
            color: var(--text-primary);
            padding: 10px;
            overflow-x: hidden;
            font-size: 12px;
            -webkit-font-smoothing: antialiased;
        }

        .container {
            width: 100%;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        /* macOS Window Titlebar and traffic lights */
        header {
            background: var(--bg-sidebar);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            padding: 10px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            position: relative;
        }

        .mac-traffic-lights {
            display: flex;
            gap: 6px;
            align-items: center;
        }

        .mac-dot {
            width: 9px;
            height: 9px;
            border-radius: 50%;
            display: inline-block;
        }

        .dot-close { background-color: var(--color-red); }
        .dot-minimize { background-color: var(--color-yellow); }
        .dot-expand { background-color: var(--color-green); }

        .title-group {
            text-align: right;
        }

        .title-group h1 {
            font-size: 13px;
            font-weight: 600;
            color: var(--text-primary);
            letter-spacing: -0.2px;
        }

        .title-group p {
            font-size: 9px;
            color: var(--text-secondary);
            margin-top: 1px;
            text-transform: uppercase;
            font-weight: 500;
            letter-spacing: 0.3px;
        }

        /* macOS Segmented Control Tabs */
        .tabs {
            display: flex;
            background: rgba(0, 0, 0, 0.25);
            padding: 2px;
            border-radius: 8px;
            border: 1px solid var(--border-color);
            gap: 1px;
        }

        .tab-btn {
            flex: 1;
            background: none;
            border: none;
            color: var(--text-secondary);
            font-size: 10px;
            font-weight: 500;
            padding: 6px 0;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.15s ease-in-out;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 3px;
        }

        .tab-btn svg {
            width: 13px;
            height: 13px;
        }

        .tab-btn:hover {
            color: var(--text-primary);
            background: rgba(255, 255, 255, 0.03);
        }

        .tab-btn.active {
            color: var(--text-primary);
            background: rgba(255, 255, 255, 0.08);
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
            font-weight: 600;
        }

        /* Tab Content */
        .tab-content {
            display: none;
            animation: fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .tab-content.active {
            display: block;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(4px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* Panels and Cards */
        .glass-panel {
            background: var(--bg-panel);
            backdrop-filter: blur(10px);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-bottom: 10px;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.4), 0 0 10px rgba(168, 85, 247, 0.05);
        }

        .panel-title {
            font-size: 10px;
            font-weight: 600;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 6px;
        }

        /* Pulse indicators */
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(52, 199, 89, 0.1);
            color: var(--color-green);
            padding: 3px 8px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 600;
            width: fit-content;
        }

        .status-badge.inactive {
            background: rgba(82, 82, 91, 0.2);
            color: var(--text-secondary);
        }

        .pulse-dot {
            width: 6px;
            height: 6px;
            background: currentColor;
            border-radius: 50%;
            box-shadow: 0 0 8px currentColor;
            animation: pulseGlow 1.8s infinite;
        }

        @keyframes pulseGlow {
            0% { opacity: 0.4; }
            50% { opacity: 1; }
            100% { opacity: 0.4; }
        }

        /* Context Token Progress Bar */
        .token-metric {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .metric-header {
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            color: var(--text-secondary);
        }

        .progress-bar-container {
            width: 100%;
            height: 8px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 4px;
            border: 1px solid var(--border-color);
            overflow: hidden;
            position: relative;
        }

        .progress-bar-fill {
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, var(--color-blue), var(--color-green));
            border-radius: 4px;
            transition: width 0.4s ease-out;
            box-shadow: 0 0 6px var(--color-blue);
        }

        .progress-bar-fill.warning {
            background: linear-gradient(90deg, var(--color-yellow), #f97316);
            box-shadow: 0 0 6px var(--color-yellow);
        }

        .progress-bar-fill.danger {
            background: var(--color-red);
            box-shadow: 0 0 8px var(--color-red);
        }

        /* Timeline stepper */
        .timeline {
            display: flex;
            flex-direction: column;
            gap: 6px;
            max-height: 250px;
            overflow-y: auto;
            padding-right: 4px;
        }

        .timeline-step {
            display: flex;
            gap: 8px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 8px;
        }

        .step-index-badge {
            background: rgba(255, 255, 255, 0.06);
            border-radius: 6px;
            width: 18px;
            height: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 9px;
            font-weight: bold;
            color: var(--text-secondary);
            flex-shrink: 0;
        }

        .step-details {
            display: flex;
            flex-direction: column;
            gap: 2px;
            flex: 1;
        }

        .step-title {
            font-weight: 600;
            font-size: 11px;
        }

        .step-meta {
            font-size: 9px;
            color: var(--text-secondary);
            display: flex;
            gap: 8px;
        }

        .step-status {
            font-weight: 500;
            text-transform: uppercase;
        }

        .step-status.done { color: var(--color-green); }
        .step-status.error { color: var(--color-red); }
        .step-status.pending { color: var(--color-yellow); }

        /* Stepper tree branches */
        .subagent-tree {
            padding-left: 10px;
            border-left: 1px dashed var(--border-color);
            margin-top: 4px;
            display: flex;
            flex-direction: column;
            gap: 5px;
        }

        .tree-node {
            display: flex;
            align-items: center;
            gap: 6px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 4px 8px;
            font-size: 11px;
        }

        /* Horizontal frame carousel */
        .recordings-carousel {
            display: flex;
            gap: 8px;
            overflow-x: auto;
            padding-bottom: 8px;
            scrollbar-width: thin;
        }

        .carousel-item {
            width: 120px;
            height: 80px;
            background: #000;
            border-radius: 6px;
            border: 1px solid var(--border-color);
            overflow: hidden;
            position: relative;
            flex-shrink: 0;
            cursor: pointer;
        }

        .carousel-item img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .carousel-item-time {
            position: absolute;
            bottom: 2px;
            right: 2px;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            font-size: 8px;
            padding: 1px 3px;
            border-radius: 3px;
        }

        .empty-visuals {
            text-align: center;
            color: var(--text-muted);
            padding: 20px 0;
            font-style: italic;
        }

        /* Lists & Grids */
        .skills-grid {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .skill-item {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 8px;
        }

        .skill-item h4 {
            font-size: 11px;
            font-weight: 600;
            color: var(--color-rose);
        }

        .skill-item p {
            font-size: 10px;
            color: var(--text-secondary);
            margin-top: 2px;
            line-height: 1.3;
        }

        .mcp-list {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .mcp-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 8px;
        }

        .mcp-item-name {
            font-weight: 600;
        }

        .mcp-item-cmd {
            font-size: 9px;
            color: var(--text-secondary);
            font-family: monospace;
            margin-top: 1px;
        }

        /* Switches and controls (Legacy Submenu) */
        .control-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
        }

        .control-info {
            flex: 1;
        }

        .control-info h4 {
            font-size: 11px;
            font-weight: 500;
        }

        .control-info p {
            font-size: 9px;
            color: var(--text-secondary);
            margin-top: 1px;
            line-height: 1.2;
        }

        /* macOS Switch sliders */
        .switch {
            position: relative;
            display: inline-block;
            width: 32px;
            height: 18px;
            flex-shrink: 0;
        }

        .switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }

        .slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(255, 255, 255, 0.08);
            transition: .15s;
            border-radius: 18px;
            border: 1px solid var(--border-color);
        }

        .slider:before {
            position: absolute;
            content: "";
            height: 12px;
            width: 12px;
            left: 2px;
            bottom: 2px;
            background-color: #fff;
            transition: .15s;
            border-radius: 50%;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        }

        input:checked + .slider {
            background-color: var(--color-green);
            border-color: rgba(52, 199, 89, 0.2);
        }

        input:checked + .slider:before {
            transform: translateX(14px);
        }

        /* Chip Input and Patterns styles */
        .chips-container {
            background: rgba(0, 0, 0, 0.15);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 8px;
            min-height: 50px;
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            align-content: flex-start;
            margin-bottom: 6px;
            max-height: 100px;
            overflow-y: auto;
        }

        .chip {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            padding: 2px 6px;
            border-radius: 8px;
            font-size: 9px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 3px;
        }

        .remove-chip {
            cursor: pointer;
            color: var(--text-secondary);
            font-weight: bold;
        }

        .remove-chip:hover {
            color: var(--color-red);
        }

        .add-pattern-row {
            display: flex;
            gap: 4px;
        }

        .add-pattern-row input {
            flex: 1;
            background: var(--input-bg);
            border: 1px solid var(--input-border);
            border-radius: 6px;
            padding: 5px 8px;
            color: var(--text-primary);
            font-family: inherit;
            outline: none;
            font-size: 10px;
        }

        .add-pattern-row input:focus {
            border-color: var(--color-blue);
        }

        /* Buttons */
        .btn-secondary {
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            padding: 5px 8px;
            border-radius: 6px;
            font-size: 10px;
            font-weight: 500;
            cursor: pointer;
        }

        .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.08);
        }

        .btn-primary {
            width: 100%;
            background: var(--color-blue);
            border: none;
            color: #ffffff;
            padding: 7px;
            border-radius: 6px;
            font-family: inherit;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            margin-top: 4px;
        }

        .btn-primary:hover {
            background: #0062cc;
        }

        /* Form slider metrics */
        .form-group {
            margin-bottom: 8px;
        }

        .form-group label {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 9px;
            font-weight: 500;
            color: var(--text-secondary);
            margin-bottom: 3px;
        }

        .form-group label span {
            color: var(--color-blue);
            font-weight: 600;
        }

        input[type="range"] {
            -webkit-appearance: none;
            width: 100%;
            height: 2px;
            background: rgba(255, 255, 255, 0.08);
            border-radius: 10px;
            outline: none;
        }

        input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #ffffff;
            cursor: pointer;
            box-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }

        /* Mode Selection Capsule style */
        .mode-selector {
            display: flex;
            background: rgba(0, 0, 0, 0.25);
            padding: 2px;
            border-radius: 6px;
            border: 1px solid var(--border-color);
            width: 100%;
        }

        .mode-btn {
            flex: 1;
            background: none;
            border: none;
            color: var(--text-secondary);
            font-size: 10px;
            font-weight: 500;
            padding: 5px;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .mode-btn.active {
            background: var(--color-blue);
            color: #fff;
            font-weight: 600;
        }

        .selective-panel-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding-top: 6px;
            border-top: 1px dashed var(--border-color);
        }

        /* Log console styling */
        .console-card {
            background: rgba(0, 0, 0, 0.25);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            font-family: -apple-system, BlinkMacSystemFont, monospace;
            padding: 6px;
            height: 180px;
            overflow-y: auto;
            font-size: 10px;
            color: var(--text-primary);
        }

        .console-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
        }

        .console-header h4 {
            font-size: 9px;
            font-weight: 600;
            color: var(--text-secondary);
            text-transform: uppercase;
        }

        .log-item {
            padding: 3px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.01);
            line-height: 1.3;
            display: flex;
            align-items: flex-start;
            gap: 4px;
        }

        .log-time {
            color: var(--text-secondary);
            white-space: nowrap;
        }

        .log-bullet {
            color: var(--color-blue);
            display: flex;
            align-items: center;
            justify-content: center;
            margin-top: 2px;
        }

        .log-text {
            color: #d1d1d6;
        }

        .highlight-btn {
            color: var(--color-blue);
            font-weight: 500;
        }

        .highlight-pat {
            color: var(--color-green);
        }

        .empty-logs {
            color: var(--text-muted);
            text-align: center;
            padding: 60px 0;
            font-style: italic;
        }

        /* Toast */
        .toast {
            position: fixed;
            bottom: 15px;
            left: 50%;
            transform: translate(-50%, 100px);
            background: rgba(52, 199, 89, 0.95);
            color: white;
            padding: 4px 10px;
            border-radius: 6px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
            font-weight: 500;
            font-size: 10px;
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            z-index: 1000;
            pointer-events: none;
        }

        .toast.show {
            transform: translate(-50%, 0);
            opacity: 1;
        }

        /* Model Quotas and status styles */
        .model-quota-row {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 8px 10px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            font-size: 10px;
            transition: all 0.2s ease;
        }
        
        .model-quota-row.active {
            border-color: rgba(0, 122, 255, 0.35);
            background: rgba(0, 122, 255, 0.06);
            box-shadow: 0 0 12px rgba(0, 122, 255, 0.08);
        }

        .model-quota-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .model-quota-name {
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
        }
        
        .model-quota-active-indicator {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--color-green);
            box-shadow: 0 0 6px var(--color-green);
            animation: pulseGlow 1.8s infinite;
        }

        .quota-badge {
            font-size: 8px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            padding: 2px 6px;
            border-radius: 4px;
        }

        .quota-badge.available {
            background: rgba(52, 199, 89, 0.12);
            color: var(--color-green);
        }

        .quota-badge.exhausted {
            background: rgba(255, 59, 48, 0.12);
            color: var(--color-red);
        }

        .model-quota-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }

        .model-quota-countdown {
            font-family: monospace;
            font-size: 10px;
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .model-quota-countdown svg {
            width: 10px;
            height: 10px;
            opacity: 0.6;
        }

        .model-quota-mime {
            font-size: 8px;
            color: var(--text-muted);
        }

        .quota-bar-container {
            display: flex;
            gap: 4px;
            width: 100%;
            height: 3px;
            margin-top: 4px;
        }

        .quota-segment {
            flex: 1;
            height: 100%;
            background: rgba(255, 255, 255, 0.06);
            border-radius: 2px;
            overflow: hidden;
            position: relative;
        }

        .quota-segment-fill {
            height: 100%;
            border-radius: 2px;
            width: 0%;
            transition: width 0.3s ease-out;
        }

        .quota-segment-fill.bg-red {
            background: var(--color-red);
        }

        .quota-segment-fill.bg-yellow {
            background: var(--color-yellow);
        }

        .quota-segment-fill.bg-green {
            background: var(--color-green);
        }

        .provider-group-label {
            font-size: 8px;
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.8px;
            padding: 4px 0 2px;
            margin-top: 2px;
        }

        /* Countdown timer in session header */
        .reset-timer {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
        }

        .reset-timer-label {
            font-size: 8px;
            color: var(--text-secondary);
            text-transform: uppercase;
            line-height: 1;
        }

        .reset-timer-value {
            font-size: 13px;
            font-weight: 700;
            font-family: monospace;
            line-height: 1.2;
        }

        .reset-timer-value.green { color: var(--color-green); }
        .reset-timer-value.yellow { color: var(--color-yellow); }
        .reset-timer-value.red { color: var(--color-red); }

        /* Accordion Collapsible Headers */
        .collapsible-header {
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: none !important;
            padding-bottom: 0 !important;
            margin-bottom: 0 !important;
            transition: color 0.15s ease;
        }
        .collapsible-header:hover .collapsible-title-text,
        .collapsible-header:hover .collapsible-arrow {
            color: var(--color-rose) !important;
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- macOS Window Titlebar -->
        <header style="display: flex; flex-direction: column; align-items: flex-start; background: var(--bg-sidebar); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px; gap: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <!-- Cool neon purple/pink shield/eye icon -->
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="url(#cyber-grad)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 4px var(--color-rose));">
                    <defs>
                        <linearGradient id="cyber-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stop-color="var(--color-rose)" />
                            <stop offset="100%" stop-color="var(--color-blue)" />
                        </linearGradient>
                    </defs>
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
                <h1 style="font-size: 14px; font-weight: 800; letter-spacing: 0.5px; background: linear-gradient(90deg, var(--color-rose), var(--color-blue)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0; line-height: 1.2;">Super Sentinel by Kadzura</h1>
            </div>
            <div style="width: 100%; height: 1px; background: var(--border-color); margin: 4px 0;"></div>
            <div style="font-size: 9px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px;">Dashboard</div>
        </header>

        <!-- macOS Segmented tabs -->
        <div class="tabs">
            <button class="tab-btn active" onclick="switchTab('radar')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path><path d="M2 12h20"></path></svg>
                Radar
            </button>
            <button class="tab-btn" onclick="switchTab('subagents')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                Subagents
            </button>
            <button class="tab-btn" onclick="switchTab('skills')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>
                Skills/MCP
            </button>
            <button class="tab-btn" onclick="switchTab('clicker')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                Clicker
            </button>
        </div>

        <!-- RADAR TAB -->
        <div id="tab-radar" class="tab-content active">
            <!-- Active Session Details -->
            <div class="glass-panel">
                <div class="panel-title">Session Status</div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <!-- Line 1: Model Name & Active Status Badge -->
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <h2 style="font-size: 13px; font-weight: 700; margin: 0;" id="radar-model">${overwatch.activeModel}</h2>
                        <div class="status-badge ${overwatch.sessionActive ? '' : 'inactive'}" id="radar-active-badge">
                            <span class="pulse-dot"></span>
                            <span id="radar-active-status">${overwatch.sessionActive ? 'ACTIVE' : 'OFFLINE'}</span>
                        </div>
                    </div>
                    
                    <!-- Line 2: Session ID -->
                    <div style="font-size: 9px; color: var(--text-secondary); font-family: monospace;" id="radar-session-id">
                        ID: ${overwatch.sessionId ? overwatch.sessionId.substring(0, 20) + '...' : 'No active session'}
                    </div>
                    
                    <!-- Line 3: Quota Remaining & Reset Timer -->
                    <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); padding: 6px 8px; border-radius: 4px; border: 1px solid var(--border-color);">
                        <div class="active-quota-status" id="radar-active-quota" style="text-align: left;">
                            <div style="font-size: 8px; color: var(--text-secondary); text-transform: uppercase; font-weight: 500; line-height: 1;">Quota Remaining</div>
                            <div style="font-size: 13px; font-weight: 700; color: var(--color-green); line-height: 1.2; font-family: monospace; margin-top: 2px;" id="radar-active-quota-val">0%</div>
                        </div>
                        <div class="reset-timer" id="radar-reset-timer" style="align-items: flex-end;">
                            <span class="reset-timer-label">Resets in</span>
                            <span class="reset-timer-value green" id="radar-reset-value" style="margin-top: 2px;">--:--:--</span>
                        </div>
                    </div>
                    
                    <!-- Line 4: Account & Plan Info -->
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 9px; border-top: 1px solid var(--border-color); padding-top: 6px; margin-top: 2px;">
                        <div>
                            <span style="color: var(--text-secondary);">Account:</span>
                            <strong id="sentinel-email" style="color: var(--text-primary); font-family: monospace; margin-left: 2px;">${overwatch.email || 'offline'}</strong>
                        </div>
                        <div>
                            <span style="color: var(--text-secondary);">Plan:</span>
                            <span id="sentinel-plan" class="quota-badge available" style="padding: 1px 4px; font-size: 8px; margin-left: 2px; text-transform: uppercase; font-weight: 600;">${overwatch.plan || 'Free'}</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Context window Token estimate -->
            <div class="glass-panel">
                <div class="panel-title">Context Window Usage</div>
                <div class="token-metric">
                    <div class="metric-header">
                        <span>Tokens Consumed</span>
                        <span id="radar-token-percent">0%</span>
                    </div>
                    <div class="progress-bar-container">
                        <div class="progress-bar-fill" id="radar-token-fill"></div>
                    </div>
                    <div class="metric-header" style="margin-top: 2px;">
                        <span id="radar-token-value">0 / 0 Tokens</span>
                        <span id="radar-compaction-status">Normal</span>
                    </div>
                </div>
            </div>

            <!-- Model Quotas and Statuses -->
            <div class="glass-panel">
                <div class="panel-title">Model Quotas & Status</div>
                <div class="models-list" id="radar-models-list" style="display: flex; flex-direction: column; gap: 6px;">
                    <div class="empty-logs">Scanning models state...</div>
                </div>
            </div>


        </div>

        <!-- SUBAGENTS TAB -->
        <div id="tab-subagents" class="tab-content">
            <!-- Active Subagents & Sub-trajectories Hierarchy Tree -->
            <div class="glass-panel">
                <div class="panel-title">Active Subagent Tree</div>
                <div id="subagents-tree-container">
                    <div class="empty-logs">No sub-trajectories detected in the current session.</div>
                </div>
            </div>

            <!-- Visual Browser Recordings -->
            <div class="glass-panel">
                <div class="panel-title">Browser Actuation Frames</div>
                <div class="recordings-carousel" id="recordings-carousel-container">
                    <div class="empty-visuals">No browser frames captured yet. Run browser_subagent to populate!</div>
                </div>
            </div>
        </div>

        <!-- SKILLS & MCP TAB -->
        <div id="tab-skills" class="tab-content">
            <!-- How to Use Tutorial box -->
            <div class="glass-panel" style="background: rgba(168, 85, 247, 0.08); border-color: rgba(244, 114, 182, 0.25); gap: 6px; padding: 10px;">
                <div style="font-weight: 800; color: var(--color-rose); display: flex; align-items: center; gap: 6px; font-size: 10.5px;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                    How to Use Skills & MCP
                </div>
                <div style="color: var(--text-secondary); font-size: 9.5px; line-height: 1.4;">
                    1. Click the <strong style="color: var(--color-rose);">Copy Prompt</strong> button on any active skill card.<br>
                    2. Paste it in your agent chat box to prompt the agent to read and follow the skill's instructions.<br>
                    3. For MCP servers, click <strong style="color: var(--color-blue);">Copy Use</strong> to request the agent to execute tools on that connected server.
                </div>
            </div>

            <!-- Skills grid -->
            <div class="glass-panel">
                <div class="panel-title">Active Skills</div>
                <div class="skills-grid" id="skills-grid-container">
                    <div class="empty-logs">Scanning skills...</div>
                </div>
            </div>

            <!-- MCP servers -->
            <div class="glass-panel">
                <div class="panel-title">MCP Servers Configured</div>
                <div class="mcp-list" id="mcp-list-container">
                    <div class="empty-logs">No MCP Servers connected.</div>
                </div>
            </div>
        </div>

        <!-- CLICKER TAB (Legacy Control Submenu) -->
        <div id="tab-clicker" class="tab-content">
            <!-- Stats -->
            <div class="stats-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;">
                <div class="glass-panel" style="margin-bottom: 0; padding: 10px;">
                    <span style="font-size: 8px; color: var(--text-secondary); text-transform: uppercase;">Clicks Approved</span>
                    <h3 style="font-size: 18px; font-weight: 700; color: var(--color-blue);" id="stats-total-clicks">${totalClicks}</h3>
                </div>
                <div class="glass-panel" style="margin-bottom: 0; padding: 10px;">
                    <span style="font-size: 8px; color: var(--text-secondary); text-transform: uppercase;">Clicker Status</span>
                    <h3 style="font-size: 14px; font-weight: 700; color: ${isEnabled ? 'var(--color-green)' : 'var(--color-yellow)'};" id="stats-engine-status">
                        ${isEnabled ? 'ACTIVE' : 'PAUSED'}
                    </h3>
                </div>
            </div>

            <!-- Switches -->
            <div class="glass-panel">
                <div class="panel-title">Auto Clicker Switches</div>
                <div class="control-row">
                    <div class="control-info">
                        <h4>Auto-Accept Clicker</h4>
                        <p>Approve safety prompts instantly</p>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="check-enabled" ${isEnabled ? 'checked' : ''} onchange="toggleAccept()">
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="control-row">
                    <div class="control-info">
                        <h4>Auto-Scroll Agent Chat</h4>
                        <p>Keep chat panel scrolled to bottom</p>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="check-scroll-enabled" ${isScrollEnabled ? 'checked' : ''} onchange="toggleScroll()">
                        <span class="slider"></span>
                    </label>
                </div>
            </div>

            <!-- Selective Permissions -->
            <div class="glass-panel">
                <div class="panel-title">Approval Mode</div>
                <div class="mode-selector" style="margin-bottom: 6px;">
                    <button class="mode-btn ${allowMode === 'all' ? 'active' : ''}" id="mode-all" onclick="changeAllowMode('all')">Allow All</button>
                    <button class="mode-btn ${allowMode === 'selective' ? 'active' : ''}" id="mode-selective" onclick="changeAllowMode('selective')">Selective</button>
                </div>

                <div class="selective-panel-list" id="selective-box-list" style="display: ${allowMode === 'selective' ? 'flex' : 'none'}">
                    <div class="control-row">
                        <div class="control-info">
                            <h4>JS Browser Policy</h4>
                            <p>Automate custom JS actions on browser</p>
                        </div>
                        <label class="switch">
                            <input type="checkbox" id="check-sel-browser" ${selective.browser ? 'checked' : ''} onchange="updateSelectiveState()">
                            <span class="slider"></span>
                        </label>
                    </div>

                    <div class="control-row">
                        <div class="control-info">
                            <h4>Terminal Auto Exec</h4>
                            <p>Runs command lines without prompt</p>
                        </div>
                        <label class="switch">
                            <input type="checkbox" id="check-sel-command" ${selective.command ? 'checked' : ''} onchange="updateSelectiveState()">
                            <span class="slider"></span>
                        </label>
                    </div>

                    <div class="control-row">
                        <div class="control-info">
                            <h4>File System Access</h4>
                            <p>Allows files edits outside workspace</p>
                        </div>
                        <label class="switch">
                            <input type="checkbox" id="check-sel-files" ${selective.files ? 'checked' : ''} onchange="updateSelectiveState()">
                            <span class="slider"></span>
                        </label>
                    </div>

                    <div class="control-row">
                        <div class="control-info">
                            <h4>Planning / Artifacts</h4>
                            <p>Proceed on plans and artifacts automatically</p>
                        </div>
                        <label class="switch">
                            <input type="checkbox" id="check-sel-planning" ${selective.planning ? 'checked' : ''} onchange="updateSelectiveState()">
                            <span class="slider"></span>
                        </label>
                    </div>
                </div>
            </div>

            <!-- Parameters -->
            <div class="glass-panel" id="panel-clicker-parameters">
                <div class="panel-title collapsible-header" onclick="toggleExpand('clicker-parameters-body', 'clicker-parameters-arrow')">
                    <span class="collapsible-title-text">Clicker Parameters</span>
                    <span id="clicker-parameters-arrow" class="collapsible-arrow" style="font-size: 8px; transition: transform 0.2s ease; display: inline-block;">▶</span>
                </div>
                <div id="clicker-parameters-body" style="display: none; flex-direction: column; gap: 10px; border-top: 1px solid var(--border-color); padding-top: 10px; margin-top: 10px;">
                    <div class="form-group">
                        <label>Click scan interval <span id="label-click-interval">${clickIntervalMs} ms</span></label>
                        <input type="range" id="range-click-interval" min="100" max="10000" step="100" value="${clickIntervalMs}" oninput="updateRangeLabel('click-interval', this.value + ' ms')">
                    </div>
                    <div class="form-group">
                        <label>Scroll refresh rate <span id="label-scroll-interval">${scrollIntervalMs} ms</span></label>
                        <input type="range" id="range-scroll-interval" min="100" max="5000" step="50" value="${scrollIntervalMs}" oninput="updateRangeLabel('scroll-interval', this.value + ' ms')">
                    </div>
                    <div class="form-group">
                        <label>Scroll pause window <span id="label-scroll-pause">${(scrollPauseMs / 1000).toFixed(1)} s</span></label>
                        <input type="range" id="range-scroll-pause" min="1000" max="30000" step="500" value="${scrollPauseMs}" oninput="updateRangeLabel('scroll-pause', (this.value / 1000).toFixed(1) + ' s')">
                    </div>
                    
                    <div class="form-group" style="margin-top: 6px;">
                        <label>Click Matching Patterns</label>
                        <div class="chips-container" id="chips-container">
                            ${chipsHtml}
                        </div>
                        <div class="add-pattern-row">
                            <input type="text" id="input-new-pattern" placeholder="e.g. Always Allow in Workspace">
                            <button class="btn-secondary" onclick="addPatternChip()">Add</button>
                        </div>
                    </div>

                    <button class="btn-primary" onclick="saveSettings()">Save Configuration</button>
                </div>
            </div>

            <!-- Log Console -->
            <div class="glass-panel" id="panel-approval-logs">
                <div class="panel-title collapsible-header" onclick="toggleExpand('approval-logs-body', 'approval-logs-arrow')">
                    <span class="collapsible-title-text">Approval click logs</span>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button class="btn-secondary" style="padding: 3px 6px; font-size: 9px; margin: 0;" onclick="event.stopPropagation(); clearLogs();">Clear</button>
                        <span id="approval-logs-arrow" class="collapsible-arrow" style="font-size: 8px; transition: transform 0.2s ease; display: inline-block;">▶</span>
                    </div>
                </div>
                <div id="approval-logs-body" style="display: none; border-top: 1px solid var(--border-color); padding-top: 10px; margin-top: 10px; width: 100%;">
                    <div class="console-card" id="console-logs" style="width: 100%;">
                        ${logItemsHtml || '<div class="empty-logs">No click events logged yet. Trigger a permission popup to test!</div>'}
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Notification Toast -->
    <div class="toast" id="toast-notify">Settings Saved!</div>

    <script>
        const vscode = acquireVsCodeApi();
        let activePatterns = ${JSON.stringify(clickPatterns)};
        let currentAllowMode = '${allowMode}';

        function toggleExpand(bodyId, arrowId) {
            const body = document.getElementById(bodyId);
            const arrow = document.getElementById(arrowId);
            if (body.style.display === 'none') {
                body.style.display = 'flex';
                arrow.style.transform = 'rotate(90deg)';
            } else {
                body.style.display = 'none';
                arrow.style.transform = 'rotate(0deg)';
            }
        }

        function switchTab(tabId) {
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

            event.currentTarget.classList.add('active');
            document.getElementById('tab-' + tabId).classList.add('active');
        }

        function updateRangeLabel(id, text) {
            document.getElementById('label-' + id).innerText = text;
        }

        function addPatternChip() {
            const input = document.getElementById('input-new-pattern');
            const pattern = input.value.trim();
            if (!pattern) return;

            if (activePatterns.includes(pattern)) {
                input.value = '';
                return;
            }

            activePatterns.push(pattern);
            renderChips();
            input.value = '';
        }

        function removePatternChip(pattern) {
            activePatterns = activePatterns.filter(p => p !== pattern);
            renderChips();
        }

        function renderChips() {
            const container = document.getElementById('chips-container');
            container.innerHTML = activePatterns.map(p => \`
                <span class="chip" data-pattern="\${p}">
                    \${p}
                    <span class="remove-chip" onclick="removePatternChip('\${p}')">&times;</span>
                </span>
            \`).join('');
        }

        function toggleAccept() {
            const enabled = document.getElementById('check-enabled').checked;
            document.getElementById('stats-engine-status').innerText = enabled ? 'ACTIVE' : 'PAUSED';
            document.getElementById('stats-engine-status').style.color = enabled ? 'var(--color-green)' : 'var(--color-yellow)';
            vscode.postMessage({ command: 'toggleAccept', enabled: enabled });
        }

        function toggleScroll() {
            const enabled = document.getElementById('check-scroll-enabled').checked;
            vscode.postMessage({ command: 'toggleScroll', enabled: enabled });
        }

        function changeAllowMode(mode) {
            currentAllowMode = mode;
            document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
            document.getElementById('mode-' + mode).classList.add('active');
            
            const list = document.getElementById('selective-box-list');
            list.style.display = mode === 'selective' ? 'flex' : 'none';
            
            vscode.postMessage({ command: 'updateAllowMode', mode: mode });
        }

        function updateSelectiveState() {
            const permissions = {
                browser: document.getElementById('check-sel-browser').checked,
                command: document.getElementById('check-sel-command').checked,
                files: document.getElementById('check-sel-files').checked,
                planning: document.getElementById('check-sel-planning').checked
            };
            vscode.postMessage({ command: 'updateSelectivePermissions', permissions: permissions });
        }

        function saveSettings() {
            const clickInterval = parseInt(document.getElementById('range-click-interval').value);
            const scrollInterval = parseInt(document.getElementById('range-scroll-interval').value);
            const scrollPause = parseInt(document.getElementById('range-scroll-pause').value);

            vscode.postMessage({
                command: 'saveConfig',
                data: {
                    clickIntervalMs: clickInterval,
                    scrollIntervalMs: scrollInterval,
                    scrollPauseMs: scrollPause,
                    clickPatterns: activePatterns
                }
            });

            // Show Toast
            const toast = document.getElementById('toast-notify');
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2000);
        }

        function clearLogs() {
            vscode.postMessage({ command: 'clearLogs' });
            document.getElementById('console-logs').innerHTML = '<div class="empty-logs">No click events logged yet. Trigger a permission popup to test!</div>';
            document.getElementById('stats-total-clicks').innerText = '0';
        }

        // --- Overwatch real-time UI updates ---
        function updateOverwatchUi(data) {
            if (!data.sessionActive) {
                document.getElementById('radar-active-status').innerText = 'OFFLINE';
                document.getElementById('radar-active-badge').classList.add('inactive');
                return;
            }

            // Status & Model
            document.getElementById('radar-model').innerText = data.activeModel;
            document.getElementById('radar-session-id').innerText = 'ID: ' + data.sessionId.substring(0, 15) + '...';
            document.getElementById('radar-active-status').innerText = 'ACTIVE';
            document.getElementById('radar-active-badge').classList.remove('inactive');

            // Account & Plan Info
            const emailEl = document.getElementById('sentinel-email');
            if (emailEl) emailEl.innerText = data.email || 'offline';
            const planEl = document.getElementById('sentinel-plan');
            if (planEl) {
                planEl.innerText = data.plan || 'Free';
                planEl.className = 'quota-badge ' + (data.plan && data.plan !== 'Free' ? 'available' : 'exhausted');
            }

            // Update active quota value
            const quotaValEl = document.getElementById('radar-active-quota-val');
            if (quotaValEl) {
                const actPct = Math.round((data.activeModelRemainingFraction || 0.0) * 100);
                quotaValEl.innerText = actPct + '%';
                if (actPct < 10) {
                    quotaValEl.style.color = 'var(--color-red)';
                } else if (actPct < 25) {
                    quotaValEl.style.color = 'var(--color-yellow)';
                } else {
                    quotaValEl.style.color = 'var(--color-green)';
                }
            }

            // Reset timer
            if (data.activeModelExpiration) {
                window.__overwatchExpiration = data.activeModelExpiration;
                updateResetTimer();
            } else {
                const timerEl = document.getElementById('radar-reset-value');
                if (timerEl) {
                    timerEl.innerText = 'N/A';
                    timerEl.className = 'reset-timer-value green';
                }
            }

            // Models List with strict flat sorting, quota badges, countdown
            const modelsList = document.getElementById('radar-models-list');
            if (modelsList) {
                if (data.modelsList && data.modelsList.length > 0) {
                    // Store models data for countdown ticking
                    window.__overwatchModels = data.modelsList;
                    window.__overwatchActiveModel = data.activeModel;

                    const order = [
                        'Gemini 3.5 Flash (Low)',
                        'Gemini 3.5 Flash (Medium)',
                        'Gemini 3.5 Flash (High)',
                        'Gemini 3.1 Pro (Low)',
                        'Gemini 3.1 Pro (High)',
                        'Claude Sonnet 4.6 (Thinking)',
                        'Claude Opus 4.6 (Thinking)',
                        'GPT-OSS 120B (Medium)'
                    ];
                    
                    const sortedModels = [...data.modelsList].sort((a, b) => {
                        const indexA = order.indexOf(a.name);
                        const indexB = order.indexOf(b.name);
                        const valA = indexA === -1 ? 999 : indexA;
                        const valB = indexB === -1 ? 999 : indexB;
                        return valA - valB;
                    });

                    let html = sortedModels.map(m => {
                        const isActive = m.name === data.activeModel;
                        const hasQuota = m.quota === 1;
                        const countdownStr = formatCountdown(m.expiration);
                        const r = m.remainingFraction !== undefined && m.remainingFraction !== null ? m.remainingFraction : 0.0;
                        const barColorClass = r < 0.1 ? 'bg-red' : (r < 0.25 ? 'bg-yellow' : 'bg-green');
                        const segmentsHtml = [0,1,2,3,4].map(s => {
                            const o = s * 0.2;
                            const u = (s + 1) * 0.2;
                            let d = 0;
                            if (r >= u) {
                                d = 100;
                            } else if (r > o) {
                                d = Math.round((r - o) / 0.2 * 100);
                            }
                            return \`
                                <div class="quota-segment">
                                    <div class="quota-segment-fill \${barColorClass}" style="width: \${d}%"></div>
                                </div>
                            \`;
                        }).join('');
                        const mimeStr = m.mimeTypeCount ? m.mimeTypeCount + ' types' : 'N/A';
                        return \`
                            <div class="model-quota-row \${isActive ? 'active' : ''}" data-model-name="\${m.name}" data-expiration="\${m.expiration || ''}">
                                <div class="model-quota-header">
                                    <div class="model-quota-name">
                                        \${isActive ? '<span class="model-quota-active-indicator"></span>' : ''}
                                        <span>\${m.name}</span>
                                    </div>
                                    <div class="model-quota-countdown" data-exp="\${m.expiration || ''}">
                                        <span class="countdown-text">\${countdownStr}</span>
                                    </div>
                                </div>
                                <div class="quota-bar-container">
                                    \${segmentsHtml}
                                </div>
                                <div class="model-quota-meta" style="margin-top: 3px; font-size: 8px;">
                                    <span class="model-quota-mime">\${mimeStr}</span>
                                    <span class="quota-badge \${hasQuota ? 'available' : 'exhausted'}" style="padding: 1px 4px; font-size: 8px;">\${hasQuota ? 'Available' : 'Exhausted'}</span>
                                </div>
                            </div>
                        \`;
                    }).join('');
                    
                    modelsList.innerHTML = html;
                } else {
                    modelsList.innerHTML = '<div class="empty-logs">No models data found in global state.</div>';
                }
            }

            // Token & Capacity gauge
            const percent = Math.min(Math.round((data.estimatedTokens / data.contextLimit) * 100), 100);
            document.getElementById('radar-token-percent').innerText = percent + '%';
            
            const fill = document.getElementById('radar-token-fill');
            fill.style.width = percent + '%';
            fill.className = 'progress-bar-fill';
            
            let statusText = 'Normal';
            if (percent >= 90) {
                fill.classList.add('danger');
                statusText = 'CRITICAL LIMIT';
            } else if (percent >= 75) {
                fill.classList.add('warning');
                statusText = 'Compacting Near';
            }
            
            document.getElementById('radar-compaction-status').innerText = statusText;
            document.getElementById('radar-compaction-status').style.color = 
                statusText === 'CRITICAL LIMIT' ? 'var(--color-red)' : 
                (statusText === 'Compacting Near' ? 'var(--color-yellow)' : 'var(--text-secondary)');
            
            const formatNumber = num => num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
            document.getElementById('radar-token-value').innerText = formatNumber(data.estimatedTokens) + ' / ' + formatNumber(data.contextLimit) + ' Tokens';



            // Subagents Tree Hierarchy
            const treeContainer = document.getElementById('subagents-tree-container');
            let treeHtml = '';
            
            // Render Browser Subagent indicator if active
            const hasBrowserSubagent = data.steps.some(s => s.tool_calls && s.tool_calls.some(tc => tc.name === 'browser_subagent'));
            if (hasBrowserSubagent) {
                treeHtml += \`
                    <div class="tree-node" style="color: var(--color-blue);">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-top: 1px;"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line></svg>
                        <strong>browser_subagent</strong> (Visual Automation Agent)
                    </div>
                \`;
            }

            // Render Child sub-trajectories
            if (data.childSessions && data.childSessions.length > 0) {
                treeHtml += '<div class="subagent-tree">';
                treeHtml += data.childSessions.map(child => \`
                    <div class="tree-node" style="color: var(--color-rose);">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                        Sesi Anak Depth-\${child.nestingDepth}: \${child.id.substring(0, 13)}...
                    </div>
                \`).join('');
                treeHtml += '</div>';
            }

            if (!hasBrowserSubagent && (!data.childSessions || data.childSessions.length === 0)) {
                treeContainer.innerHTML = '<div class="empty-logs">No subagents triggered in this session yet.</div>';
            } else {
                treeContainer.innerHTML = treeHtml;
            }

            // Browser Visual frames Carousel
            const carousel = document.getElementById('recordings-carousel-container');
            if (data.browserFrames && data.browserFrames.length > 0) {
                carousel.innerHTML = data.browserFrames.map((frame, index) => \`
                    <div class="carousel-item" onclick="openFrameViewer('\${frame}')">
                        <img src="\${frame}" alt="Browser Frame \${index}">
                        <span class="carousel-item-time">#\${index + 1}</span>
                    </div>
                \`).join('');
            } else {
                carousel.innerHTML = '<div class="empty-visuals">No browser frames captured yet. Run browser_subagent to test!</div>';
            }

            // Skills tab list
            const skillsContainer = document.getElementById('skills-grid-container');
            if (data.skills && data.skills.length > 0) {
                skillsContainer.innerHTML = data.skills.map(skill => \`
                    <div class="skill-item" style="border: 1px solid var(--border-color); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; justify-content: space-between; gap: 8px; background: rgba(255,255,255,0.01);">
                        <div>
                            <h4 style="margin: 0; font-size: 11.5px; color: var(--text-primary); font-weight: 700;">\${skill.name}</h4>
                            <p style="margin: 4px 0 0 0; font-size: 9px; color: var(--text-secondary); line-height: 1.3;">\${skill.description || 'No description available.'}</p>
                        </div>
                        <button class="mode-btn" onclick="copyPrompt('skill', '\${skill.name}', event)" style="align-self: flex-start; padding: 3px 8px; font-size: 9px; font-weight: 700; height: auto; margin: 0; background: var(--bg-sidebar); border: 1px solid var(--border-color); color: var(--color-rose); cursor: pointer; border-radius: 4px; display: flex; align-items: center; gap: 4px;">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                            Copy Prompt
                        </button>
                    </div>
                \`).join('');
            } else {
                skillsContainer.innerHTML = '<div class="empty-logs">No active skills folder detected.</div>';
            }

            // MCP tab list
            const mcpContainer = document.getElementById('mcp-list-container');
            if (data.mcpServers && data.mcpServers.length > 0) {
                mcpContainer.innerHTML = data.mcpServers.map(mcp => \`
                    <div class="mcp-item" style="border: 1px solid var(--border-color); border-radius: 6px; padding: 10px; display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.01); margin-bottom: 8px;">
                        <div>
                            <div class="mcp-item-name" style="font-weight: 700; font-size: 11px; color: var(--text-primary);">\${mcp.name}</div>
                            <div class="mcp-item-cmd" style="font-size: 8px; color: var(--text-muted); font-family: monospace; margin-top: 2px;">Command: \${mcp.command}</div>
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
                            <span style="font-size: 8.5px; font-weight: bold; color: var(--color-green); display: flex; align-items: center; gap: 4px;">
                                <span class="pulse-dot" style="width: 5px; height: 5px; background: var(--color-green);"></span> \${mcp.status}
                            </span>
                            <button class="mode-btn" onclick="copyPrompt('mcp', '\${mcp.name}', event)" style="padding: 2px 6px; font-size: 8.5px; font-weight: 700; height: auto; margin: 0; background: var(--bg-sidebar); border: 1px solid var(--border-color); color: var(--color-blue); cursor: pointer; border-radius: 4px; display: flex; align-items: center; gap: 3px;">
                                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                Copy Use
                            </button>
                        </div>
                    </div>
                \`).join('');
            } else {
                mcpContainer.innerHTML = '<div class="empty-logs">No custom MCP servers configured in mcp_config.json.</div>';
            }
        }

        // Frame viewer logic
        function openFrameViewer(uri) {
            vscode.postMessage({ command: 'openSettings' }); // Fallback or focuses panel
        }

        // Clipboard Copy Utility
        function copyPrompt(type, name, event) {
            let promptText = '';
            if (type === 'skill') {
                promptText = \`Please use the skill "\${name}". Read its instructions in the skill's SKILL.md file and follow them exactly to proceed.\`;
            } else if (type === 'mcp') {
                promptText = \`Please run the tool using the connected "\${name}" MCP server.\`;
            }
            
            navigator.clipboard.writeText(promptText).then(() => {
                const btn = event.currentTarget;
                const origHtml = btn.innerHTML;
                btn.innerHTML = \`<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!\`;
                const origColor = btn.style.color;
                const origBorderColor = btn.style.borderColor;
                btn.style.color = 'var(--color-green)';
                btn.style.borderColor = 'var(--color-green)';
                setTimeout(() => {
                    btn.innerHTML = origHtml;
                    btn.style.color = origColor;
                    btn.style.borderColor = origBorderColor;
                }, 1500);
            }).catch(err => {
                console.error(\'Failed to copy text: \', err);
            });
        }

        // Live messages syncing
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateOverwatch') {
                updateOverwatchUi(message.data);
            } else if (message.command === 'updateState') {
                // Sync settings state
                document.getElementById('check-enabled').checked = message.state.enabled;
                document.getElementById('check-scroll-enabled').checked = message.state.scrollEnabled;
                document.getElementById('range-click-interval').value = message.state.clickIntervalMs || 1000;
                document.getElementById('range-scroll-interval').value = message.state.scrollIntervalMs || 500;
                document.getElementById('range-scroll-pause').value = message.state.scrollPauseMs || 7000;
                
                updateRangeLabel('click-interval', (message.state.clickIntervalMs || 1000) + ' ms');
                updateRangeLabel('scroll-interval', (message.state.scrollIntervalMs || 500) + ' ms');
                updateRangeLabel('scroll-pause', ((message.state.scrollPauseMs || 7000) / 1000).toFixed(1) + ' s');

                activePatterns = message.state.clickPatterns || [];
                renderChips();

                const isEnabled = message.state.enabled !== false;
                document.getElementById('stats-engine-status').innerText = isEnabled ? 'ACTIVE' : 'PAUSED';
                document.getElementById('stats-engine-status').style.color = isEnabled ? 'var(--color-green)' : 'var(--color-yellow)';
                document.getElementById('stats-total-clicks').innerText = message.state.totalClicks || 0;

                // Sync selective mode
                currentAllowMode = message.state.allowMode || 'all';
                document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
                document.getElementById('mode-' + currentAllowMode).classList.add('active');
                document.getElementById('selective-box-list').style.display = currentAllowMode === 'selective' ? 'flex' : 'none';

                const selective = message.state.selectivePermissions || { browser: true, command: true, files: true, planning: true };
                document.getElementById('check-sel-browser').checked = selective.browser;
                document.getElementById('check-sel-command').checked = selective.command;
                document.getElementById('check-sel-files').checked = selective.files;
                document.getElementById('check-sel-planning').checked = selective.planning;

                // Render click log console
                const logContainer = document.getElementById('console-logs');
                if (message.state.clickLog && message.state.clickLog.length > 0) {
                    logContainer.innerHTML = message.state.clickLog.map(log => \`
                        <div class="log-item">
                            <span class="log-time">[\${log.time || ''}]</span>
                            <span class="log-bullet">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            </span>
                            <span class="log-text">Clicked <strong class="highlight-btn">\${log.button || ''}</strong> (<span class="highlight-pat">"\${log.pattern || ''}"</span>)</span>
                        </div>
                    \`).join('');
                } else {
                    logContainer.innerHTML = '<div class="empty-logs">No click events logged yet.</div>';
                }
            }
        });

        // --- Countdown helper functions ---
        function formatCountdown(expiration, noPrefix = false) {
            if (!expiration) return 'N/A';
            const now = Math.floor(Date.now() / 1000);
            const diff = expiration - now;
            if (diff <= 0) return 'Quota Available';
            
            const r = Math.floor(diff / 60);
            const n = Math.floor(r / 1440);
            const a = Math.floor((r % 1440) / 60);
            const i = r % 60;
            
            let timeStr = '';
            if (n > 0) {
                timeStr = \`\${n} day\${n > 1 ? 's' : ''}, \${a} hour\${a > 1 ? 's' : ''}\`;
            } else if (a > 0) {
                timeStr = \`\${a} hour\${a > 1 ? 's' : ''}, \${i} minute\${i > 1 ? 's' : ''}\`;
            } else {
                timeStr = \`\${i} minute\${i > 1 ? 's' : ''}\`;
            }
            return noPrefix ? timeStr : \`Refreshes in \${timeStr}\`;
        }

        function getCountdownColor(expiration) {
            if (!expiration) return 'green';
            const now = Math.floor(Date.now() / 1000);
            const diff = expiration - now;
            if (diff <= 0) return 'green';
            const hours = diff / 3600;
            if (hours < 1) return 'red';
            if (hours < 2) return 'yellow';
            return 'green';
        }

        function updateResetTimer() {
            const exp = window.__overwatchExpiration;
            const timerEl = document.getElementById('radar-reset-value');
            if (!timerEl || !exp) return;
            const str = formatCountdown(exp, true);
            const color = getCountdownColor(exp);
            timerEl.innerText = str;
            timerEl.className = 'reset-timer-value ' + color;
        }

        // Tick countdown every second
        setInterval(() => {
            // Update header countdown
            updateResetTimer();

            // Update per-model countdowns in the list
            document.querySelectorAll('.model-quota-countdown[data-exp]').forEach(el => {
                const exp = parseInt(el.getAttribute('data-exp'));
                if (!exp) return;
                const textEl = el.querySelector('.countdown-text');
                if (textEl) textEl.innerText = formatCountdown(exp);
            });
        }, 1000);

        // Initialize UI with bootstrap data
        setTimeout(() => {
            const bootstrapState = ${JSON.stringify({ enabled: isEnabled, scrollEnabled: isScrollEnabled, clickIntervalMs, scrollIntervalMs, scrollPauseMs, clickPatterns, totalClicks, allowMode, selectivePermissions: selective })};
            const bootstrapOverwatch = ${JSON.stringify(overwatch)};
            
            // Run bootstrap update
            updateOverwatchUi(bootstrapOverwatch);
        }, 100);
    </script>
</body>
</html>`;
};
