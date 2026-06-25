const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { execSync, exec } = require('child_process');
const buildSettingsHtml = require('./settingsHtml');

// ─── Non-blocking async shell execution ──────────────────────────────────────
// All periodic/polling shell commands MUST use this instead of execSync.
// execSync is only kept for WSL one-time path detection (runs once at startup).
function execAsync(cmd, opts = {}) {
    return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 8000, encoding: 'utf8', ...opts }, (err, stdout) => {
            if (err) return reject(err);
            resolve(stdout || '');
        });
    });
}

// ─── Injection markers ────────────────────────────────────────────────────────
const TAG_START     = '<!-- ANTIGRAVITY-SUPER-SENTINEL-START -->';
const TAG_END       = '<!-- ANTIGRAVITY-SUPER-SENTINEL-END -->';
const OLD_TAG_START = '<!-- ANTIGRAVITY-CLEAN-AUTO-ACCEPT-START -->';
const OLD_TAG_END   = '<!-- ANTIGRAVITY-CLEAN-AUTO-ACCEPT-END -->';

// ─── Runtime handles ──────────────────────────────────────────────────────────
let stateWatcher            = null;
let sidebarProvider         = null;
let statusBarItem           = null;
let lspPollInterval         = null;
let sqliteRefreshInterval   = null;
let childSessionInterval    = null;
let transcriptRefreshInterval = null;   // NEW: async transcript background refresh
let sessionScanInterval     = null;     // NEW: async session discovery
let skillsRefreshInterval   = null;     // NEW: async skills background refresh
let mcpRefreshInterval      = null;     // NEW: async MCP config background refresh

// ─── LSP data cache ───────────────────────────────────────────────────────────
let cachedLspData   = { email: 'offline', plan: 'Free', modelsList: [] };
let lspQueryPending = false;    // concurrency guard — prevents overlapping queryLsp() calls

// ─── Session / transcript cache (populated by background async intervals) ─────
let cachedLatestSession        = null;
let lastSessionScanTime        = 0;
let cachedTranscriptSteps       = [];
let cachedTranscriptActiveModel = null;   // last model name seen in transcript
let cachedTranscriptTotalChars  = 0;
let cachedTranscriptPath        = '';
let cachedTranscriptMtime       = 0;

// Sticky "last known good" active model — frozen when both P1 and P2 fail,
// so indicator stays at last confident value instead of jumping to wrong model.
let lastResolvedActiveModel                  = null;
let lastResolvedActiveModelExpiration        = null;
let lastResolvedActiveModelRemainingFraction = 0.0;

// ─── SQLite cache ─────────────────────────────────────────────────────────────
let cachedSqliteData     = null;
let lastSqliteQueryTime  = 0;
let sqliteRefreshPending = false;   // prevents concurrent python subprocess launches

// ─── gatherSentinelData result cache ─────────────────────────────────────────
// Prevents redundant computation when called from multiple paths on same tick.
let _sentinelCache     = null;
let _sentinelCacheTime = 0;
const SENTINEL_TTL = 4000;          // 4 s — fresh enough for dashboard

// ─── isScriptInjected result cache ───────────────────────────────────────────
// Avoids reading large workbench.html on every status bar refresh.
let _injectedCache     = null;      // null = not yet computed
let _injectedCacheTime = 0;
const INJECTED_TTL = 10000;         // 10 s

// ─── Workbench path cache (file-system probe, stable at runtime) ───────────────
let _wbPathCache     = undefined;
let _wbPathCacheTime = 0;

// ─── readState TTL cache ──────────────────────────────────────────────────────
// Prevents double-read per update cycle (updateStatusBar + gatherSentinelData
// both call readState — they now share a 1.5 s cache instead of reading twice).
let _stateCache     = null;
let _stateCacheTime = 0;
const STATE_TTL = 1500;             // 1.5 s

// ─── Account cache write guard ────────────────────────────────────────────────
// Writes account cache to disk at most every 30 s AND only when data changes.
// Eliminates the "write every 4 s" self-triggering watcher loop.
let _lastAccountWriteTime = 0;
let _lastAccountHash      = '';
const ACCOUNT_WRITE_INTERVAL = 30000;  // 30 s minimum between disk writes

// ─── State file own-write guard ───────────────────────────────────────────────
// Track the timestamp of our own writeState() calls so the file watcher can
// ignore the event it generated (prevents self-triggered updateStatusBar loops).
let _ownStateWriteTime = 0;

// ─── Skills / MCP caches (populated by background async intervals) ─────────────
let _cachedSkills     = null;
let _cachedSkillsTime = 0;

let _cachedMcpServers = null;
let _cachedMcpTime    = 0;

// ─── Child sessions cache (populated by background 30 s interval) ──────────────
let cachedChildSessions = [];

// ─── One-time WSL path cache (computed on first access, then pinned forever) ──
let _wslLocalAppData = undefined;   // undefined = never probed; null = not in WSL
let _wslAppData      = undefined;

// ─────────────────────────────────────────────────────────────────────────────
// LSP DATA MAPPING
// ─────────────────────────────────────────────────────────────────────────────

function mapLspData(json) {
    try {
        const userStatus = json.userStatus || {};
        const email = userStatus.email || 'offline';
        const plan  = userStatus.userTier?.name || 'Free';

        const configs = userStatus.cascadeModelConfigData?.clientModelConfigs || [];
        const modelsList = configs.map(c => {
            const expTime = c.quotaInfo?.resetTime
                ? Math.floor(Date.parse(c.quotaInfo.resetTime) / 1000)
                : null;
            return {
                name:              c.label || 'Unknown',
                id:                c.modelOrAlias?.model || '',
                quota:             (c.quotaInfo?.remainingFraction || 0) > 0 ? 1 : 0,
                expiration:        expTime,
                remainingFraction: c.quotaInfo?.remainingFraction || 0.0,
                mimeTypeCount:     c.supportedMimeTypes ? Object.keys(c.supportedMimeTypes).length : 0
            };
        });

        return { email, plan, modelsList };
    } catch (e) {
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP HELPERS (fully async — no changes)
// ─────────────────────────────────────────────────────────────────────────────

function postToLsp(port, csrf) {
    return new Promise((resolve) => {
        tryHttpsPost(port, csrf, (httpsResult) => {
            if (httpsResult) return resolve(httpsResult);
            tryHttpPost(port, csrf, (httpResult) => resolve(httpResult));
        });
    });
}

function tryHttpsPost(port, csrf, cb) {
    let called = false;
    const safeCb = (val) => { if (called) return; called = true; cb(val); };

    const payload = JSON.stringify({
        metadata: { ideName: 'vscode', extensionName: 'vscode', ideVersion: '1.75.0', locale: 'en' }
    });

    const options = {
        hostname: '127.0.0.1',
        port,
        path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-codeium-csrf-token': csrf,
            'Authorization': `Basic ${csrf}`,
            'Content-Length': Buffer.byteLength(payload),
            'Connection': 'close'
        },
        rejectUnauthorized: false
    };

    const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
            try {
                safeCb(res.statusCode === 200 ? mapLspData(JSON.parse(body)) : null);
            } catch (e) { safeCb(null); }
        });
    });

    req.setTimeout(1500, () => { req.destroy(); safeCb(null); });
    req.on('error', () => safeCb(null));
    req.write(payload);
    req.end();
}

