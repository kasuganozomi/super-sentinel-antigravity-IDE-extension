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
// execSync is only kept for WSL one-time path detection (runs once, then pinned).
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
let stateWatcher         = null;
let sidebarProvider      = null;
let statusBarItem        = null;
let lspPollInterval      = null;
let childSessionInterval = null;
let sqliteRefreshInterval = null;

// ─── LSP data cache ───────────────────────────────────────────────────────────
let cachedLspData   = { email: 'offline', plan: 'Free', modelsList: [] };
let lspQueryPending = false;    // concurrency guard — prevents overlapping queryLsp() calls

// ─── Session / transcript cache ───────────────────────────────────────────────
let cachedLatestSession        = null;
let lastSessionScanTime        = 0;
let cachedTranscriptSteps      = [];
let cachedTranscriptActiveModel = null;
let cachedTranscriptTotalChars = 0;
let cachedTranscriptPath       = '';
let cachedTranscriptMtime      = 0;

// ─── SQLite cache ─────────────────────────────────────────────────────────────
let cachedSqliteData     = null;
let lastSqliteQueryTime  = 0;
let sqliteRefreshPending = false;   // prevents concurrent python subprocess launches

// ─── gatherSentinelData result cache ─────────────────────────────────────────
// Prevents triple-compute on same tick (called from LSP poll, sidebar poll, file watcher simultaneously)
let _sentinelCache     = null;
let _sentinelCacheTime = 0;
const SENTINEL_TTL = 4000;          // 4 s — fresh enough for dashboard

// ─── isScriptInjected result cache ───────────────────────────────────────────
// Avoids reading large workbench.html on every status bar refresh
let _injectedCache     = null;      // null = not yet computed
let _injectedCacheTime = 0;
const INJECTED_TTL = 10000;         // 10 s

// ─── Workbench path cache (file-system probe, stable at runtime) ───────────────
// undefined = never computed; null = not found; string = valid path
let _wbPathCache     = undefined;
let _wbPathCacheTime = 0;

// ─── Sub-caches inside gatherSentinelData (slow-changing data) ───────────────
let _cachedSkills     = null;
let _cachedSkillsTime = 0;
const SKILLS_TTL = 60000;           // rescan skills directory once per minute

let _cachedMcpServers = null;
let _cachedMcpTime    = 0;
const MCP_TTL = 30000;              // rescan mcp_config.json every 30 s

// ─── Child sessions cache (refreshed by dedicated 30 s interval) ───────────────
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
// HTTP HELPERS (already async — unchanged)
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

// Returns cached data instantly. Triggers async background refresh when cache is stale.
function getSqliteModelInfo() {
    const now = Date.now();
    if (!sqliteRefreshPending && (now - lastSqliteQueryTime > 8000)) {
        refreshSqliteAsync();   // fire-and-forget, does NOT block
    }
    return cachedSqliteData;
}

function getActiveModelIdFromSqlite() {
    const modelInfo = getSqliteModelInfo();
    return modelInfo ? modelInfo.activeModelId : null;
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
// WSL PATH HELPERS — computed once at first access, then pinned forever
// execSync is acceptable here: it's a one-time cost at startup, never repeated.
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
// WORKBENCH PATH — cached with TTL (60 s when found, 5 s when not found)
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
// CHECKSUM UPDATE (one-time on inject/remove, not periodic)
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
// STATE FILE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getStateFilePath() {
    const wbPath = getWorkbenchPath();
    if (!wbPath) return null;
    return path.join(path.dirname(wbPath), 'ag-super-sentinel-state.json');
}

