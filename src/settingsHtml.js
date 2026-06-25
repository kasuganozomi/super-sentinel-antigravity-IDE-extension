function formatCountdownServer(expiration) {
    if (!expiration) return 'No Reset';
    const now = Math.floor(Date.now() / 1000);
    const diff = expiration - now;
    if (diff <= 0) return 'Quota Available';
    const r = Math.floor(diff / 60);
    const n = Math.floor(r / 1440);
    const a = Math.floor((r % 1440) / 60);
    const i = r % 60;
    if (n > 0) return `Refreshes in ${n} day${n > 1 ? 's' : ''}, ${a} hour${a > 1 ? 's' : ''}`;
    if (a > 0) return `Refreshes in ${a} hour${a > 1 ? 's' : ''}, ${i} minute${i > 1 ? 's' : ''}`;
    return `Refreshes in ${i} minute${i > 1 ? 's' : ''}`;
}

function getCountdownColorServer(expiration) {
    if (!expiration) return 'green';
    const now = Math.floor(Date.now() / 1000);
    const diff = expiration - now;
    if (diff <= 0) return 'green';
    const hours = diff / 3600;
    if (hours < 1) return 'red';
    if (hours < 2) return 'yellow';
    return 'green';
}

function buildModelsListHtml(modelsList, activeModel) {
    if (!modelsList || modelsList.length === 0) {
        return '<div class="empty-logs">No models data found in global state.</div>';
    }
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
    const sortedModels = [...modelsList].sort((a, b) => {
        // Active model always first — immediately visible without scrolling
        if (a.name === activeModel) return -1;
        if (b.name === activeModel) return 1;
        const ia = order.indexOf(a.name); const ib = order.indexOf(b.name);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    return sortedModels.map(m => {
        const isActive = m.name === activeModel;
        const hasQuota = m.quota === 1;
        const countdownStr = formatCountdownServer(m.expiration);
        const r = m.remainingFraction !== undefined && m.remainingFraction !== null ? m.remainingFraction : 0.0;
        const barColorClass = r < 0.1 ? 'bg-red' : (r < 0.25 ? 'bg-yellow' : 'bg-green');
        const segmentsHtml = [0,1,2,3,4].map(s => {
            const o = s * 0.2, u = (s + 1) * 0.2;
            let d = 0;
            if (r >= u) d = 100;
            else if (r > o) d = Math.round((r - o) / 0.2 * 100);
            return `<div class="quota-segment"><div class="quota-segment-fill ${barColorClass}" style="width: ${d}%"></div></div>`;
        }).join('');
        const mimeStr = m.mimeTypeCount ? m.mimeTypeCount + ' types' : 'N/A';
        return `
            <div class="model-quota-row ${isActive ? 'active' : ''}" data-model-name="${m.name}" data-expiration="${m.expiration || ''}">
                <div class="model-quota-header">
                    <div class="model-quota-name">
                        ${isActive ? '<span class="model-quota-active-indicator"></span>' : ''}
                        <span>${m.name}</span>
                    </div>
                    <div class="model-quota-countdown" data-exp="${m.expiration || ''}">
                        <span class="countdown-text">${countdownStr}</span>
                    </div>
                </div>
                <div class="quota-bar-container">${segmentsHtml}</div>
                <div class="model-quota-meta">
                    <span class="model-quota-mime">${mimeStr}</span>
                    <span class="quota-badge ${hasQuota ? 'available' : 'exhausted'}">${hasQuota ? 'Available' : 'Exhausted'}</span>
                </div>
            </div>
        `;
    }).join('');
}

function buildCachedAccountsHtml(cachedAccounts, activeEmail) {
    const inactiveAccounts = (cachedAccounts || []).filter(acc => acc.email !== activeEmail);
    if (inactiveAccounts.length === 0) {
        return '<div class="empty-logs" style="padding: 10px 0; text-align: center;">No cached account history.</div>';
    }
    return inactiveAccounts.map((acc, index) => {
        const id = `acc-history-${index}`;
        const planClass = acc.plan && acc.plan !== 'Free' ? 'available' : 'exhausted';
        const modelsHtml = buildModelsListHtml(acc.modelsList, acc.activeModel);
        const lastSeenDate = acc.lastSeen ? new Date(acc.lastSeen).toLocaleDateString() : 'Unknown';
        return `
            <div class="glass-panel" style="margin-bottom: 8px; padding: 10px; border-color: rgba(168, 85, 247, 0.1); width: 100%;">
                <div class="collapsible-header" onclick="toggleExpand('${id}-body', '${id}-arrow')" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <div style="display: flex; flex-direction: column; gap: 2px;">
                        <span style="font-size: 11px; font-weight: 700; font-family: monospace; color: var(--text-primary);">${acc.email}</span>
                        <span class="quota-badge ${planClass}" style="align-self: flex-start; padding: 1px 4px; font-size: 8px; margin-top: 1px;">${acc.plan || 'Free'}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 8px; color: var(--text-muted);">Last seen: ${lastSeenDate}</span>
                        <span id="${id}-arrow" class="collapsible-arrow" style="font-size: 8px; transition: transform 0.2s ease; display: inline-block;">▶</span>
                    </div>
                </div>
                <div id="${id}-body" style="display: none; flex-direction: column; gap: 6px; border-top: 1px solid var(--border-color); padding-top: 8px; margin-top: 8px; width: 100%;">
                    <div style="font-size: 9px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 2px;">Last Known Quotas</div>
                    <div class="models-list" style="display: flex; flex-direction: column; gap: 6px; width: 100%;">${modelsHtml}</div>
                </div>
            </div>
        `;
    }).join('');
}

module.exports = function buildSettingsHtml(data) {
    const isEnabled       = data.enabled !== false;
    const isScrollEnabled = data.scrollEnabled !== false;
    const scrollPauseMs   = data.scrollPauseMs || 7000;
    const clickIntervalMs = data.clickIntervalMs || 1000;
    const scrollIntervalMs = data.scrollIntervalMs || 500;
    const clickPatterns   = data.clickPatterns || [];
    const totalClicks     = data.totalClicks || 0;
    const clickLog        = data.clickLog || [];
    const version         = data.version || '1.0.0';

    const allowMode = data.allowMode || 'all';
    const selective = data.selectivePermissions || { browser: true, command: true, files: true, planning: true };

    const overwatch = data.overwatch || {
        sessionActive: false,
        sessionId: '',
        activeModel: null,
        activeModelExpiration: null,
        modelsList: [],
        estimatedTokens: 0,
        contextLimit: 1000000,
        warningThreshold: 750000,
        skills: [],
        mcpServers: []
    };

    const initialQuotaPct = Math.round((overwatch.activeModelRemainingFraction || 0.0) * 100);
    const quotaColor      = initialQuotaPct < 10 ? 'var(--color-red)' : (initialQuotaPct < 25 ? 'var(--color-yellow)' : 'var(--color-green)');
    const initialPlanClass = overwatch.plan && overwatch.plan !== 'Free' ? 'available' : 'exhausted';
    const activeModelDisplay = overwatch.activeModel || 'Detecting...';
    const isDetecting = !overwatch.activeModel;

    const chipsHtml = clickPatterns.map(p => `
        <span class="chip" data-pattern="${p}">
            ${p}
            <span class="remove-chip" onclick="removePatternChip('${p}')">&times;</span>
        </span>
    `).join('');

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
            --bg-base: #0c0817;
            --bg-sidebar: #05030a;
            --bg-panel: rgba(26, 15, 46, 0.45);
            --border-color: rgba(244, 114, 182, 0.18);
            --text-primary: #fdf2f8;
            --text-secondary: #d8b4fe;
            --text-muted: #7c5b9e;
            --color-blue: #a855f7;
            --color-green: #10b981;
            --color-yellow: #f59e0b;
            --color-red: #ef4444;
            --color-rose: #f472b6;
            --input-bg: rgba(5, 3, 10, 0.6);
            --input-border: rgba(244, 114, 182, 0.25);
            --font-stack: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: var(--font-stack);
            background: var(--bg-base);
            color: var(--text-primary);
            padding: 10px;
            overflow-x: hidden;
            font-size: 12px;
            -webkit-font-smoothing: antialiased;
        }

        .container { width: 100%; display: flex; flex-direction: column; gap: 10px; }

        header {
            background: var(--bg-sidebar);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            padding: 12px;
        }

        /* Tabs */
        .tabs {
            display: flex;
            background: rgba(0,0,0,0.25);
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
            gap: 3px;
        }

        .tab-btn svg { width: 13px; height: 13px; }

        .tab-btn:hover { color: var(--text-primary); background: rgba(255,255,255,0.03); }

        .tab-btn.active {
            color: var(--text-primary);
            background: rgba(255,255,255,0.08);
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            font-weight: 600;
        }

        .tab-content {
            display: none;
            animation: fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .tab-content.active { display: block; }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(4px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* Panels */
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
            box-shadow: 0 4px 15px rgba(0,0,0,0.4), 0 0 10px rgba(168, 85, 247, 0.05);
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

        .status-badge.inactive { background: rgba(82,82,91,0.2); color: var(--text-secondary); }

        .pulse-dot {
            width: 6px;
            height: 6px;
            background: currentColor;
            border-radius: 50%;
            box-shadow: 0 0 8px currentColor;
            animation: pulseGlow 1.8s infinite;
        }

        @keyframes pulseGlow {
            0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; }
        }

        /* Context bar */
        .token-metric { display: flex; flex-direction: column; gap: 4px; }

        .metric-header {
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            color: var(--text-secondary);
        }

        .progress-bar-container {
            width: 100%;
            height: 8px;
            background: rgba(0,0,0,0.3);
            border-radius: 4px;
            border: 1px solid var(--border-color);
            overflow: hidden;
        }

        .progress-bar-fill {
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, var(--color-blue), var(--color-green));
            border-radius: 4px;
            transition: width 0.4s ease-out;
            box-shadow: 0 0 6px var(--color-blue);
        }

        .progress-bar-fill.warning { background: linear-gradient(90deg, var(--color-yellow), #f97316); box-shadow: 0 0 6px var(--color-yellow); }
        .progress-bar-fill.danger { background: var(--color-red); box-shadow: 0 0 8px var(--color-red); }

        /* ── Skills grid — uniform card height, 3-line description ── */
        .skills-grid {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .skill-card {
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            gap: 8px;
            background: rgba(255,255,255,0.02);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 10px;
            min-height: 96px;          /* uniform card height */
            transition: border-color 0.15s ease;
        }

        .skill-card:hover {
            border-color: rgba(244, 114, 182, 0.35);
        }

        .skill-card-top { flex: 1; display: flex; flex-direction: column; gap: 4px; }

        .skill-name {
            font-size: 11px;
            font-weight: 700;
            color: var(--color-rose);
            line-height: 1.3;
        }

        .skill-desc {
            font-size: 9.5px;
            color: var(--text-secondary);
            line-height: 1.4;
            /* 3-line clamp — uniform across all cards */
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .skill-footer {
            display: flex;
            align-items: center;
            justify-content: flex-end;
        }

        /* MCP item */
        .mcp-list { display: flex; flex-direction: column; gap: 6px; }

        .mcp-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: rgba(255,255,255,0.02);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 8px 10px;
            transition: border-color 0.15s ease;
        }

        .mcp-item:hover { border-color: rgba(168, 85, 247, 0.35); }

        .mcp-item-name { font-weight: 700; font-size: 11px; color: var(--text-primary); }
        .mcp-item-cmd { font-size: 9px; color: var(--text-secondary); font-family: monospace; margin-top: 2px; }

        /* Controls */
        .control-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
        }

        .control-info { flex: 1; }
        .control-info h4 { font-size: 11px; font-weight: 500; }
        .control-info p { font-size: 9px; color: var(--text-secondary); margin-top: 1px; line-height: 1.2; }

        .switch {
            position: relative;
            display: inline-block;
            width: 32px;
            height: 18px;
            flex-shrink: 0;
        }

        .switch input { opacity: 0; width: 0; height: 0; }

        .slider {
            position: absolute;
            cursor: pointer;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(255,255,255,0.08);
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
            box-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }

        input:checked + .slider { background-color: var(--color-green); border-color: rgba(52,199,89,0.2); }
        input:checked + .slider:before { transform: translateX(14px); }

        .chips-container {
            background: rgba(0,0,0,0.15);
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
            background: rgba(255,255,255,0.03);
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

        .remove-chip { cursor: pointer; color: var(--text-secondary); font-weight: bold; }
        .remove-chip:hover { color: var(--color-red); }

        .add-pattern-row { display: flex; gap: 4px; }

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

        .add-pattern-row input:focus { border-color: var(--color-blue); }

        /* Buttons */
        .btn-secondary {
            background: rgba(255,255,255,0.04);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            padding: 5px 8px;
            border-radius: 6px;
            font-size: 10px;
            font-weight: 500;
            cursor: pointer;
            font-family: inherit;
        }

        .btn-secondary:hover { background: rgba(255,255,255,0.08); }

        .btn-primary {
            width: 100%;
            background: var(--color-blue);
            border: none;
            color: #fff;
            padding: 7px;
            border-radius: 6px;
            font-family: inherit;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            margin-top: 4px;
        }

        .btn-copy {
            background: var(--bg-sidebar);
            border: 1px solid var(--border-color);
            color: var(--color-rose);
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 9px;
            font-weight: 700;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            transition: border-color 0.15s ease, color 0.15s ease;
            font-family: inherit;
        }

        .btn-copy:hover { border-color: var(--color-rose); }

        .btn-copy.mcp { color: var(--color-blue); }
        .btn-copy.mcp:hover { border-color: var(--color-blue); }

        .form-group { margin-bottom: 8px; }

        .form-group label {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 9px;
            font-weight: 500;
            color: var(--text-secondary);
            margin-bottom: 3px;
        }

        .form-group label span { color: var(--color-blue); font-weight: 600; }

        input[type="range"] {
            -webkit-appearance: none;
            width: 100%;
            height: 2px;
            background: rgba(255,255,255,0.08);
            border-radius: 10px;
            outline: none;
        }

        input[type="range"]::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 10px; height: 10px;
            border-radius: 50%;
            background: #fff;
            cursor: pointer;
            box-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }

        .mode-selector {
            display: flex;
            background: rgba(0,0,0,0.25);
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
            font-family: inherit;
        }

        .mode-btn.active { background: var(--color-blue); color: #fff; font-weight: 600; }

        .selective-panel-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding-top: 6px;
            border-top: 1px dashed var(--border-color);
        }

        .console-card {
            background: rgba(0,0,0,0.25);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            font-family: monospace;
            padding: 6px;
            height: 180px;
            overflow-y: auto;
            font-size: 10px;
            color: var(--text-primary);
        }

        .log-item {
            padding: 3px 0;
            border-bottom: 1px solid rgba(255,255,255,0.01);
            line-height: 1.3;
            display: flex;
            align-items: flex-start;
            gap: 4px;
        }

        .log-time { color: var(--text-secondary); white-space: nowrap; }
        .log-bullet { color: var(--color-blue); display: flex; align-items: center; margin-top: 2px; }
        .log-text { color: #d1d1d6; }
        .highlight-btn { color: var(--color-blue); font-weight: 500; }
        .highlight-pat { color: var(--color-green); }

        .empty-logs {
            color: var(--text-muted);
            text-align: center;
            padding: 60px 0;
            font-style: italic;
            font-size: 11px;
        }

        .toast {
            position: fixed;
            bottom: 15px;
            left: 50%;
            transform: translate(-50%, 100px);
            background: rgba(52,199,89,0.95);
            color: white;
            padding: 4px 10px;
            border-radius: 6px;
            font-weight: 500;
            font-size: 10px;
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            z-index: 1000;
            pointer-events: none;
        }

        .toast.show { transform: translate(-50%, 0); opacity: 1; }

        /* Model quota rows */
        .model-quota-row {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 8px 10px;
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.05);
            border-radius: 8px;
            font-size: 10px;
            transition: all 0.2s ease;
        }

        .model-quota-row.active {
            border-color: rgba(0,122,255,0.35);
            background: rgba(0,122,255,0.06);
            box-shadow: 0 0 12px rgba(0,122,255,0.08);
        }

        .model-quota-header { display: flex; align-items: center; justify-content: space-between; }

        .model-quota-name {
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
        }

        .model-quota-active-indicator {
            width: 6px; height: 6px;
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

        .quota-badge.available { background: rgba(52,199,89,0.12); color: var(--color-green); }
        .quota-badge.exhausted { background: rgba(255,59,48,0.12); color: var(--color-red); }

        .model-quota-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }

        .model-quota-countdown { font-family: monospace; font-size: 10px; color: var(--text-secondary); }
        .model-quota-mime { font-size: 8px; color: var(--text-muted); }

        .quota-bar-container { display: flex; gap: 4px; width: 100%; height: 3px; margin-top: 2px; }

        .quota-segment {
            flex: 1; height: 100%;
            background: rgba(255,255,255,0.06);
            border-radius: 2px;
            overflow: hidden;
        }

        .quota-segment-fill { height: 100%; border-radius: 2px; width: 0%; transition: width 0.3s ease-out; }
        .quota-segment-fill.bg-red { background: var(--color-red); }
        .quota-segment-fill.bg-yellow { background: var(--color-yellow); }
        .quota-segment-fill.bg-green { background: var(--color-green); }

        .reset-timer { display: flex; flex-direction: column; align-items: flex-end; }
        .reset-timer-label { font-size: 8px; color: var(--text-secondary); text-transform: uppercase; line-height: 1; }
        .reset-timer-value { font-size: 13px; font-weight: 700; font-family: monospace; line-height: 1.2; }
        .reset-timer-value.green { color: var(--color-green); }
        .reset-timer-value.yellow { color: var(--color-yellow); }
        .reset-timer-value.red { color: var(--color-red); }

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

        /* Detecting... animated state */
        .detecting-text {
            font-style: italic;
            color: var(--text-muted);
            font-size: 12px;
            animation: detectingPulse 2s ease-in-out infinite;
        }

        @keyframes detectingPulse {
            0%, 100% { opacity: 0.5; }
            50% { opacity: 1; }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <header style="display: flex; flex-direction: column; align-items: flex-start; background: var(--bg-sidebar); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px; gap: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
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
            <div style="width: 100%; height: 1px; background: var(--border-color); margin: 2px 0;"></div>
            <div style="font-size: 9px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px;">Dashboard · v${version}</div>
        </header>

        <!-- Tabs: Radar | Skills/MCP | Clicker -->
        <div class="tabs">
            <button class="tab-btn active" onclick="switchTab('radar', this)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path><path d="M2 12h20"></path></svg>
                Radar
            </button>
            <button class="tab-btn" onclick="switchTab('skills', this)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>
                Skills/MCP
            </button>
            <button class="tab-btn" onclick="switchTab('clicker', this)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                Clicker
            </button>
        </div>

        <!-- RADAR TAB -->
        <div id="tab-radar" class="tab-content active">
            <!-- Session Status -->
            <div class="glass-panel">
                <div class="panel-title">Session Status</div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <!-- Model & Active badge -->
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <h2 style="font-size: 13px; font-weight: 700; margin: 0;" id="radar-model">
                            ${isDetecting
                                ? `<span class="detecting-text">Detecting...</span>`
                                : activeModelDisplay
                            }
                        </h2>
                        <div class="status-badge ${overwatch.sessionActive ? '' : 'inactive'}" id="radar-active-badge">
                            <span class="pulse-dot"></span>
                            <span id="radar-active-status">${overwatch.sessionActive ? 'ACTIVE' : 'OFFLINE'}</span>
                        </div>
                    </div>

                    <!-- Session ID -->
                    <div style="font-size: 9px; color: var(--text-secondary); font-family: monospace;" id="radar-session-id">
                        ID: ${overwatch.sessionId ? overwatch.sessionId.substring(0, 20) + '...' : 'No active session'}
                    </div>

                    <!-- Quota & Reset Timer -->
                    <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); padding: 6px 8px; border-radius: 4px; border: 1px solid var(--border-color);">
                        <div id="radar-active-quota" style="text-align: left;">
                            <div style="font-size: 8px; color: var(--text-secondary); text-transform: uppercase; font-weight: 500; line-height: 1;">Quota Remaining</div>
                            <div style="font-size: 13px; font-weight: 700; color: ${quotaColor}; line-height: 1.2; font-family: monospace; margin-top: 2px;" id="radar-active-quota-val">${initialQuotaPct}%</div>
                        </div>
                        <div class="reset-timer" style="align-items: flex-end;">
                            <span class="reset-timer-label">Resets in</span>
                            <span class="reset-timer-value ${getCountdownColorServer(overwatch.activeModelExpiration)}" id="radar-reset-value" style="margin-top: 2px;">${formatCountdownServer(overwatch.activeModelExpiration)}</span>
                        </div>
                    </div>

                    <!-- Account & Plan -->
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 9px; border-top: 1px solid var(--border-color); padding-top: 6px; margin-top: 2px;">
                        <div>
                            <span style="color: var(--text-secondary);">Account:</span>
                            <strong id="sentinel-email" style="color: var(--text-primary); font-family: monospace; margin-left: 2px;">${overwatch.email || 'offline'}</strong>
                        </div>
                        <div>
                            <span style="color: var(--text-secondary);">Plan:</span>
                            <span id="sentinel-plan" class="quota-badge ${initialPlanClass}" style="padding: 1px 4px; font-size: 8px; margin-left: 2px;">${overwatch.plan || 'Free'}</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Account History -->
            <div class="glass-panel" id="panel-account-history">
                <div class="panel-title collapsible-header" onclick="toggleExpand('account-history-body', 'account-history-arrow')">
                    <span class="collapsible-title-text">Account History Cache</span>
                    <span id="account-history-arrow" class="collapsible-arrow" style="font-size: 8px; transition: transform 0.2s ease; display: inline-block;">▶</span>
                </div>
                <div id="account-history-body" style="display: none; flex-direction: column; gap: 2px; border-top: 1px solid var(--border-color); padding-top: 10px; margin-top: 10px;">
                    ${buildCachedAccountsHtml(data.cachedAccounts, overwatch.email)}
                </div>
            </div>

            <!-- Context Window -->
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

            <!-- Model Quotas -->
            <div class="glass-panel">
                <div class="panel-title">Model Quotas &amp; Status</div>
                <div class="models-list" id="radar-models-list" style="display: flex; flex-direction: column; gap: 6px;">
                    ${buildModelsListHtml(overwatch.modelsList, overwatch.activeModel)}
                </div>
            </div>
        </div>

        <!-- SKILLS & MCP TAB -->
        <div id="tab-skills" class="tab-content">
            <!-- How to Use -->
            <div class="glass-panel" style="background: rgba(168, 85, 247, 0.08); border-color: rgba(244, 114, 182, 0.25); gap: 6px; padding: 10px;">
                <div style="font-weight: 800; color: var(--color-rose); display: flex; align-items: center; gap: 6px; font-size: 10.5px;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                    How to Use
                </div>
                <div style="color: var(--text-secondary); font-size: 9.5px; line-height: 1.4;">
                    Click <strong style="color: var(--color-rose);">Copy Prompt</strong> on a skill card, then paste in agent chat.<br>
                    For MCP servers, click <strong style="color: var(--color-blue);">Copy Use</strong> to request the agent use that server.
                </div>
            </div>

            <!-- Skills -->
            <div class="glass-panel">
                <div class="panel-title">Active Skills</div>
                <div class="skills-grid" id="skills-grid-container">
                    <div class="empty-logs">Scanning skills...</div>
                </div>
            </div>

            <!-- MCP Servers -->
            <div class="glass-panel">
                <div class="panel-title">MCP Servers Configured</div>
                <div class="mcp-list" id="mcp-list-container">
                    <div class="empty-logs">No MCP Servers connected.</div>
                </div>
            </div>
        </div>

        <!-- CLICKER TAB -->
        <div id="tab-clicker" class="tab-content">
            <!-- Stats grid -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;">
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

            <!-- Approval Mode -->
            <div class="glass-panel">
                <div class="panel-title">Approval Mode</div>
                <div class="mode-selector" style="margin-bottom: 6px;">
                    <button class="mode-btn ${allowMode === 'all' ? 'active' : ''}" id="mode-all" onclick="changeAllowMode('all')">Allow All</button>
                    <button class="mode-btn ${allowMode === 'selective' ? 'active' : ''}" id="mode-selective" onclick="changeAllowMode('selective')">Selective</button>
                </div>
                <div class="selective-panel-list" id="selective-box-list" style="display: ${allowMode === 'selective' ? 'flex' : 'none'}">
                    <div class="control-row">
                        <div class="control-info"><h4>JS Browser Policy</h4><p>Automate custom JS actions on browser</p></div>
                        <label class="switch"><input type="checkbox" id="check-sel-browser" ${selective.browser ? 'checked' : ''} onchange="updateSelectiveState()"><span class="slider"></span></label>
                    </div>
                    <div class="control-row">
                        <div class="control-info"><h4>Terminal Auto Exec</h4><p>Runs command lines without prompt</p></div>
                        <label class="switch"><input type="checkbox" id="check-sel-command" ${selective.command ? 'checked' : ''} onchange="updateSelectiveState()"><span class="slider"></span></label>
                    </div>
                    <div class="control-row">
                        <div class="control-info"><h4>File System Access</h4><p>Allows file edits outside workspace</p></div>
                        <label class="switch"><input type="checkbox" id="check-sel-files" ${selective.files ? 'checked' : ''} onchange="updateSelectiveState()"><span class="slider"></span></label>
                    </div>
                    <div class="control-row">
                        <div class="control-info"><h4>Planning / Artifacts</h4><p>Proceed on plans automatically</p></div>
                        <label class="switch"><input type="checkbox" id="check-sel-planning" ${selective.planning ? 'checked' : ''} onchange="updateSelectiveState()"><span class="slider"></span></label>
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
                        <div class="chips-container" id="chips-container">${chipsHtml}</div>
                        <div class="add-pattern-row">
                            <input type="text" id="input-new-pattern" placeholder="e.g. Always Allow in Workspace">
                            <button class="btn-secondary" onclick="addPatternChip()">Add</button>
                        </div>
                    </div>
                    <button class="btn-primary" onclick="saveSettings()">Save Configuration</button>
                </div>
            </div>

            <!-- Approval Logs -->
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

        // ── Tab switching — uses explicit "this" parameter, no window.event dependency ──
        function switchTab(tabId, btn) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const tabEl = document.getElementById('tab-' + tabId);
            if (tabEl) tabEl.classList.add('active');
        }

        function updateRangeLabel(id, text) {
            document.getElementById('label-' + id).innerText = text;
        }

        function addPatternChip() {
            const input = document.getElementById('input-new-pattern');
            const pattern = input.value.trim();
            if (!pattern || activePatterns.includes(pattern)) { input.value = ''; return; }
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
            vscode.postMessage({ command: 'toggleAccept', enabled });
        }

        function toggleScroll() {
            const enabled = document.getElementById('check-scroll-enabled').checked;
            vscode.postMessage({ command: 'toggleScroll', enabled });
        }

        function changeAllowMode(mode) {
            currentAllowMode = mode;
            document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
            document.getElementById('mode-' + mode).classList.add('active');
            document.getElementById('selective-box-list').style.display = mode === 'selective' ? 'flex' : 'none';
            vscode.postMessage({ command: 'updateAllowMode', mode });
        }

        function updateSelectiveState() {
            const permissions = {
                browser:  document.getElementById('check-sel-browser').checked,
                command:  document.getElementById('check-sel-command').checked,
                files:    document.getElementById('check-sel-files').checked,
                planning: document.getElementById('check-sel-planning').checked
            };
            vscode.postMessage({ command: 'updateSelectivePermissions', permissions });
        }

        function saveSettings() {
            vscode.postMessage({
                command: 'saveConfig',
                data: {
                    clickIntervalMs:  parseInt(document.getElementById('range-click-interval').value),
                    scrollIntervalMs: parseInt(document.getElementById('range-scroll-interval').value),
                    scrollPauseMs:    parseInt(document.getElementById('range-scroll-pause').value),
                    clickPatterns:    activePatterns
                }
            });
            const toast = document.getElementById('toast-notify');
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2000);
        }

        function clearLogs() {
            vscode.postMessage({ command: 'clearLogs' });
            document.getElementById('console-logs').innerHTML = '<div class="empty-logs">No click events logged yet. Trigger a permission popup to test!</div>';
            document.getElementById('stats-total-clicks').innerText = '0';
        }

        // ── Countdown helpers ──────────────────────────────────────────────────
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
            if (n > 0) timeStr = \`\${n} day\${n > 1 ? 's' : ''}, \${a} hour\${a > 1 ? 's' : ''}\`;
            else if (a > 0) timeStr = \`\${a} hour\${a > 1 ? 's' : ''}, \${i} minute\${i > 1 ? 's' : ''}\`;
            else timeStr = \`\${i} minute\${i > 1 ? 's' : ''}\`;
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
            timerEl.innerText = formatCountdown(exp, true);
            timerEl.className = 'reset-timer-value ' + getCountdownColor(exp);
        }

        // Tick every second
        setInterval(() => {
            updateResetTimer();
            document.querySelectorAll('.model-quota-countdown[data-exp]').forEach(el => {
                const exp = parseInt(el.getAttribute('data-exp'));
                if (!exp) return;
                const textEl = el.querySelector('.countdown-text');
                if (textEl) textEl.innerText = formatCountdown(exp);
            });
        }, 1000);

        // ── Skills renderer ───────────────────────────────────────────────────
        function renderSkills(skills) {
            const container = document.getElementById('skills-grid-container');
            if (!skills || skills.length === 0) {
                container.innerHTML = '<div class="empty-logs">No active skills folder detected.</div>';
                return;
            }
            container.innerHTML = skills.map(skill => \`
                <div class="skill-card">
                    <div class="skill-card-top">
                        <div class="skill-name">\${skill.name}</div>
                        <div class="skill-desc">\${skill.description || 'No description available.'}</div>
                    </div>
                    <div class="skill-footer">
                        <button class="btn-copy" data-name='\${skill.name}' onclick="copySkillPrompt(this)">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                            Copy Prompt
                        </button>
                    </div>
                </div>
            \`).join('');
        }

        // ── MCP renderer ──────────────────────────────────────────────────────
        function renderMcp(mcpServers) {
            const container = document.getElementById('mcp-list-container');
            if (!mcpServers || mcpServers.length === 0) {
                container.innerHTML = '<div class="empty-logs">No custom MCP servers configured in mcp_config.json.</div>';
                return;
            }
            container.innerHTML = mcpServers.map(mcp => \`
                <div class="mcp-item">
                    <div>
                        <div class="mcp-item-name">\${mcp.name}</div>
                        <div class="mcp-item-cmd">Command: \${mcp.command}</div>
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
                        <span style="font-size: 8.5px; font-weight: bold; color: var(--color-green); display: flex; align-items: center; gap: 4px;">
                            <span class="pulse-dot" style="width: 5px; height: 5px; background: var(--color-green);"></span> \${mcp.status}
                        </span>
                        <button class="btn-copy mcp" data-name='\${mcp.name}' onclick="copyMcpPrompt(this)">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                            Copy Use
                        </button>
                    </div>
                </div>
            \`).join('');
        }

        // ── Clipboard copy ─────────────────────────────────────────────────────
        // navigator.clipboard is NOT reliable in VSCode webview sandbox.
        // Use vscode.postMessage → vscode.env.clipboard.writeText() in extension.
        function sendCopyToClipboard(text, btn) {
            vscode.postMessage({ command: 'copyToClipboard', text });
            const origHtml = btn.innerHTML;
            const origColor = btn.style.color;
            const origBorder = btn.style.borderColor;
            btn.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>\u00a0Copied!';
            btn.style.color = 'var(--color-green)';
            btn.style.borderColor = 'var(--color-green)';
            setTimeout(function() {
                btn.innerHTML = origHtml;
                btn.style.color = origColor;
                btn.style.borderColor = origBorder;
            }, 1500);
        }

        function copySkillPrompt(btn) {
            var name = btn.dataset.name;
            var text = '\u26A1 ACTIVATE SKILL: \`' + name + '\`\n\n'
                + 'Instructions:\n'
                + '1. Find and read the SKILL.md file for skill \`' + name + '\` in the skills directory (~/.gemini/config/skills/)\n'
                + '2. Read ALL instructions in that file completely \u2014 do not skim\n'
                + '3. Follow them EXACTLY \u2014 no improvising, no summarizing, no skipping steps\n'
                + '4. Apply this skill to the current task now';
            sendCopyToClipboard(text, btn);
        }

        function copyMcpPrompt(btn) {
            var name = btn.dataset.name;
            var text = 'Use the connected MCP server: \`' + name + '\`\nCall the appropriate tool on this server to fulfill the current task.';
            sendCopyToClipboard(text, btn);
        }

        // ── Account history re-render ─────────────────────────────────────────
        function renderCachedAccounts(cachedAccounts, activeEmail) {
            const container = document.getElementById('account-history-body');
            if (!container) return;

            const inactiveAccounts = (cachedAccounts || []).filter(acc => acc.email !== activeEmail);
            if (inactiveAccounts.length === 0) {
                container.innerHTML = '<div class="empty-logs" style="padding: 10px 0; text-align: center;">No cached account history.</div>';
                return;
            }

            // Preserve expand states
            const expandedStates = {};
            inactiveAccounts.forEach((acc, index) => {
                const body = document.getElementById(\`acc-history-\${index}-body\`);
                if (body) expandedStates[index] = body.style.display !== 'none';
            });

            container.innerHTML = inactiveAccounts.map((acc, index) => {
                const id = \`acc-history-\${index}\`;
                const planClass = acc.plan && acc.plan !== 'Free' ? 'available' : 'exhausted';
                const isExpanded = expandedStates[index] || false;
                const lastSeenDate = acc.lastSeen ? new Date(acc.lastSeen).toLocaleDateString() : 'Unknown';

                let modelsHtml = '<div class="empty-logs">No models data.</div>';
                if (acc.modelsList && acc.modelsList.length > 0) {
                    modelsHtml = acc.modelsList.map(m => {
                        const hasQuota = m.quota === 1;
                        const r = m.remainingFraction !== undefined ? m.remainingFraction : 0.0;
                        const barColorClass = r < 0.1 ? 'bg-red' : (r < 0.25 ? 'bg-yellow' : 'bg-green');
                        const segmentsHtml = [0,1,2,3,4].map(s => {
                            const o = s * 0.2, u = (s + 1) * 0.2;
                            let d = 0;
                            if (r >= u) d = 100;
                            else if (r > o) d = Math.round((r - o) / 0.2 * 100);
                            return \`<div class="quota-segment"><div class="quota-segment-fill \${barColorClass}" style="width:\${d}%"></div></div>\`;
                        }).join('');
                        return \`
                            <div class="model-quota-row">
                                <div class="model-quota-header">
                                    <div class="model-quota-name"><span>\${m.name}</span></div>
                                    <span class="countdown-text" style="font-size:9px;color:var(--text-secondary);">\${formatCountdown(m.expiration)}</span>
                                </div>
                                <div class="quota-bar-container">\${segmentsHtml}</div>
                                <div class="model-quota-meta">
                                    <span class="model-quota-mime">\${m.mimeTypeCount ? m.mimeTypeCount + ' types' : 'N/A'}</span>
                                    <span class="quota-badge \${hasQuota ? 'available' : 'exhausted'}">\${hasQuota ? 'Available' : 'Exhausted'}</span>
                                </div>
                            </div>
                        \`;
                    }).join('');
                }

                return \`
                    <div class="glass-panel" style="margin-bottom: 8px; padding: 10px; border-color: rgba(168,85,247,0.1); width: 100%;">
                        <div class="collapsible-header" onclick="toggleExpand('\${id}-body', '\${id}-arrow')" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                            <div style="display: flex; flex-direction: column; gap: 2px;">
                                <span style="font-size: 11px; font-weight: 700; font-family: monospace; color: var(--text-primary);">\${acc.email}</span>
                                <span class="quota-badge \${planClass}" style="align-self: flex-start; padding: 1px 4px; font-size: 8px; margin-top: 1px;">\${acc.plan || 'Free'}</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <span style="font-size: 8px; color: var(--text-muted);">Last seen: \${lastSeenDate}</span>
                                <span id="\${id}-arrow" class="collapsible-arrow" style="font-size: 8px; transition: transform 0.2s ease; display: inline-block; transform: \${isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'};">▶</span>
                            </div>
                        </div>
                        <div id="\${id}-body" style="display: \${isExpanded ? 'flex' : 'none'}; flex-direction: column; gap: 6px; border-top: 1px solid var(--border-color); padding-top: 8px; margin-top: 8px; width: 100%;">
                            <div style="font-size: 9px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 2px;">Last Known Quotas</div>
                            <div style="display: flex; flex-direction: column; gap: 6px;">\${modelsHtml}</div>
                        </div>
                    </div>
                \`;
            }).join('');
        }

        // ── Main update function (called on 5 s poll) ─────────────────────────
        function updateOverwatchUi(data) {
            renderCachedAccounts(data.cachedAccounts, data.email);

            const _statusEl = document.getElementById('radar-active-status');
            const _badgeEl  = document.getElementById('radar-active-badge');
            if (!data.sessionActive) {
                if (_statusEl) _statusEl.innerText = 'OFFLINE';
                if (_badgeEl)  _badgeEl.classList.add('inactive');
                return;
            }

            // Session info
            const _sidEl = document.getElementById('radar-session-id');
            if (_sidEl) _sidEl.innerText = 'ID: ' + (data.sessionId ? data.sessionId.substring(0, 20) + '...' : 'N/A');
            if (_statusEl) _statusEl.innerText = 'ACTIVE';
            if (_badgeEl)  _badgeEl.classList.remove('inactive');

            // Active model — null means "Detecting..."
            const modelEl = document.getElementById('radar-model');
            if (data.activeModel) {
                modelEl.innerHTML = data.activeModel;
                modelEl.style.fontStyle = 'normal';
                modelEl.style.color = '';
            } else {
                modelEl.innerHTML = '<span class="detecting-text">Detecting...</span>';
            }

            // Account & Plan
            const emailEl = document.getElementById('sentinel-email');
            if (emailEl) emailEl.innerText = data.email || 'offline';
            const planEl = document.getElementById('sentinel-plan');
            if (planEl) {
                planEl.innerText = data.plan || 'Free';
                planEl.className = 'quota-badge ' + (data.plan && data.plan !== 'Free' ? 'available' : 'exhausted');
            }

            // Quota
            const quotaValEl = document.getElementById('radar-active-quota-val');
            if (quotaValEl) {
                const actPct = Math.round((data.activeModelRemainingFraction || 0.0) * 100);
                quotaValEl.innerText = actPct + '%';
                quotaValEl.style.color = actPct < 10 ? 'var(--color-red)' : (actPct < 25 ? 'var(--color-yellow)' : 'var(--color-green)');
            }

            // Reset timer
            if (data.activeModelExpiration) {
                window.__overwatchExpiration = data.activeModelExpiration;
                updateResetTimer();
            } else {
                const timerEl = document.getElementById('radar-reset-value');
                if (timerEl) { timerEl.innerText = 'N/A'; timerEl.className = 'reset-timer-value green'; }
            }

            // Model quota list
            const modelsList = document.getElementById('radar-models-list');
            if (modelsList) {
                if (data.modelsList && data.modelsList.length > 0) {
                    window.__overwatchModels = data.modelsList;
                    window.__overwatchActiveModel = data.activeModel;
                    const order = [
                        'Gemini 3.5 Flash (Low)', 'Gemini 3.5 Flash (Medium)', 'Gemini 3.5 Flash (High)',
                        'Gemini 3.1 Pro (Low)', 'Gemini 3.1 Pro (High)',
                        'Claude Sonnet 4.6 (Thinking)', 'Claude Opus 4.6 (Thinking)', 'GPT-OSS 120B (Medium)'
                    ];
                    const sortedModels = [...data.modelsList].sort((a, b) => {
                        // Active model always first
                        if (a.name === data.activeModel) return -1;
                        if (b.name === data.activeModel) return 1;
                        const ia = order.indexOf(a.name); const ib = order.indexOf(b.name);
                        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
                    });

                    modelsList.innerHTML = sortedModels.map(m => {
                        const isActive = m.name === data.activeModel;
                        const hasQuota = m.quota === 1;
                        const r = m.remainingFraction !== undefined ? m.remainingFraction : 0.0;
                        const barColorClass = r < 0.1 ? 'bg-red' : (r < 0.25 ? 'bg-yellow' : 'bg-green');
                        const segmentsHtml = [0,1,2,3,4].map(s => {
                            const o = s * 0.2, u = (s + 1) * 0.2;
                            let d = 0;
                            if (r >= u) d = 100;
                            else if (r > o) d = Math.round((r - o) / 0.2 * 100);
                            return \`<div class="quota-segment"><div class="quota-segment-fill \${barColorClass}" style="width:\${d}%"></div></div>\`;
                        }).join('');
                        return \`
                            <div class="model-quota-row \${isActive ? 'active' : ''}" data-model-name="\${m.name}" data-expiration="\${m.expiration || ''}">
                                <div class="model-quota-header">
                                    <div class="model-quota-name">
                                        \${isActive ? '<span class="model-quota-active-indicator"></span>' : ''}
                                        <span>\${m.name}</span>
                                    </div>
                                    <div class="model-quota-countdown" data-exp="\${m.expiration || ''}">
                                        <span class="countdown-text">\${formatCountdown(m.expiration)}</span>
                                    </div>
                                </div>
                                <div class="quota-bar-container">\${segmentsHtml}</div>
                                <div class="model-quota-meta">
                                    <span class="model-quota-mime">\${m.mimeTypeCount ? m.mimeTypeCount + ' types' : 'N/A'}</span>
                                    <span class="quota-badge \${hasQuota ? 'available' : 'exhausted'}">\${hasQuota ? 'Available' : 'Exhausted'}</span>
                                </div>
                            </div>
                        \`;
                    }).join('');
                } else {
                    modelsList.innerHTML = '<div class="empty-logs">No models data found.</div>';
                }
            }

            // Context window gauge
            const _pct  = Math.min(Math.round((data.estimatedTokens / (data.contextLimit || 1)) * 100), 100);
            const _pctEl = document.getElementById('radar-token-percent');
            const _fill  = document.getElementById('radar-token-fill');
            const _compEl = document.getElementById('radar-compaction-status');
            const _tokEl  = document.getElementById('radar-token-value');
            if (_pctEl) _pctEl.innerText = _pct + '%';
            if (_fill) {
                _fill.style.width = _pct + '%';
                _fill.className = 'progress-bar-fill';
                if (_pct >= 90) { _fill.classList.add('danger'); }
                else if (_pct >= 75) { _fill.classList.add('warning'); }
            }
            const _statusTxt = _pct >= 90 ? 'CRITICAL LIMIT' : (_pct >= 75 ? 'Compacting Near' : 'Normal');
            if (_compEl) {
                _compEl.innerText = _statusTxt;
                _compEl.style.color = _statusTxt === 'CRITICAL LIMIT' ? 'var(--color-red)' : (_statusTxt === 'Compacting Near' ? 'var(--color-yellow)' : 'var(--text-secondary)');
            }
            const _fmt = n => n.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
            if (_tokEl) _tokEl.innerText = _fmt(data.estimatedTokens) + ' / ' + _fmt(data.contextLimit) + ' Tokens';

            // Skills & MCP
            renderSkills(data.skills);
            renderMcp(data.mcpServers);
        }

        // ── Message handler ───────────────────────────────────────────────────
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateOverwatch') {
                try { updateOverwatchUi(message.data); } catch(e) { console.error('[Sentinel] updateOverwatchUi error:', e); }
            } else if (message.command === 'updateState') {
                const s = message.state;
                document.getElementById('check-enabled').checked = s.enabled;
                document.getElementById('check-scroll-enabled').checked = s.scrollEnabled;
                document.getElementById('range-click-interval').value = s.clickIntervalMs || 1000;
                document.getElementById('range-scroll-interval').value = s.scrollIntervalMs || 500;
                document.getElementById('range-scroll-pause').value = s.scrollPauseMs || 7000;
                updateRangeLabel('click-interval', (s.clickIntervalMs || 1000) + ' ms');
                updateRangeLabel('scroll-interval', (s.scrollIntervalMs || 500) + ' ms');
                updateRangeLabel('scroll-pause', ((s.scrollPauseMs || 7000) / 1000).toFixed(1) + ' s');
                activePatterns = s.clickPatterns || [];
                renderChips();
                const en = s.enabled !== false;
                document.getElementById('stats-engine-status').innerText = en ? 'ACTIVE' : 'PAUSED';
                document.getElementById('stats-engine-status').style.color = en ? 'var(--color-green)' : 'var(--color-yellow)';
                document.getElementById('stats-total-clicks').innerText = s.totalClicks || 0;
                currentAllowMode = s.allowMode || 'all';
                document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
                document.getElementById('mode-' + currentAllowMode).classList.add('active');
                document.getElementById('selective-box-list').style.display = currentAllowMode === 'selective' ? 'flex' : 'none';
                const sel = s.selectivePermissions || { browser: true, command: true, files: true, planning: true };
                document.getElementById('check-sel-browser').checked = sel.browser;
                document.getElementById('check-sel-command').checked = sel.command;
                document.getElementById('check-sel-files').checked = sel.files;
                document.getElementById('check-sel-planning').checked = sel.planning;
                const logContainer = document.getElementById('console-logs');
                if (s.clickLog && s.clickLog.length > 0) {
                    logContainer.innerHTML = s.clickLog.map(log => \`
                        <div class="log-item">
                            <span class="log-time">[\${log.time || ''}]</span>
                            <span class="log-bullet"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>
                            <span class="log-text">Clicked <strong class="highlight-btn">\${log.button || ''}</strong> (<span class="highlight-pat">"\${log.pattern || ''}"</span>)</span>
                        </div>
                    \`).join('');
                } else {
                    logContainer.innerHTML = '<div class="empty-logs">No click events logged yet.</div>';
                }
            }
        });

        // Bootstrap
        try { updateOverwatchUi(${JSON.stringify(overwatch).replace(/</g, '\\u003c')}); } catch(e) { console.error('[Sentinel] bootstrap error:', e); }
    </script>
</body>
</html>`;
};