function tryHttpPost(port, csrf, cb) {
    let called = false;
    const safeCb = (val) => { if (called) return; called = true; cb(val); };

    const payload = JSON.stringify({
        metadata: { ideName: 'vscode', extensionName: 'vscode', ideVersion: '1.75.0', locale: 'en' }
    });

    const options = {
        hostname: '127.0.0.1',
        port,
        path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-codeium-csrf-token': csrf,
            'Authorization': `Basic ${csrf}`,
            'Content-Length': Buffer.byteLength(payload),
            'Connection': 'close'
        }
    };

    const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
            try {
                safeCb(res.statusCode === 200 ? mapLspData(JSON.parse(body)) : null);
            } catch (e) { safeCb(null); }
        });
    });

    req.setTimeout(1500, () => { req.destroy(); safeCb(null); });
    req.on('error', () => safeCb(null));
    req.write(payload);
    req.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// LSP QUERY — fully async, no main-thread blocking
// ─────────────────────────────────────────────────────────────────────────────

async function queryLsp() {
    try {
        if (process.platform === 'win32') {
            let cmdOut = '';
            try {
                cmdOut = await execAsync(
                    `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'Name like ''%language_server%''' | Select-Object ProcessId, CommandLine | ConvertTo-Json"`
                );
            } catch (e) {
                return null;
            }
            if (!cmdOut.trim()) return null;

            let processes = [];
            try {
                processes = JSON.parse(cmdOut);
                if (!Array.isArray(processes)) processes = [processes];
            } catch (e) {
                return null;
            }

            for (const proc of processes) {
                if (!proc || !proc.CommandLine || !proc.ProcessId) continue;
                const cmdLine = proc.CommandLine;
                const pid     = proc.ProcessId;

                const tokenMatch = cmdLine.match(/--csrf_token[\s=]+([^\s]+)/);
                if (!tokenMatch) continue;
                const csrf = tokenMatch[1].replace(/['"]+/g, '').trim();

                let netstatOut = '';
                try {
                    netstatOut = await execAsync(`netstat -ano | findstr LISTENING | findstr ${pid}`);
                } catch (e) {}

                const ports = [];
                if (netstatOut.trim()) {
                    netstatOut.trim().split(/\r?\n/).forEach((l) => {
                        const parts = l.trim().split(/\s+/);
                        if (parts.length >= 2) {
                            const localAddress = parts[1];
                            const port = localAddress.substring(localAddress.lastIndexOf(':') + 1);
                            if (port && !isNaN(Number(port))) ports.push(port);
                        }
                    });
                }

                const cmdPortMatch = cmdLine.match(/--extension_server_port[\s=]+([^\s]+)/);
                if (cmdPortMatch) {
                    ports.push(cmdPortMatch[1].replace(/['"]+/g, '').trim());
                }

                const uniquePorts = [...new Set(ports)];
                for (const port of uniquePorts) {
                    const result = await postToLsp(port, csrf);
                    if (result) return result;
                }
            }
            return null;

        } else {
            let psOut = '';
            try {
                psOut = await execAsync('ps -ef | grep language_server | grep -v grep');
            } catch (e) {
                return null;
            }
            if (!psOut.trim()) return null;

            const lines = psOut.trim().split(/\r?\n/);
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[1];
                if (!pid || isNaN(Number(pid))) continue;

                const tokenMatch = line.match(/--csrf_token[\s=]+([^\s]+)/);
                if (!tokenMatch) continue;
                const csrf = tokenMatch[1].replace(/['"]+/g, '').trim();

                let lsofOut = '';
                try {
                    lsofOut = await execAsync(`lsof -nP -iTCP -sTCP:LISTEN -a -p ${pid}`);
                } catch (e) {
                    try {
                        lsofOut = await execAsync(`ss -lntp | grep "pid=${pid}," || true`);
                    } catch (e2) {}
                }

                if (!lsofOut.trim()) continue;

                const ports = [];
                lsofOut.trim().split(/\r?\n/).forEach((l) => {
                    const portMatch = l.match(/:(\d+)\s+/) || l.match(/127\.0\.0\.1:(\d+)/);
                    if (portMatch) ports.push(portMatch[1]);
                });

                const uniquePorts = [...new Set(ports)];
                for (const port of uniquePorts) {
                    const result = await postToLsp(port, csrf);
                    if (result) return result;
                }
            }
        }
    } catch (e) {
        // Ignore
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SQLITE MODEL INFO — async background refresh, instant cache reads
// ─────────────────────────────────────────────────────────────────────────────

async function refreshSqliteAsync() {
    if (sqliteRefreshPending) return;
    sqliteRefreshPending = true;
    try {
        const pythonScript = path.join(__dirname, 'query_model_info.py');
        const pythonCmd    = process.platform === 'win32' ? 'python' : 'python3';
        const out = await execAsync(`${pythonCmd} "${pythonScript}"`);
        if (out && out.trim()) {
            cachedSqliteData    = JSON.parse(out);
            lastSqliteQueryTime = Date.now();
        }
    } catch (e) {
        lastSqliteQueryTime = Date.now();   // back-off prevents tight retry loop
    } finally {
        sqliteRefreshPending = false;
    }
}

// Returns cached data instantly. Background refresh is driven by sqliteRefreshInterval.
function getSqliteModelInfo() {
    return cachedSqliteData;
}

function getActiveModelIdFromSqlite() {
    const modelInfo = getSqliteModelInfo();
    return modelInfo ? modelInfo.activeModelId : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ASYNC SESSION SCAN — runs in background every 15 s
// Fully async (fs.promises). NEVER called from gatherSentinelData() hot path.
// ─────────────────────────────────────────────────────────────────────────────

async function refreshSessionAsync() {
    try {
        const homedir  = os.homedir();
        const brainDir = path.join(homedir, '.gemini', 'antigravity-ide', 'brain');

        let entries;
        try {
            entries = await fs.promises.readdir(brainDir);
        } catch (e) { return; }   // brainDir doesn't exist yet

        let latestTime    = 0;
        let latestSession = null;

        for (const session of entries) {
            const tPath = path.join(brainDir, session, '.system_generated', 'logs', 'transcript.jsonl');
            try {
                const stat = await fs.promises.stat(tPath);
                if (stat.mtimeMs > latestTime) {
                    latestTime    = stat.mtimeMs;
                    latestSession = {
                        id:             session,
                        path:           path.join(brainDir, session),
                        transcriptPath: tPath
                    };
                }
            } catch (e) {}  // file doesn't exist for this session — skip
        }

        if (latestSession) cachedLatestSession = latestSession;
        lastSessionScanTime = Date.now();
    } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// ASYNC TRANSCRIPT PARSE — runs in background every 3 s
// Fully async (fs.promises). Populates transcript caches.
// NEVER blocks the main thread. gatherSentinelData() reads from these caches.
// ─────────────────────────────────────────────────────────────────────────────

async function refreshTranscriptAsync() {
    try {
        if (!cachedLatestSession) return;
        const tPath = cachedLatestSession.transcriptPath;

        // Async stat — check if file changed since last parse
        let stat;
        try {
            stat = await fs.promises.stat(tPath);
        } catch (e) { return; }

        // Nothing changed — skip expensive parse
        if (tPath === cachedTranscriptPath && stat.mtimeMs === cachedTranscriptMtime) return;

        // Async read — no main-thread blocking even for large transcripts
        const content = await fs.promises.readFile(tPath, 'utf8');
        const lines   = content.trim().split('\n').filter(l => l.trim().length > 0);

        let totalCharacters       = 0;
        let transcriptActiveModel = null;
        const steps               = [];

        for (const line of lines) {
            try {
                const step = JSON.parse(line);
                steps.push({
                    step_index:     step.step_index,
                    source:         step.source,
                    type:           step.type,
                    status:         step.status,
                    created_at:     step.created_at,
                    content_length: step.content ? step.content.length : 0,
                    tool_calls:     step.tool_calls ? step.tool_calls.map(tc => {
                        let toolArgs = {};
                        try { toolArgs = typeof tc.args === 'string' ? JSON.parse(tc.args) : tc.args; } catch (e) {}
                        return {
                            name:    tc.name,
                            summary: toolArgs.toolSummary || toolArgs.toolAction || tc.name || ''
                        };
                    }) : []
                });

                if (step.content) {
                    totalCharacters += step.content.length;
                    // Priority 1: transcript-based model detection.
                    // System injects USER_SETTINGS_CHANGE on every model switch
                    // with exact human-readable display name — no ID mapping needed.
                    if (step.content.includes('Model Selection')) {
                        const match = step.content.match(/Model Selection[`'"\\]*\s+from\s+(.*?)\s+to\s+(.*?)(?:\.\s|\n|<|$)/i);
                        if (match && match[2]) {
                            let toVal = match[2].trim();
                            if (toVal.endsWith('.')) toVal = toVal.slice(0, -1);
                            transcriptActiveModel = toVal.replace(/[`]/g, '').trim();
                        }
                    }
                }
            } catch (e) {}
        }

        // Commit to shared caches — gatherSentinelData() reads these
        cachedTranscriptSteps       = steps;
        cachedTranscriptActiveModel = transcriptActiveModel;
        cachedTranscriptTotalChars  = totalCharacters;
        cachedTranscriptPath        = tPath;
        cachedTranscriptMtime       = stat.mtimeMs;

        // Invalidate sentinel cache so dashboard picks up new transcript data
        _sentinelCache     = null;
        _sentinelCacheTime = 0;

    } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// ASYNC SKILLS SCAN — runs in background every 60 s
// ─────────────────────────────────────────────────────────────────────────────

async function refreshSkillsAsync() {
    try {
        const homedir   = os.homedir();
        const skillsDir = path.join(homedir, '.gemini', 'config', 'skills');

        let folders;
        try {
            folders = await fs.promises.readdir(skillsDir);
        } catch (e) {
            _cachedSkills     = [];
            _cachedSkillsTime = Date.now();
            return;
        }

        const skills = [];
        for (const folder of folders) {
            const skillMdPath = path.join(skillsDir, folder, 'SKILL.md');
            try {
                const skillMd   = await fs.promises.readFile(skillMdPath, 'utf8');
                let skillName   = folder;
                let skillDesc   = '';
                const matchName = skillMd.match(/name:\s*(.*)/i);
                const matchDesc = skillMd.match(/description:\s*>([\s\S]*?)---/i) || skillMd.match(/description:\s*(.*)/i);
                if (matchName) skillName = matchName[1].trim();
                if (matchDesc) skillDesc = matchDesc[1].trim().replace(/\n/g, ' ');
                skills.push({ name: skillName, description: skillDesc });
            } catch (e) {}
        }

        _cachedSkills     = skills;
        _cachedSkillsTime = Date.now();
    } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// ASYNC MCP CONFIG SCAN — runs in background every 30 s
// ─────────────────────────────────────────────────────────────────────────────

async function refreshMcpAsync() {
    try {
        const homedir = os.homedir();
        const mcpPath = path.join(homedir, '.gemini', 'config', 'mcp_config.json');
        try {
            const raw     = await fs.promises.readFile(mcpPath, 'utf8');
            const mcpJson = JSON.parse(raw);
            const servers = [];
            if (mcpJson && mcpJson.mcpServers) {
                for (const serverName in mcpJson.mcpServers) {
                    servers.push({
                        name:    serverName,
                        command: mcpJson.mcpServers[serverName].command,
                        status:  'Active'
                    });
                }
            }
            _cachedMcpServers = servers;
            _cachedMcpTime    = Date.now();
        } catch (e) {
            _cachedMcpServers = [];
            _cachedMcpTime    = Date.now();
        }
    } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// ASYNC CHILD SESSION REFRESH — runs on dedicated 30 s interval
// Fixed to use fs.promises instead of blocking fs.readdirSync.
// ─────────────────────────────────────────────────────────────────────────────

async function refreshChildSessionsAsync() {
    try {
        const homedir          = os.homedir();
        const conversationsDir = path.join(homedir, '.gemini', 'antigravity-ide', 'conversations');
        const agentapiBinName  = process.platform === 'win32' ? 'agentapi.bat' : 'agentapi';
        const agentapiPath     = path.join(homedir, '.gemini', 'antigravity-ide', 'bin', agentapiBinName);

        // Check existence without blocking (these are quick existsSync on local paths)
        if (!fs.existsSync(conversationsDir) || !fs.existsSync(agentapiPath)) return;
        if (!cachedLatestSession) return;

        const sessionId = cachedLatestSession.id;

        // Use fs.promises for async directory read
        let files;
        try {
            files = await fs.promises.readdir(conversationsDir);
        } catch (e) { return; }

        const dbFiles = files.filter(f => f.endsWith('.db') && !f.includes(sessionId));

        const results = [];
        for (const dbFile of dbFiles) {
            const subSessionId = dbFile.substring(0, dbFile.length - 3);
            try {
                const metadataRaw = await execAsync(`"${agentapiPath}" get-conversation-metadata ${subSessionId}`);
                const metaData    = JSON.parse(metadataRaw);
                const parentId    = metaData?.response?.conversationMetadata?.metadata?.parentConversationId;
                if (parentId === sessionId) {
                    results.push({
                        id:           subSessionId,
                        nestingDepth: metaData?.response?.conversationMetadata?.metadata?.nestingDepth || 1
                    });
                }
            } catch (e) {}
        }
        cachedChildSessions = results;
    } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function writeFile(filePath, content) {
    try {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`[Sentinel] Successfully wrote: ${filePath}`);
    } catch (err) {
        console.error(`[Sentinel] Write failed for ${filePath}:`, err.message);
        throw err;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// WSL PATH HELPERS — computed once at first access, then pinned forever.
// execSync is acceptable: one-time cost at startup, never repeated.
// ─────────────────────────────────────────────────────────────────────────────

function getWslWindowsLocalAppData() {
    if (_wslLocalAppData !== undefined) return _wslLocalAppData;
    _wslLocalAppData = _computeWslLocalAppData();
    return _wslLocalAppData;
}

function _computeWslLocalAppData() {
    try {
        if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
            try {
                const out = execSync('/mnt/c/Windows/System32/cmd.exe /c "echo %LOCALAPPDATA%"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
                if (out && out.match(/^[a-zA-Z]:\\/)) {
                    const drive     = out[0].toLowerCase();
                    const remainder = out.substring(2).replace(/\\/g, '/');
                    return `/mnt/${drive}${remainder}`;
                }
            } catch (cmdErr) {}

            const paths = (process.env.PATH || '').split(':');
            for (const p of paths) {
                const match = p.match(/\/mnt\/([a-zA-Z])\/Users\/([^\/]+)\/AppData\/Local/i);
                if (match) {
                    const localAppData = `/mnt/${match[1].toLowerCase()}/Users/${match[2]}/AppData/Local`;
                    if (fs.existsSync(localAppData)) return localAppData;
                }
            }

            for (const d of ['c', 'd', 'e']) {
                const usersDir = `/mnt/${d}/Users`;
                if (!fs.existsSync(usersDir)) continue;
                const users = fs.readdirSync(usersDir);
                const skip  = ['Public', 'All Users', 'Default', 'Default User', 'desktop.ini'];
                for (const u of users) {
                    if (skip.includes(u)) continue;
                    const lad = path.join(usersDir, u, 'AppData', 'Local');
                    if (fs.existsSync(path.join(lad, 'Programs', 'Antigravity IDE'))) return lad;
                }
                for (const u of users) {
                    if (skip.includes(u)) continue;
                    const lad = path.join(usersDir, u, 'AppData', 'Local');
                    if (fs.existsSync(lad)) return lad;
                }
            }
        }
    } catch (e) {}
    return null;
}

function getWslWindowsAppData() {
    if (_wslAppData !== undefined) return _wslAppData;
    _wslAppData = _computeWslAppData();
    return _wslAppData;
}

function _computeWslAppData() {
    try {
        if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
            try {
                const out = execSync('/mnt/c/Windows/System32/cmd.exe /c "echo %APPDATA%"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
                if (out && out.match(/^[a-zA-Z]:\\/)) {
                    const drive     = out[0].toLowerCase();
                    const remainder = out.substring(2).replace(/\\/g, '/');
                    return `/mnt/${drive}${remainder}`;
                }
            } catch (cmdErr) {}

            const paths = (process.env.PATH || '').split(':');
            for (const p of paths) {
                const match = p.match(/\/mnt\/([a-zA-Z])\/Users\/([^\/]+)\/AppData\/Local/i);
                if (match) {
                    const appData = `/mnt/${match[1].toLowerCase()}/Users/${match[2]}/AppData/Roaming`;
                    if (fs.existsSync(appData)) return appData;
                }
            }

            for (const d of ['c', 'd', 'e']) {
                const usersDir = `/mnt/${d}/Users`;
                if (!fs.existsSync(usersDir)) continue;
                const users = fs.readdirSync(usersDir);
                const skip  = ['Public', 'All Users', 'Default', 'Default User', 'desktop.ini'];
                for (const u of users) {
                    if (skip.includes(u)) continue;
                    const ad = path.join(usersDir, u, 'AppData', 'Roaming');
                    if (fs.existsSync(path.join(ad, 'Antigravity IDE'))) return ad;
                }
                for (const u of users) {
                    if (skip.includes(u)) continue;
                    const ad = path.join(usersDir, u, 'AppData', 'Roaming');
                    if (fs.existsSync(ad)) return ad;
                }
            }
        }
    } catch (e) {}
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKBENCH PATH — TTL cached (60 s when found, 5 s when not found)
// ─────────────────────────────────────────────────────────────────────────────

function getWorkbenchPath() {
    const now = Date.now();
    if (_wbPathCache !== undefined) {
        const ttl = _wbPathCache !== null ? 60000 : 5000;
        if (now - _wbPathCacheTime < ttl) return _wbPathCache;
    }
    _wbPathCache     = _computeWorkbenchPath();
    _wbPathCacheTime = now;
    return _wbPathCache;
}

function _computeWorkbenchPath() {
    const candidates = [];

    const wslLocalAppData = getWslWindowsLocalAppData();
    if (wslLocalAppData) {
        candidates.push(path.join(wslLocalAppData, 'Programs', 'Antigravity IDE', 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'));
        candidates.push(path.join(wslLocalAppData, 'Programs', 'Antigravity IDE', 'resources', 'app', 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'));
        candidates.push(path.join(wslLocalAppData, 'Programs', 'Antigravity IDE', 'resources', 'app', 'out', 'vs', 'workbench', 'workbench.html'));
    }

    const appRoot = vscode.env.appRoot;
    candidates.push(
        path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.html')
    );
    candidates.push(
        '/opt/antigravity-ide/resources/app/out/vs/code/electron-browser/workbench/workbench.html',
        '/opt/antigravity-ide/resources/app/out/vs/code/electron-sandbox/workbench/workbench.html',
        '/opt/antigravity-ide/resources/app/out/vs/workbench/workbench.html'
    );

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT.JSON PATH
// ─────────────────────────────────────────────────────────────────────────────

function getProductJsonPath() {
    const candidates = [];

    const wslLocalAppData = getWslWindowsLocalAppData();
    if (wslLocalAppData) {
        candidates.push(path.join(wslLocalAppData, 'Programs', 'Antigravity IDE', 'resources', 'app', 'product.json'));
    }

    if (process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, 'app', 'product.json'));
    }
    const appRoot = vscode.env.appRoot;
    candidates.push(path.join(appRoot, 'product.json'));
    candidates.push('/opt/antigravity-ide/resources/app/product.json');

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECKSUM UPDATE (one-time on inject/remove — not periodic)
// ─────────────────────────────────────────────────────────────────────────────

function updateChecksums() {
    try {
        const productPath = getProductJsonPath();
        if (!productPath) {
            console.log('[Sentinel] product.json not found, skipping checksum update.');
            return;
        }

        console.log(`[Sentinel] Updating checksums in: ${productPath}`);
        const productJson = JSON.parse(fs.readFileSync(productPath, 'utf8'));
        if (!productJson.checksums) {
            console.log('[Sentinel] Checksums property missing in product.json.');
            return;
        }

        const appRoot = path.dirname(productPath);
        const outDir  = path.join(appRoot, 'out');
        let updated   = false;

        for (const relativePath in productJson.checksums) {
            const nativePath = relativePath.split('/').join(path.sep);
            let filePath     = path.join(outDir, nativePath);
            if (!fs.existsSync(filePath)) {
                filePath = path.join(appRoot, relativePath);
            }

            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath);
                const hash    = crypto.createHash('sha256').update(content).digest('base64').replace(/=+$/, '');
                if (productJson.checksums[relativePath] !== hash) {
                    productJson.checksums[relativePath] = hash;
                    updated = true;
                    console.log(`[Sentinel] Hash updated for ${relativePath}`);
                }
            }
        }

        if (updated) {
            writeFile(productPath, JSON.stringify(productJson, null, '\t'));
            console.log('[Sentinel] Checksums updated in product.json.');
        }
    } catch (e) {
        console.error('[Sentinel] Checksum update failed:', e.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// V8 CODE CACHE CLEAR (one-time on inject/remove)
// ─────────────────────────────────────────────────────────────────────────────

function clearCodeCache() {
    try {
        const candidates = [];

        const wslAppData = getWslWindowsAppData();
        if (wslAppData) {
            candidates.push(path.join(wslAppData, 'Antigravity IDE', 'Code Cache', 'js'));
        }

        if (process.platform === 'win32' && process.env.APPDATA) {
            candidates.push(path.join(process.env.APPDATA, 'Antigravity IDE', 'Code Cache', 'js'));
        }

        candidates.push(path.join(os.homedir(), '.config', 'Antigravity IDE', 'Code Cache', 'js'));

        for (const cacheDir of candidates) {
            if (fs.existsSync(cacheDir)) {
                fs.rmSync(cacheDir, { recursive: true, force: true });
                console.log(`[Sentinel] Cleared cache directory: ${cacheDir}`);
            }
        }
    } catch (e) {
        console.warn('[Sentinel] Failed to clear V8 code cache:', e.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRIPT CONTENT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function buildScriptContent(context, wbPath) {
    const templatePath = path.join(context.extensionPath, 'media', 'autoScript.js');
    let content = fs.readFileSync(templatePath, 'utf8');

    let wbDir = path.dirname(wbPath);
    if (wbDir.startsWith('/mnt/')) {
        const drive = wbDir[5].toUpperCase();
        wbDir = `${drive}:${wbDir.substring(6)}`;
    }
    wbDir = wbDir.replace(/\\/g, '/');
    content = content.replace(/\/\*\{\{WORKBENCH_DIR\}\}\*\/""/, JSON.stringify(wbDir));
    return content;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE FILE HELPERS — with TTL cache and own-write guard
// ─────────────────────────────────────────────────────────────────────────────

function getStateFilePath() {
    const wbPath = getWorkbenchPath();
    if (!wbPath) return null;
    return path.join(path.dirname(wbPath), 'ag-super-sentinel-state.json');
}

// readState() with TTL cache (1.5 s).
// Prevents double-read per update cycle — updateStatusBar + gatherSentinelData
// both call this, they now share the same cached object.
function readState() {
    const now = Date.now();
    if (_stateCache && (now - _stateCacheTime < STATE_TTL)) return _stateCache;

    const statePath = getStateFilePath();
    if (statePath && fs.existsSync(statePath)) {
        try {
            const raw   = fs.readFileSync(statePath, 'utf8');
            const state = JSON.parse(raw);
            if (!state.cachedAccounts) state.cachedAccounts = [];
            _stateCache     = state;
            _stateCacheTime = now;
            return state;
        } catch (e) {
            console.error('[Sentinel] Failed to parse state JSON:', e.message);
        }
    }

    const defaultState = {
        enabled: true,
        scrollEnabled: true,
        scrollPauseMs: 7000,
        clickIntervalMs: 1000,
        scrollIntervalMs: 500,
        allowMode: 'all',
        selectivePermissions: {
            browser: true,
            command: true,
            files: true,
            planning: true
        },
        clickPatterns: [
            'Allow', 'Always Allow', 'Allow Once', 'Allow This Con', 'Allow in Workspace',
            'Always Allow in Workspace', 'Always Proceed', 'Proceed to execution',
            'Yes, approve', 'Approve', 'Run', 'Always Run', 'Submit', 'Accept',
            'Accept all', 'Keep Waiting', 'Retry', 'Yes, allow this time',
            'Yes, and always allow', 'Yes, always run', 'Yes, run'
        ],
        totalClicks: 0,
        clickStats: {},
        clickLog: [],
        cachedAccounts: []
    };
    _stateCache     = defaultState;
    _stateCacheTime = now;
    return defaultState;
}

// writeState() records its timestamp so the file watcher can ignore the
// event it self-generates (prevents spurious updateStatusBar calls).
function writeState(state) {
    const statePath = getStateFilePath();
    if (!statePath) return;
    try {
        _ownStateWriteTime = Date.now();
        writeFile(statePath, JSON.stringify(state, null, 4));
        // Update in-memory cache immediately to reflect what we just wrote
        _stateCache     = state;
        _stateCacheTime = Date.now();
    } catch (e) {
        console.error('[Sentinel] Failed to write state:', e.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRIPT INJECTION / REMOVAL
// ─────────────────────────────────────────────────────────────────────────────

function injectScript(context, silent = false) {
    const wbPath = getWorkbenchPath();
    if (!wbPath) {
        if (!silent) {
            vscode.window.showErrorMessage('[Sentinel] workbench.html not found!');
        } else {
            console.warn('[Sentinel] Auto-inject failed: workbench.html not found.');
        }
        return false;
    }

    const wbDir          = path.dirname(wbPath);
    const destScriptPath = path.join(wbDir, 'ag-super-sentinel-script.js');

    try {
        let html = fs.readFileSync(wbPath, 'utf8');

        const oldRegex = new RegExp(`${escapeRegex(OLD_TAG_START)}[\\s\\S]*?${escapeRegex(OLD_TAG_END)}`, 'g');
        html = html.replace(oldRegex, '');

        const newRegex = new RegExp(`${escapeRegex(TAG_START)}[\\s\\S]*?${escapeRegex(TAG_END)}`, 'g');
        html = html.replace(newRegex, '');

        const scriptContent = buildScriptContent(context, wbPath);
        writeFile(destScriptPath, scriptContent);

        const ts        = Date.now();
        const injection = `\n${TAG_START}\n<script src="ag-super-sentinel-script.js?v=${ts}"></script>\n${TAG_END}`;

        if (/<\/body>/i.test(html)) {
            html = html.replace(/<\/body>/i, injection + '\n</body>');
        } else if (/<\/html>/i.test(html)) {
            html = html.replace(/<\/html>/i, injection + '\n</html>');
        } else {
            html += injection;
        }

        writeFile(wbPath, html);

        const statePath = getStateFilePath();
        if (statePath && !fs.existsSync(statePath)) {
            writeState(readState());
        }

        // Invalidate injection status cache immediately
        _injectedCache     = true;
        _injectedCacheTime = Date.now();
        // Pin workbench path (now confirmed valid)
        _wbPathCache       = wbPath;
        _wbPathCacheTime   = Date.now();

        return true;
    } catch (e) {
        if (!silent) {
            vscode.window.showErrorMessage(`[Sentinel] Injection failed: ${e.message}`);
        } else {
            console.warn(`[Sentinel] Auto-inject failed: ${e.message}`);
        }
        return false;
    }
}

function removeScript() {
    const wbPath = getWorkbenchPath();
    if (!wbPath) return false;

    const wbDir          = path.dirname(wbPath);
    const destScriptPath = path.join(wbDir, 'ag-super-sentinel-script.js');
    const statePath      = path.join(wbDir, 'ag-super-sentinel-state.json');

    try {
        let html = fs.readFileSync(wbPath, 'utf8');

        const newRegex = new RegExp(`${escapeRegex(TAG_START)}[\\s\\S]*?${escapeRegex(TAG_END)}`, 'g');
        html = html.replace(newRegex, '');
        writeFile(wbPath, html);

        if (fs.existsSync(destScriptPath)) fs.unlinkSync(destScriptPath);
        if (fs.existsSync(statePath))      fs.unlinkSync(statePath);

        // Invalidate injection status cache immediately
        _injectedCache     = false;
        _injectedCacheTime = Date.now();

        console.log('[Sentinel] Workbench HTML injection removed successfully.');
        return true;
    } catch (e) {
        vscode.window.showErrorMessage(`[Sentinel] Removal failed: ${e.message}`);
        return false;
    }
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRIPT INJECTION STATUS — TTL cached, avoids reading workbench.html repeatedly
// ─────────────────────────────────────────────────────────────────────────────

function isScriptInjected(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && _injectedCache !== null && (now - _injectedCacheTime < INJECTED_TTL)) {
        return _injectedCache;
    }
    try {
        const wbPath = getWorkbenchPath();
        if (!wbPath) {
            _injectedCache     = false;
            _injectedCacheTime = now;
            return false;
        }
        const html = fs.readFileSync(wbPath, 'utf8');
        _injectedCache     = html.includes(TAG_START) && html.includes(TAG_END);
        _injectedCacheTime = now;
        return _injectedCache;
    } catch (e) {
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS BAR — all dependencies are TTL-cached, call cost is negligible
// ─────────────────────────────────────────────────────────────────────────────

function formatCountdown(expirationSec) {
    if (!expirationSec) return 'No Reset';
    const now  = Math.floor(Date.now() / 1000);
    const diff = expirationSec - now;
    if (diff <= 0) return '0m';
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function updateStatusBar() {
    if (!statusBarItem) return;

    const wbPath    = getWorkbenchPath();
    const state     = readState();         // 1.5 s TTL cache — usually cache hit
    const injected  = wbPath ? isScriptInjected() : false;
    const data      = gatherSentinelData();    // 4 s TTL cache + zero file I/O

    const activeModel = data.activeModel || 'Gemini 3.5 Flash (High)';
    const quotaPct    = Math.round((data.activeModelRemainingFraction || 0.0) * 100);
    const countdown   = formatCountdown(data.activeModelExpiration);

    if (!wbPath) {
        statusBarItem.text            = `$(circle-slash) Kadzura Super Sentinel : NO UI ACCESS | ${activeModel} ${quotaPct}% (${countdown})`;
        statusBarItem.tooltip         = `Antigravity Super Sentinel clicker cannot locate workbench.html.\nActive Model: ${activeModel}\nQuota Remaining: ${quotaPct}%\nReset in: ${countdown}\nTelemetry is active, but auto-clicker is disabled.`;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        statusBarItem.color           = '#fbbf24';
    } else if (!injected) {
        statusBarItem.text            = `$(circle-slash) Kadzura Super Sentinel : NOT INSTALLED | ${activeModel} ${quotaPct}% (${countdown})`;
        statusBarItem.tooltip         = `Antigravity Super Sentinel clicker is not injected.\nActive Model: ${activeModel}\nQuota Remaining: ${quotaPct}%\nReset in: ${countdown}\nClick to install/enable.`;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        statusBarItem.color           = '#ef4444';
    } else {
        if (state.enabled) {
            statusBarItem.text            = `$(eye) Kadzura Super Sentinel : ACTIVE | ${activeModel} ${quotaPct}% (${countdown})`;
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.remoteBackground');
            statusBarItem.color           = '#c084fc';
            statusBarItem.tooltip         = `Antigravity Super Sentinel clicker is Active.\nActive Model: ${activeModel}\nQuota Remaining: ${quotaPct}%\nReset in: ${countdown}\nClick to open Sentinel Dashboard.`;
        } else {
            statusBarItem.text            = `$(circle-slash) Kadzura Super Sentinel : PAUSED | ${activeModel} ${quotaPct}% (${countdown})`;
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            statusBarItem.color           = '#fbbf24';
            statusBarItem.tooltip         = `Antigravity Super Sentinel clicker is Paused.\nActive Model: ${activeModel}\nQuota Remaining: ${quotaPct}%\nReset in: ${countdown}\nClick to open Sentinel Dashboard.`;
        }
    }
    statusBarItem.show();
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE FILE WATCHER — with self-write guard and state cache invalidation
// ─────────────────────────────────────────────────────────────────────────────

function setupStateFileWatcher() {
    if (stateWatcher) return;
    const statePath = getStateFilePath();
    if (!statePath) return;

    try {
        stateWatcher = fs.watch(statePath, (eventType) => {
            if (eventType === 'change') {
                // Ignore events triggered by our own writeState() calls.
                // 300 ms window covers any OS-level write buffer flush delay.
                if (Date.now() - _ownStateWriteTime < 300) return;

                // Genuine external write (e.g. auto-clicker script reporting a click):
                // invalidate state cache so next readState() gets fresh data.
                _stateCache     = null;
                _stateCacheTime = 0;

                const latestState = readState();
                updateStatusBar();

                if (sidebarProvider && sidebarProvider._view) {
                    sidebarProvider._view.webview.postMessage({
                        command: 'updateState',
                        state:   latestState
                    });
                }
            }
        });
        console.log(`[Sentinel] Started state file watcher on: ${statePath}`);
    } catch (e) {
        console.error('[Sentinel] Failed to start file watcher:', e.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GATHER SENTINEL DATA — 100% memory-only hot path.
// All file I/O has been moved to dedicated background async intervals.
// This function assembles data from caches they populate — zero blocking.
// ─────────────────────────────────────────────────────────────────────────────

function gatherSentinelData() {
    // ── Fast path: return cached result if still fresh ──────────────────────
    const now = Date.now();
    if (_sentinelCache && (now - _sentinelCacheTime < SENTINEL_TTL)) {
        return _sentinelCache;
    }

    const data = {
        sessionActive:                false,
        sessionId:                    '',
        activeModel:                  'Gemini 3.5 Flash (High)',
        activeModelExpiration:        null,
        activeModelRemainingFraction: 0.0,
        modelsList:                   [],
        email:                        'offline',
        plan:                         'Free',
        stepsCount:                   0,
        stepsLimit:                   100,
        estimatedTokens:              0,
        contextLimit:                 1000000,
        warningThreshold:             750000,
        steps:                        [],
        skills:                       [],
        mcpServers:                   [],
        browserFrames:                [],
        childSessions:                []
    };

    try {
        // ── Session — read from background async cache (no file I/O here) ───
        if (!cachedLatestSession) {
            _sentinelCache     = data;
            _sentinelCacheTime = now;
            return data;
        }

        data.sessionActive = true;
        data.sessionId     = cachedLatestSession.id;

        // ── Transcript — read from background async cache (no file I/O) ────
        data.steps      = cachedTranscriptSteps;
        data.stepsCount = cachedTranscriptSteps.length;
        const totalCharacters       = cachedTranscriptTotalChars;
        const transcriptActiveModel = cachedTranscriptActiveModel;

        // ── Active model resolution (memory-only) ────────────────────────────
        // P1: transcript display name (injected by IDE on model switch, exact match)
        // P2: SQLite activeModelId → LSP ID lookup
        // Sticky: freeze at last known good if both fail
        if (cachedLspData && cachedLspData.modelsList && cachedLspData.modelsList.length > 0) {
            data.email      = cachedLspData.email;
            data.plan       = cachedLspData.plan;
            data.modelsList = cachedLspData.modelsList;

            let activeModelObj = null;

            // P1: transcript name — exact display name match, no ID mapping needed
            if (transcriptActiveModel) {
                activeModelObj = cachedLspData.modelsList.find(m => m.name === transcriptActiveModel) || null;
            }

            // P2: SQLite ID — match by internal model ID (cross-session fallback)
            if (!activeModelObj) {
                const sqliteActiveId = getActiveModelIdFromSqlite();
                if (sqliteActiveId) {
                    activeModelObj = cachedLspData.modelsList.find(m => m.id === sqliteActiveId) || null;
                }
            }

            if (activeModelObj) {
                // Resolved — update sticky cache
                data.activeModel                  = activeModelObj.name;
                data.activeModelExpiration        = activeModelObj.expiration;
                data.activeModelRemainingFraction = activeModelObj.remainingFraction;
                lastResolvedActiveModel                  = activeModelObj.name;
                lastResolvedActiveModelExpiration        = activeModelObj.expiration;
                lastResolvedActiveModelRemainingFraction = activeModelObj.remainingFraction;
            } else if (lastResolvedActiveModel) {
                // Both sources failed — freeze indicator at last known good
                data.activeModel                  = lastResolvedActiveModel;
                data.activeModelExpiration        = lastResolvedActiveModelExpiration;
                data.activeModelRemainingFraction = lastResolvedActiveModelRemainingFraction;
            }
            // If no lastResolved: keep safe default string already in data object
        } else {
            // LSP not yet available — use SQLite model name directly
            const modelInfo = getSqliteModelInfo();
            if (modelInfo) {
                if (modelInfo.activeModel) {
                    data.activeModel = modelInfo.activeModel;
                    lastResolvedActiveModel = modelInfo.activeModel;
                }
                data.activeModelExpiration        = modelInfo.expiration;
                data.activeModelRemainingFraction = modelInfo.remainingFraction;
                data.modelsList                   = modelInfo.models || [];
            } else if (lastResolvedActiveModel) {
                data.activeModel                  = lastResolvedActiveModel;
                data.activeModelExpiration        = lastResolvedActiveModelExpiration;
                data.activeModelRemainingFraction = lastResolvedActiveModelRemainingFraction;
            }
        }

        // ── Context limits (memory-only lookup table) ────────────────────────
        const MODEL_LIMITS = {
            'Gemini Pro 3.1 High':         { limit: 2000000, warn: 1500000 },
            'Gemini 3.1 Pro (High)':       { limit: 2000000, warn: 1500000 },
            'Gemini Pro 3.1 Low':          { limit:  500000, warn:  375000 },
            'Gemini 3.1 Pro (Low)':        { limit:  500000, warn:  375000 },
            'Gemini Flash 3.5 High':       { limit: 1000000, warn:  750000 },
            'Gemini 3.5 Flash (High)':     { limit: 1000000, warn:  750000 },
            'Gemini Flash 3.5 Medium':     { limit:  500000, warn:  375000 },
            'Gemini 3.5 Flash (Medium)':   { limit:  500000, warn:  375000 },
            'Gemini Flash 3.5 Low':        { limit:  200000, warn:  150000 },
            'Gemini 3.5 Flash (Low)':      { limit:  200000, warn:  150000 },
            'Claude Sonnet 4.6':           { limit:  200000, warn:  150000 },
            'Claude Sonnet 4.6 (Thinking)':{ limit:  200000, warn:  150000 },
            'Claude Opus 4.6':             { limit:  200000, warn:  150000 },
            'Claude Opus 4.6 (Thinking)':  { limit:  200000, warn:  150000 },
            'GPT OSS 12B':                 { limit:   32000, warn:   24000 },
            'GPT-OSS 120B (Medium)':       { limit:   32000, warn:   24000 }
        };

        const limits          = MODEL_LIMITS[data.activeModel] || { limit: 1000000, warn: 750000 };
        data.stepsLimit       = data.activeModel.includes('Pro') ? 150 : 100;
        data.estimatedTokens  = Math.round(totalCharacters / 3.3);
        data.warningThreshold = limits.warn;
        data.contextLimit     = limits.limit;

        // ── Browser recordings — small local dir, existsSync + readdirSync is fast ─
        const homedir = os.homedir();
        const recDir  = path.join(homedir, '.gemini', 'antigravity-ide', 'browser_recordings', data.sessionId);
        if (fs.existsSync(recDir)) {
            const files      = fs.readdirSync(recDir);
            const imageFiles = files
                .filter(f => f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.webp'))
                .sort((a, b) => b.localeCompare(a))
                .slice(0, 8);
            data.browserFrames = imageFiles.map(f => path.join(recDir, f));
        }

        // ── Skills / MCP / child sessions — read from background async caches ─
        data.skills        = _cachedSkills     || [];
        data.mcpServers    = _cachedMcpServers || [];
        data.childSessions = cachedChildSessions;

        // ── Account cache ────────────────────────────────────────────────────
        // readState() is TTL-cached (1.5 s) — usually a memory-only operation.
        // Account persistence is rate-limited and change-gated — no write if
        // data unchanged and less than 30 s since last write.
        const state = readState();
        if (!state.cachedAccounts) state.cachedAccounts = [];

        const activeEmail = data.email;
        if (activeEmail && activeEmail !== 'offline') {
            // Change detection — build a hash of what matters for account cache
            const accountHash = `${activeEmail}|${data.plan}|${data.activeModel}|${Math.round((data.activeModelRemainingFraction || 0) * 100)}`;
            const timeSinceWrite = now - _lastAccountWriteTime;

            if (accountHash !== _lastAccountHash || timeSinceWrite >= ACCOUNT_WRITE_INTERVAL) {
                // Only touch disk if something actually changed OR 30 s interval passed
                let accountEntry = state.cachedAccounts.find(acc => acc.email === activeEmail);
                if (!accountEntry) {
                    accountEntry = { email: activeEmail };
                    state.cachedAccounts.push(accountEntry);
                }
                accountEntry.plan                         = data.plan || 'Free';
                accountEntry.activeModel                  = data.activeModel;
                accountEntry.activeModelExpiration        = data.activeModelExpiration;
                accountEntry.activeModelRemainingFraction = data.activeModelRemainingFraction;
                accountEntry.modelsList                   = data.modelsList || [];
                accountEntry.lastSeen                     = now;
                accountEntry.isActive                     = true;

                state.cachedAccounts.forEach(acc => {
                    if (acc.email !== activeEmail) acc.isActive = false;
                });

                _lastAccountHash      = accountHash;
                _lastAccountWriteTime = now;
                writeState(state);  // _ownStateWriteTime set inside writeState()
            }
        }
        data.cachedAccounts = state.cachedAccounts || [];

    } catch (err) {
        console.error('[Sentinel] Data gathering error:', err.message);
    }

    _sentinelCache     = data;
    _sentinelCacheTime = now;
    return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// SIDEBAR WEBVIEW PROVIDER
// ─────────────────────────────────────────────────────────────────────────────

class SentinelViewProvider {
    constructor(extensionUri, context) {
        this._extensionUri = extensionUri;
        this._context      = context;
        this._view         = undefined;
    }

    resolveWebviewView(webviewView, context, token) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts:      true,
            localResourceRoots: [this._extensionUri]
        };

        const state        = readState();
        const sentinelData = gatherSentinelData();

        if (sentinelData.browserFrames.length > 0) {
            sentinelData.browserFrames = sentinelData.browserFrames.map(f =>
                webviewView.webview.asWebviewUri(vscode.Uri.file(f)).toString()
            );
        }

        webviewView.webview.html = buildSettingsHtml({
            ...state,
            overwatch: sentinelData,
            version:   this._context.extension?.packageJSON?.version || '1.0.0'
        });

        // Dashboard poll: 5 s. gatherSentinelData() is a 4 s TTL cache hit — fast.
        const pollInterval = setInterval(() => {
            if (webviewView.visible) {
                try {
                    const data = gatherSentinelData();
                    if (data.browserFrames.length > 0) {
                        data.browserFrames = data.browserFrames.map(f =>
                            webviewView.webview.asWebviewUri(vscode.Uri.file(f)).toString()
                        );
                    }
                    webviewView.webview.postMessage({ command: 'updateOverwatch', data });
                    updateStatusBar();
                } catch (e) {
                    console.error('[Sentinel] Polling failed:', e.message);
                }
            }
        }, 5000);

        // Handle messages from Webview (user interactions)
        webviewView.webview.onDidReceiveMessage((msg) => {
            const state = readState();
            if (msg.command === 'toggleAccept') {
                state.enabled = msg.enabled;
                writeState(state);
                updateStatusBar();
            } else if (msg.command === 'toggleScroll') {
                state.scrollEnabled = msg.enabled;
                writeState(state);
            } else if (msg.command === 'updateAllowMode') {
                state.allowMode = msg.mode;
                writeState(state);
            } else if (msg.command === 'updateSelectivePermissions') {
                state.selectivePermissions = msg.permissions;
                writeState(state);
            } else if (msg.command === 'saveConfig') {
                state.clickIntervalMs  = msg.data.clickIntervalMs;
                state.scrollIntervalMs = msg.data.scrollIntervalMs;
                state.scrollPauseMs    = msg.data.scrollPauseMs;
                state.clickPatterns    = msg.data.clickPatterns;
                writeState(state);
            } else if (msg.command === 'clearLogs') {
                state.clickLog    = [];
                state.totalClicks = 0;
                state.clickStats  = {};
                writeState(state);
                updateStatusBar();
            }
        });

        webviewView.onDidDispose(() => {
            this._view = undefined;
            clearInterval(pollInterval);
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTENSION ACTIVATION
// ─────────────────────────────────────────────────────────────────────────────

function activate(context) {
    console.log('[Sentinel] Extension activated.');

    // ── Fire all background refreshes immediately (all non-blocking async) ──
    refreshSessionAsync().then(() => {
        // Transcript refresh needs session to be known first
        refreshTranscriptAsync();
    });
    refreshSqliteAsync();
    refreshSkillsAsync();
    refreshMcpAsync();
    refreshChildSessionsAsync();

    // Initial LSP query — populates status bar once data arrives
    queryLsp().then(data => {
        if (data) cachedLspData = data;
        updateStatusBar();
    }).catch(() => {});

    // ── LSP polling — every 8 s, async, with concurrency guard ──────────────
    lspPollInterval = setInterval(async () => {
        if (lspQueryPending) return;
        lspQueryPending = true;
        try {
            const data = await queryLsp();
            if (data) cachedLspData = data;
        } catch (e) {}
        lspQueryPending = false;
        updateStatusBar();
    }, 8000);

    // ── SQLite background refresh — every 8 s ────────────────────────────────
    sqliteRefreshInterval = setInterval(() => refreshSqliteAsync(), 8000);

    // ── Async transcript refresh — every 3 s ─────────────────────────────────
    // Fully async: reads + parses transcript off the main thread.
    transcriptRefreshInterval = setInterval(() => refreshTranscriptAsync(), 3000);

    // ── Async session discovery — every 15 s ─────────────────────────────────
    sessionScanInterval = setInterval(() => refreshSessionAsync(), 15000);

    // ── Async child session scan — every 30 s ────────────────────────────────
    childSessionInterval = setInterval(() => refreshChildSessionsAsync(), 30000);

    // ── Async skills scan — every 60 s ───────────────────────────────────────
    skillsRefreshInterval = setInterval(() => refreshSkillsAsync(), 60000);

    // ── Async MCP config scan — every 30 s ──────────────────────────────────
    mcpRefreshInterval = setInterval(() => refreshMcpAsync(), 30000);

    // ── Status bar ───────────────────────────────────────────────────────────
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100000);
    statusBarItem.command = 'antigravity-super-sentinel.openSettings';
    context.subscriptions.push(statusBarItem);
    updateStatusBar();

    // ── Sidebar View Provider ────────────────────────────────────────────────
    sidebarProvider = new SentinelViewProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'antigravity-super-sentinel-view',
            sidebarProvider
        )
    );

    // ── Auto-inject script on startup if not already injected ────────────────
    if (!isScriptInjected()) {
        console.log('[Sentinel] Script not found in workbench.html, executing auto-inject...');
        const success = injectScript(context, true);
        if (success) {
            clearCodeCache();
            updateChecksums();
            updateStatusBar();
            vscode.window.showInformationMessage(
                '[Sentinel] Clean clicker auto-injected. Please reload window to activate.',
                'Reload Window'
            ).then(choice => {
                if (choice === 'Reload Window') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        }
    }

    setupStateFileWatcher();

    // ── Commands ─────────────────────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-super-sentinel.enable', async () => {
            const success = injectScript(context, false);
            if (success) {
                clearCodeCache();
                updateChecksums();
                updateStatusBar();
                setupStateFileWatcher();
                vscode.window.showInformationMessage(
                    '[Sentinel] Clicker script injected successfully. Reloading window...', 'Reload Now'
                ).then(() => {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                });
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-super-sentinel.disable', async () => {
            const success = removeScript();
            if (success) {
                if (stateWatcher) { stateWatcher.close(); stateWatcher = null; }
                clearCodeCache();
                updateChecksums();
                updateStatusBar();
                vscode.window.showInformationMessage(
                    '[Sentinel] Clicker script removed successfully. Reloading window...', 'Reload Now'
                ).then(() => {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                });
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-super-sentinel.toggle', () => {
            if (!isScriptInjected()) {
                vscode.commands.executeCommand('antigravity-super-sentinel.enable');
                return;
            }

            const state       = readState();
            const nextEnabled = !state.enabled;
            state.enabled     = nextEnabled;
            writeState(state);
            updateStatusBar();

            const message = nextEnabled
                ? 'Auto-Accept clicker is now ACTIVE.'
                : 'Auto-Accept clicker is now PAUSED.';
            vscode.window.setStatusBarMessage(`[Sentinel] ${message}`, 3000);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-super-sentinel.openSettings', () => {
            vscode.commands.executeCommand(
                'workbench.view.extension.antigravity-super-sentinel-container'
            );
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('antigravity-super-sentinel')) {
                const config        = vscode.workspace.getConfiguration('antigravity-super-sentinel');
                const state         = readState();
                state.enabled       = config.get('enabled', true);
                state.scrollEnabled = config.get('scrollEnabled', true);
                writeState(state);
                updateStatusBar();
            }
        })
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTENSION DEACTIVATION — clean up all intervals and watchers
// ─────────────────────────────────────────────────────────────────────────────

function deactivate() {
    for (const interval of [
        lspPollInterval, sqliteRefreshInterval, transcriptRefreshInterval,
        sessionScanInterval, childSessionInterval, skillsRefreshInterval,
        mcpRefreshInterval
    ]) {
        if (interval) clearInterval(interval);
    }
    lspPollInterval         = null;
    sqliteRefreshInterval   = null;
    transcriptRefreshInterval = null;
    sessionScanInterval     = null;
    childSessionInterval    = null;
    skillsRefreshInterval   = null;
    mcpRefreshInterval      = null;
    if (stateWatcher)  { stateWatcher.close(); stateWatcher = null; }
    if (statusBarItem) { statusBarItem.dispose(); }
}

module.exports = { activate, deactivate };