function readState() {
    const statePath = getStateFilePath();
    if (statePath && fs.existsSync(statePath)) {
        try {
            const raw   = fs.readFileSync(statePath, 'utf8');
            const state = JSON.parse(raw);
            if (!state.cachedAccounts) state.cachedAccounts = [];
            return state;
        } catch (e) {
            console.error('[Sentinel] Failed to parse state JSON:', e.message);
        }
    }
    return {
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
}

function writeState(state) {
    const statePath = getStateFilePath();
    if (!statePath) return;
    try {
        writeFile(statePath, JSON.stringify(state, null, 4));
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
        // Pin workbench path (it's now confirmed valid)
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
// STATUS BAR
// All heavy dependencies are now TTL-cached, so this call is lightweight.
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

    // All of these are now nearly free (TTL cache hits)
    const wbPath    = getWorkbenchPath();
    const state     = readState();
    const injected  = wbPath ? isScriptInjected() : false;
    const data      = gatherSentinelData();

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
// STATE FILE WATCHER
// ─────────────────────────────────────────────────────────────────────────────

function setupStateFileWatcher() {
    if (stateWatcher) return;
    const statePath = getStateFilePath();
    if (!statePath) return;

    try {
        stateWatcher = fs.watch(statePath, (eventType) => {
            if (eventType === 'change') {
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
// CHILD SESSION REFRESH — async, runs on dedicated 30 s interval
// Moves the expensive execAsync(agentapi) loop off the main data-gather path.
// ─────────────────────────────────────────────────────────────────────────────

async function refreshChildSessionsAsync() {
    try {
        const homedir          = os.homedir();
        const conversationsDir = path.join(homedir, '.gemini', 'antigravity-ide', 'conversations');
        const agentapiBinName  = process.platform === 'win32' ? 'agentapi.bat' : 'agentapi';
        const agentapiPath     = path.join(homedir, '.gemini', 'antigravity-ide', 'bin', agentapiBinName);

        if (!fs.existsSync(conversationsDir) || !fs.existsSync(agentapiPath)) return;
        if (!cachedLatestSession) return;

        const sessionId = cachedLatestSession.id;
        const files     = fs.readdirSync(conversationsDir);
        const dbFiles   = files.filter(f => f.endsWith('.db') && !f.includes(sessionId));

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
// GATHER SENTINEL DATA — TTL cached to prevent redundant FS work
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
        const homedir  = os.homedir();
        const brainDir = path.join(homedir, '.gemini', 'antigravity-ide', 'brain');
        if (!fs.existsSync(brainDir)) {
            _sentinelCache     = data;
            _sentinelCacheTime = now;
            return data;
        }

        // ── Session discovery: rescan every 10 s ────────────────────────────
        if (!cachedLatestSession || (now - lastSessionScanTime > 10000)) {
            const sessions   = fs.readdirSync(brainDir);
            let latestTime   = 0;
            let latestSession = null;

            for (const session of sessions) {
                const tPath = path.join(brainDir, session, '.system_generated', 'logs', 'transcript.jsonl');
                if (fs.existsSync(tPath)) {
                    const stat = fs.statSync(tPath);
                    if (stat.mtimeMs > latestTime) {
                        latestTime    = stat.mtimeMs;
                        latestSession = { id: session, path: path.join(brainDir, session), transcriptPath: tPath };
                    }
                }
            }
            if (latestSession) cachedLatestSession = latestSession;
            lastSessionScanTime = now;
        }

        if (!cachedLatestSession) {
            _sentinelCache     = data;
            _sentinelCacheTime = now;
            return data;
        }

        data.sessionActive = true;
        data.sessionId     = cachedLatestSession.id;

        // ── Transcript parsing: only re-parse when file actually changed ────
        const tPath = cachedLatestSession.transcriptPath;
        const stat  = fs.statSync(tPath);

        if (tPath !== cachedTranscriptPath || stat.mtimeMs !== cachedTranscriptMtime) {
            const content = fs.readFileSync(tPath, 'utf8');
            const lines   = content.trim().split('\n').filter(l => l.trim().length > 0);
            let totalCharacters     = 0;
            let transcriptActiveModel = null;
            const steps = [];

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

            cachedTranscriptSteps       = steps;
            cachedTranscriptActiveModel = transcriptActiveModel;
            cachedTranscriptTotalChars  = totalCharacters;
            cachedTranscriptPath        = tPath;
            cachedTranscriptMtime       = stat.mtimeMs;
        }

        data.steps      = cachedTranscriptSteps;
        data.stepsCount = cachedTranscriptSteps.length;
        const totalCharacters   = cachedTranscriptTotalChars;
        const transcriptActiveModel = cachedTranscriptActiveModel;

        // ── Active model resolution (LSP → SQLite fallback) ─────────────────
        if (cachedLspData && cachedLspData.modelsList && cachedLspData.modelsList.length > 0) {
            data.email     = cachedLspData.email;
            data.plan      = cachedLspData.plan;
            data.modelsList = cachedLspData.modelsList;

            let activeModelObj = null;
            if (transcriptActiveModel) {
                activeModelObj = cachedLspData.modelsList.find(m => m.name === transcriptActiveModel);
            }
            if (!activeModelObj) {
                const sqliteActiveId = getActiveModelIdFromSqlite();
                if (sqliteActiveId) {
                    activeModelObj = cachedLspData.modelsList.find(m => m.id === sqliteActiveId);
                }
            }
            if (!activeModelObj && cachedLspData.modelsList.length > 0) {
                activeModelObj = cachedLspData.modelsList[0];
            }

            if (activeModelObj) {
                data.activeModel                  = activeModelObj.name;
                data.activeModelExpiration        = activeModelObj.expiration;
                data.activeModelRemainingFraction = activeModelObj.remainingFraction;
            }
        } else {
            // SQLite fallback (LSP not yet available)
            const modelInfo = getSqliteModelInfo();
            if (modelInfo) {
                if (modelInfo.activeModel && !transcriptActiveModel) {
                    data.activeModel = modelInfo.activeModel;
                }
                data.activeModelExpiration        = modelInfo.expiration;
                data.activeModelRemainingFraction = modelInfo.remainingFraction;
                data.modelsList                   = modelInfo.models;
            }
        }

        // ── Context limits per model ─────────────────────────────────────────
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

        // ── Browser recordings (latest 8 frames) ────────────────────────────
        const recDir = path.join(homedir, '.gemini', 'antigravity-ide', 'browser_recordings', data.sessionId);
        if (fs.existsSync(recDir)) {
            const files      = fs.readdirSync(recDir);
            const imageFiles = files
                .filter(f => f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.webp'))
                .sort((a, b) => b.localeCompare(a))
                .slice(0, 8);
            data.browserFrames = imageFiles.map(f => path.join(recDir, f));
        }

        // ── Skills scan — TTL sub-cache (rescan once per minute) ─────────────
        if (!_cachedSkills || now - _cachedSkillsTime > SKILLS_TTL) {
            const skills    = [];
            const skillsDir = path.join(homedir, '.gemini', 'config', 'skills');
            if (fs.existsSync(skillsDir)) {
                for (const folder of fs.readdirSync(skillsDir)) {
                    const skillMdPath = path.join(skillsDir, folder, 'SKILL.md');
                    if (fs.existsSync(skillMdPath)) {
                        const skillMd   = fs.readFileSync(skillMdPath, 'utf8');
                        let skillName   = folder;
                        let skillDesc   = '';
                        const matchName = skillMd.match(/name:\s*(.*)/i);
                        const matchDesc = skillMd.match(/description:\s*>([\s\S]*?)---/i) || skillMd.match(/description:\s*(.*)/i);
                        if (matchName) skillName = matchName[1].trim();
                        if (matchDesc) skillDesc = matchDesc[1].trim().replace(/\n/g, ' ');
                        skills.push({ name: skillName, description: skillDesc });
                    }
                }
            }
            _cachedSkills     = skills;
            _cachedSkillsTime = now;
        }
        data.skills = _cachedSkills;

        // ── MCP config scan — TTL sub-cache (rescan every 30 s) ─────────────
        if (!_cachedMcpServers || now - _cachedMcpTime > MCP_TTL) {
            const servers  = [];
            const mcpPath  = path.join(homedir, '.gemini', 'config', 'mcp_config.json');
            if (fs.existsSync(mcpPath)) {
                try {
                    const mcpJson = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
                    if (mcpJson && mcpJson.mcpServers) {
                        for (const serverName in mcpJson.mcpServers) {
                            servers.push({
                                name:    serverName,
                                command: mcpJson.mcpServers[serverName].command,
                                status:  'Active'
                            });
                        }
                    }
                } catch (e) {}
            }
            _cachedMcpServers = servers;
            _cachedMcpTime    = now;
        }
        data.mcpServers = _cachedMcpServers;

        // ── Child sessions: read from cache (refreshed by 30 s interval) ─────
        data.childSessions = cachedChildSessions;

        // ── Account cache update ─────────────────────────────────────────────
        const state = readState();
        if (!state.cachedAccounts) state.cachedAccounts = [];

        const activeEmail = data.email;
        if (activeEmail && activeEmail !== 'offline') {
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
            accountEntry.lastSeen                     = Date.now();
            accountEntry.isActive                     = true;

            state.cachedAccounts.forEach(acc => {
                if (acc.email !== activeEmail) acc.isActive = false;
            });

            writeState(state);
        }
        data.cachedAccounts = state.cachedAccounts || [];

    } catch (err) {
        console.error('[Sentinel] Data gathering error:', err.message);
    }

    // ── Store in TTL cache ───────────────────────────────────────────────────
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

        // Dashboard polling — 5 s (was 2 s). Data stays fresh via underlying 4 s cache.
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

        // Handle messages from Webview
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

    // Kick off all background refreshes immediately (all non-blocking)
    refreshSqliteAsync();
    refreshChildSessionsAsync();
    queryLsp().then(data => {
        if (data) cachedLspData = data;
        updateStatusBar();
    }).catch(() => {});

    // ── LSP polling — every 8 s with concurrency guard ───────────────────────
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

    // ── Child session scan — every 30 s ─────────────────────────────────────
    childSessionInterval = setInterval(() => refreshChildSessionsAsync(), 30000);

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

            const state      = readState();
            const nextEnabled = !state.enabled;
            state.enabled    = nextEnabled;
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
                const config   = vscode.workspace.getConfiguration('antigravity-super-sentinel');
                const state    = readState();
                state.enabled  = config.get('enabled', true);
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
    if (lspPollInterval)      { clearInterval(lspPollInterval);      lspPollInterval      = null; }
    if (sqliteRefreshInterval) { clearInterval(sqliteRefreshInterval); sqliteRefreshInterval = null; }
    if (childSessionInterval) { clearInterval(childSessionInterval); childSessionInterval = null; }
    if (stateWatcher)         { stateWatcher.close();                stateWatcher         = null; }
    if (statusBarItem)        { statusBarItem.dispose(); }
}

module.exports = { activate, deactivate };
