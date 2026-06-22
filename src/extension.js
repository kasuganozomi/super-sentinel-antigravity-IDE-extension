const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const execSync = require('child_process').execSync;
const buildSettingsHtml = require('./settingsHtml');

const TAG_START = '<!-- ANTIGRAVITY-SUPER-SENTINEL-START -->';
const TAG_END = '<!-- ANTIGRAVITY-SUPER-SENTINEL-END -->';
const OLD_TAG_START = '<!-- ANTIGRAVITY-CLEAN-AUTO-ACCEPT-START -->';
const OLD_TAG_END = '<!-- ANTIGRAVITY-CLEAN-AUTO-ACCEPT-END -->';

let stateWatcher = null;
let sidebarProvider = null;
let statusBarItem = null;
let lspPollInterval = null;

let cachedLspData = {
    email: 'offline',
    plan: 'Free',
    modelsList: []
};

let cachedLatestSession = null;
let lastSessionScanTime = 0;

let cachedTranscriptSteps = [];
let cachedTranscriptActiveModel = null;
let cachedTranscriptTotalChars = 0;
let cachedTranscriptPath = '';
let cachedTranscriptMtime = 0;

// Map LSP JSON-RPC response to dashboard format
function mapLspData(json) {
    try {
        const userStatus = json.userStatus || {};
        const email = userStatus.email || 'offline';
        const plan = userStatus.userTier?.name || 'Free';
        
        const configs = userStatus.cascadeModelConfigData?.clientModelConfigs || [];
        const modelsList = configs.map(c => {
            const expTime = c.quotaInfo?.resetTime ? Math.floor(Date.parse(c.quotaInfo.resetTime) / 1000) : null;
            return {
                name: c.label || 'Unknown',
                id: c.modelOrAlias?.model || '',
                quota: (c.quotaInfo?.remainingFraction || 0) > 0 ? 1 : 0,
                expiration: expTime,
                remainingFraction: c.quotaInfo?.remainingFraction || 0.0,
                mimeTypeCount: c.supportedMimeTypes ? Object.keys(c.supportedMimeTypes).length : 0
            };
        });
        
        return {
            email,
            plan,
            modelsList
        };
    } catch (e) {
        return null;
    }
}

// Perform POST to target port (tries HTTPS first, then HTTP)
function postToLsp(port, csrf) {
    return new Promise((resolve) => {
        tryHttpsPost(port, csrf, (httpsResult) => {
            if (httpsResult) return resolve(httpsResult);
            tryHttpPost(port, csrf, (httpResult) => {
                resolve(httpResult);
            });
        });
    });
}

function tryHttpsPost(port, csrf, cb) {
    const payload = JSON.stringify({
        metadata: {
            ideName: "vscode",
            extensionName: "vscode",
            ideVersion: "1.75.0",
            locale: "en"
        }
    });
    
    const options = {
        hostname: '127.0.0.1',
        port: port,
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
                if (res.statusCode === 200) {
                    const parsed = JSON.parse(body);
                    const mapped = mapLspData(parsed);
                    cb(mapped);
                } else {
                    cb(null);
                }
            } catch (e) {
                cb(null);
            }
        });
    });
    
    req.on('error', () => cb(null));
    req.write(payload);
    req.end();
}

// Perform POST to target port (tries HTTPS first, then HTTP)
function tryHttpPost(port, csrf, cb) {
    const payload = JSON.stringify({
        metadata: {
            ideName: "vscode",
            extensionName: "vscode",
            ideVersion: "1.75.0",
            locale: "en"
        }
    });
    
    const options = {
        hostname: '127.0.0.1',
        port: port,
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
                if (res.statusCode === 200) {
                    const parsed = JSON.parse(body);
                    const mapped = mapLspData(parsed);
                    cb(mapped);
                } else {
                    cb(null);
                }
            } catch (e) {
                cb(null);
            }
        });
    });
    
    req.on('error', () => cb(null));
    req.write(payload);
    req.end();
}

// Scans PIDs, detects ports, updates cachedLspData
async function queryLsp() {
    try {
        let psOut = '';
        try {
            psOut = execSync('ps -ef | grep language_server | grep -v grep', { encoding: 'utf8' });
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
            const csrf = tokenMatch[1].replace(/['"]+/g, "").trim();
            
            let lsofOut = '';
            try {
                lsofOut = execSync(`lsof -nP -iTCP -sTCP:LISTEN -a -p ${pid}`, { encoding: 'utf8' });
            } catch (e) {
                try {
                    lsofOut = execSync(`ss -lntp | grep "pid=${pid}," || true`, { encoding: 'utf8' });
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
                if (result) {
                    return result;
                }
            }
        }
    } catch (e) {
        // Ignore errors
    }
    return null;
}

// Helper to get active model preference from SQLite DB
function getActiveModelIdFromSqlite() {
    try {
        const pythonScript = path.join(__dirname, 'query_model_info.py');
        const modelInfoRaw = execSync(`python3 "${pythonScript}"`, { encoding: 'utf8' });
        if (modelInfoRaw) {
            const modelInfo = JSON.parse(modelInfoRaw);
            return modelInfo.activeModelId;
        }
    } catch (e) {}
    return null;
}

// Helper to write files with clean error handling
function writeFile(filePath, content) {
    try {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`[Sentinel] Successfully wrote: ${filePath}`);
    } catch (err) {
        console.error(`[Sentinel] Write failed for ${filePath}:`, err.message);
        throw err;
    }
}

// Helper to get WSL-translated Windows local appdata path
function getWslWindowsLocalAppData() {
    try {
        if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
            // 1. Try standard cmd.exe execution
            try {
                const out = execSync('/mnt/c/Windows/System32/cmd.exe /c "echo %LOCALAPPDATA%"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
                if (out && out.match(/^[a-zA-Z]:\\/)) {
                    const drive = out[0].toLowerCase();
                    const remainder = out.substring(2).replace(/\\/g, '/');
                    return `/mnt/${drive}${remainder}`;
                }
            } catch (cmdErr) {}

            // 2. Try parsing process.env.PATH
            const paths = (process.env.PATH || '').split(':');
            for (const p of paths) {
                const match = p.match(/\/mnt\/([a-zA-Z])\/Users\/([^\/]+)\/AppData\/Local/i);
                if (match) {
                    const drive = match[1].toLowerCase();
                    const user = match[2];
                    const localAppData = `/mnt/${drive}/Users/${user}/AppData/Local`;
                    if (fs.existsSync(localAppData)) {
                        return localAppData;
                    }
                }
            }

            // 3. Scan /mnt/c/Users/ (or other mounted drives if any)
            const drives = ['c', 'd', 'e'];
            for (const d of drives) {
                const usersDir = `/mnt/${d}/Users`;
                if (fs.existsSync(usersDir)) {
                    const users = fs.readdirSync(usersDir);
                    for (const u of users) {
                        if (['Public', 'All Users', 'Default', 'Default User', 'desktop.ini'].includes(u)) continue;
                        const localAppData = path.join(usersDir, u, 'AppData', 'Local');
                        if (fs.existsSync(path.join(localAppData, 'Programs', 'Antigravity IDE'))) {
                            return localAppData;
                        }
                    }
                    // Fallback to any valid AppData/Local if specific IDE folder not found yet
                    for (const u of users) {
                        if (['Public', 'All Users', 'Default', 'Default User', 'desktop.ini'].includes(u)) continue;
                        const localAppData = path.join(usersDir, u, 'AppData', 'Local');
                        if (fs.existsSync(localAppData)) {
                            return localAppData;
                        }
                    }
                }
            }
        }
    } catch (e) {}
    return null;
}

// Helper to get WSL-translated Windows AppData (Roaming) path
function getWslWindowsAppData() {
    try {
        if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
            // 1. Try standard cmd.exe execution
            try {
                const out = execSync('/mnt/c/Windows/System32/cmd.exe /c "echo %APPDATA%"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
                if (out && out.match(/^[a-zA-Z]:\\/)) {
                    const drive = out[0].toLowerCase();
                    const remainder = out.substring(2).replace(/\\/g, '/');
                    return `/mnt/${drive}${remainder}`;
                }
            } catch (cmdErr) {}

            // 2. Try parsing process.env.PATH
            const paths = (process.env.PATH || '').split(':');
            for (const p of paths) {
                const match = p.match(/\/mnt\/([a-zA-Z])\/Users\/([^\/]+)\/AppData\/Local/i);
                if (match) {
                    const drive = match[1].toLowerCase();
                    const user = match[2];
                    const appData = `/mnt/${drive}/Users/${user}/AppData/Roaming`;
                    if (fs.existsSync(appData)) {
                        return appData;
                    }
                }
            }

            // 3. Scan /mnt/c/Users/
            const drives = ['c', 'd', 'e'];
            for (const d of drives) {
                const usersDir = `/mnt/${d}/Users`;
                if (fs.existsSync(usersDir)) {
                    const users = fs.readdirSync(usersDir);
                    for (const u of users) {
                        if (['Public', 'All Users', 'Default', 'Default User', 'desktop.ini'].includes(u)) continue;
                        const appData = path.join(usersDir, u, 'AppData', 'Roaming');
                        if (fs.existsSync(path.join(appData, 'Antigravity IDE'))) {
                            return appData;
                        }
                    }
                    for (const u of users) {
                        if (['Public', 'All Users', 'Default', 'Default User', 'desktop.ini'].includes(u)) continue;
                        const appData = path.join(usersDir, u, 'AppData', 'Roaming');
                        if (fs.existsSync(appData)) {
                            return appData;
                        }
                    }
                }
            }
        }
    } catch (e) {}
    return null;
}

// Find workbench.html location
function getWorkbenchPath() {
    const candidates = [];

    // Check Windows WSL candidate path first if in WSL
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

    // Linux native paths
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

// Find product.json location
function getProductJsonPath() {
    const candidates = [];

    // Check Windows WSL candidate path first if in WSL
    const wslLocalAppData = getWslWindowsLocalAppData();
    if (wslLocalAppData) {
        candidates.push(path.join(wslLocalAppData, 'Programs', 'Antigravity IDE', 'resources', 'app', 'product.json'));
    }

    if (process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, 'app', 'product.json'));
    }
    const appRoot = vscode.env.appRoot;
    candidates.push(path.join(appRoot, 'product.json'));

    // Linux native path
    candidates.push('/opt/antigravity-ide/resources/app/product.json');

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// Update product.json checksums to avoid VS Code integrity corruption warnings
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
        const outDir = path.join(appRoot, 'out');
        let updated = false;

        for (const relativePath in productJson.checksums) {
            const nativePath = relativePath.split('/').join(path.sep);
            let filePath = path.join(outDir, nativePath);
            if (!fs.existsSync(filePath)) {
                filePath = path.join(appRoot, relativePath);
            }

            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath);
                const hash = crypto.createHash('sha256').update(content).digest('base64').replace(/=+$/, '');
                const oldHash = productJson.checksums[relativePath];
                if (oldHash !== hash) {
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

// Clear JS Code Cache to force Electron to recompile modified workbench files
function clearCodeCache() {
    try {
        const candidates = [];
        
        // Windows WSL cache path
        const wslAppData = getWslWindowsAppData();
        if (wslAppData) {
            candidates.push(path.join(wslAppData, 'Antigravity IDE', 'Code Cache', 'js'));
        }
        
        // Native Linux cache path
        const os = require('os');
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

// Build the custom client script with interpolated config variables
function buildScriptContent(context, wbPath) {
    const templatePath = path.join(context.extensionPath, 'media', 'autoScript.js');
    let content = fs.readFileSync(templatePath, 'utf8');

    let wbDir = path.dirname(wbPath);
    // Convert WSL mount path back to Windows-native absolute path so the Windows renderer can read the state JSON
    if (wbDir.startsWith('/mnt/')) {
        const drive = wbDir[5].toUpperCase();
        wbDir = `${drive}:${wbDir.substring(6)}`;
    }
    wbDir = wbDir.replace(/\\/g, '/');
    content = content.replace(/\/\*\{\{WORKBENCH_DIR\}\}\*\/""/, JSON.stringify(wbDir));
    return content;
}

// Get the state file path
function getStateFilePath() {
    const wbPath = getWorkbenchPath();
    if (!wbPath) return null;
    return path.join(path.dirname(wbPath), 'ag-super-sentinel-state.json');
}

// Read state from JSON file
function readState() {
    const statePath = getStateFilePath();
    if (statePath && fs.existsSync(statePath)) {
        try {
            const raw = fs.readFileSync(statePath, 'utf8');
            return JSON.parse(raw);
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
            "Allow", "Always Allow", "Allow Once", "Allow This Con", "Allow in Workspace",
            "Always Allow in Workspace", "Always Proceed", "Proceed to execution",
            "Yes, approve", "Approve", "Run", "Always Run", "Submit", "Accept",
            "Accept all", "Keep Waiting", "Retry", "Yes, allow this time",
            "Yes, and always allow", "Yes, always run", "Yes, run"
        ],
        totalClicks: 0,
        clickStats: {},
        clickLog: []
    };
}

// Write state back to JSON file
function writeState(state) {
    const statePath = getStateFilePath();
    if (!statePath) return;
    try {
        writeFile(statePath, JSON.stringify(state, null, 4));
    } catch (e) {
        console.error('[Sentinel] Failed to write state:', e.message);
    }
}

// Inject script references into workbench.html
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

    const wbDir = path.dirname(wbPath);
    const destScriptPath = path.join(wbDir, 'ag-super-sentinel-script.js');

    try {
        let html = fs.readFileSync(wbPath, 'utf8');

        // Cleanup any old third-party script tags if they exist
        const oldRegex = new RegExp(`${escapeRegex(OLD_TAG_START)}[\\s\\S]*?${escapeRegex(OLD_TAG_END)}`, 'g');
        html = html.replace(oldRegex, '');

        // Cleanup our own existing tag
        const newRegex = new RegExp(`${escapeRegex(TAG_START)}[\\s\\S]*?${escapeRegex(TAG_END)}`, 'g');
        html = html.replace(newRegex, '');

        // Build and write clean script
        const scriptContent = buildScriptContent(context, wbPath);
        writeFile(destScriptPath, scriptContent);

        // Inject new script tag into HTML
        const ts = Date.now();
        const injection = `\n${TAG_START}\n<script src="ag-super-sentinel-script.js?v=${ts}"></script>\n${TAG_END}`;
        
        if (/<\/body>/i.test(html)) {
            html = html.replace(/<\/body>/i, injection + '\n</body>');
        } else if (/<\/html>/i.test(html)) {
            html = html.replace(/<\/html>/i, injection + '\n</html>');
        } else {
            html += injection;
        }

        writeFile(wbPath, html);

        // Write initial default state if missing
        const statePath = getStateFilePath();
        if (statePath && !fs.existsSync(statePath)) {
            writeState(readState());
        }

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

// Remove script references and clean up state files
function removeScript() {
    const wbPath = getWorkbenchPath();
    if (!wbPath) return false;

    const wbDir = path.dirname(wbPath);
    const destScriptPath = path.join(wbDir, 'ag-super-sentinel-script.js');
    const statePath = path.join(wbDir, 'ag-super-sentinel-state.json');

    try {
        let html = fs.readFileSync(wbPath, 'utf8');

        // Clean up our script tags
        const newRegex = new RegExp(`${escapeRegex(TAG_START)}[\\s\\S]*?${escapeRegex(TAG_END)}`, 'g');
        html = html.replace(newRegex, '');

        writeFile(wbPath, html);

        // Remove files
        if (fs.existsSync(destScriptPath)) fs.unlinkSync(destScriptPath);
        if (fs.existsSync(statePath)) fs.unlinkSync(statePath);

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

// Check if clean script is injected and active
function isScriptInjected() {
    try {
        const wbPath = getWorkbenchPath();
        if (!wbPath) return false;
        const html = fs.readFileSync(wbPath, 'utf8');
        return html.includes(TAG_START) && html.includes(TAG_END);
    } catch (e) {
        return false;
    }
}

// Helper to format remaining time (duration only, e.g. 2h 30m)
function formatCountdown(expirationSec) {
    if (!expirationSec) return 'No Reset';
    const now = Math.floor(Date.now() / 1000);
    const diff = expirationSec - now;
    if (diff <= 0) return '0m';
    
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    if (h > 0) {
        return `${h}h ${m}m`;
    }
    return `${m}m`;
}

// Update status bar item content based on current configuration and state
function updateStatusBar() {
    if (!statusBarItem) return;
    const wbPath = getWorkbenchPath();

    const state = readState();
    const injected = wbPath ? isScriptInjected() : false;
    const data = gatherSentinelData();
    const activeModel = data.activeModel || 'Gemini 3.5 Flash (High)';
    const quotaPct = Math.round((data.activeModelRemainingFraction || 0.0) * 100);
    const countdown = formatCountdown(data.activeModelExpiration);

    if (!wbPath) {
        statusBarItem.text = `$(circle-slash) Kadzura Super Sentinel : NO UI ACCESS | ${activeModel} ${quotaPct}% (${countdown})`;
        statusBarItem.tooltip = `Antigravity Super Sentinel clicker cannot locate workbench.html.\nActive Model: ${activeModel}\nQuota Remaining: ${quotaPct}%\nReset in: ${countdown}\nTelemetry is active, but auto-clicker is disabled.`;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        statusBarItem.color = '#fbbf24';
    } else if (!injected) {
        statusBarItem.text = `$(circle-slash) Kadzura Super Sentinel : NOT INSTALLED | ${activeModel} ${quotaPct}% (${countdown})`;
        statusBarItem.tooltip = `Antigravity Super Sentinel clicker is not injected.\nActive Model: ${activeModel}\nQuota Remaining: ${quotaPct}%\nReset in: ${countdown}\nClick to install/enable.`;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        statusBarItem.color = '#ef4444';
    } else {
        if (state.enabled) {
            statusBarItem.text = `$(eye) Kadzura Super Sentinel : ACTIVE | ${activeModel} ${quotaPct}% (${countdown})`;
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.remoteBackground');
            statusBarItem.color = '#c084fc';
            statusBarItem.tooltip = `Antigravity Super Sentinel clicker is Active.\nActive Model: ${activeModel}\nQuota Remaining: ${quotaPct}%\nReset in: ${countdown}\nClick to open Sentinel Dashboard.`;
        } else {
            statusBarItem.text = `$(circle-slash) Kadzura Super Sentinel : PAUSED | ${activeModel} ${quotaPct}% (${countdown})`;
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            statusBarItem.color = '#fbbf24';
            statusBarItem.tooltip = `Antigravity Super Sentinel clicker is Paused.\nActive Model: ${activeModel}\nQuota Remaining: ${quotaPct}%\nReset in: ${countdown}\nClick to open Sentinel Dashboard.`;
        }
    }
    statusBarItem.show();
}

// Setup file watcher to sync state changes automatically
function setupStateFileWatcher() {
    if (stateWatcher) return;
    const statePath = getStateFilePath();
    if (!statePath) return;

    try {
        stateWatcher = fs.watch(statePath, (eventType) => {
            if (eventType === 'change') {
                const latestState = readState();
                updateStatusBar();
                
                // If sidebar webview panel is currently active, push updates
                if (sidebarProvider && sidebarProvider._view) {
                    sidebarProvider._view.webview.postMessage({
                        command: 'updateState',
                        state: latestState
                    });
                }
            }
        });
        console.log(`[Sentinel] Started state file watcher on: ${statePath}`);
    } catch (e) {
        console.error('[Sentinel] Failed to start file watcher:', e.message);
    }
}

// Gather sentinel dashboard analytics dynamically from transcript and DB/LSP
function gatherSentinelData() {
    const data = {
        sessionActive: false,
        sessionId: '',
        activeModel: 'Gemini 3.5 Flash (High)',
        activeModelExpiration: null,
        activeModelRemainingFraction: 0.0,
        modelsList: [],
        email: 'offline',
        plan: 'Free',
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

    try {
        const homedir = os.homedir();
        const brainDir = path.join(homedir, '.gemini', 'antigravity-ide', 'brain');
        if (!fs.existsSync(brainDir)) return data;

        const now = Date.now();
        // Re-scan brain directory only once every 10 seconds to detect new session IDs
        if (!cachedLatestSession || (now - lastSessionScanTime > 10000)) {
            const sessions = fs.readdirSync(brainDir);
            let latestSession = null;
            let latestTime = 0;

            for (const session of sessions) {
                const sessionPath = path.join(brainDir, session);
                const transcriptPath = path.join(sessionPath, '.system_generated', 'logs', 'transcript.jsonl');
                if (fs.existsSync(transcriptPath)) {
                    const stat = fs.statSync(transcriptPath);
                    if (stat.mtimeMs > latestTime) {
                        latestTime = stat.mtimeMs;
                        latestSession = {
                            id: session,
                            path: sessionPath,
                            transcriptPath: transcriptPath
                        };
                    }
                }
            }
            if (latestSession) {
                cachedLatestSession = latestSession;
            }
            lastSessionScanTime = now;
        }

        if (!cachedLatestSession) return data;

        data.sessionActive = true;
        data.sessionId = cachedLatestSession.id;

        // Parse transcript.jsonl with mtime caching to prevent heavy parsing
        const tPath = cachedLatestSession.transcriptPath;
        const stat = fs.statSync(tPath);
        
        if (tPath !== cachedTranscriptPath || stat.mtimeMs !== cachedTranscriptMtime) {
            const content = fs.readFileSync(tPath, 'utf8');
            const lines = content.trim().split('\n').filter(l => l.trim().length > 0);
            let totalCharacters = 0;
            let transcriptActiveModel = null;
            const steps = [];

            for (const line of lines) {
                try {
                    const step = JSON.parse(line);
                    steps.push({
                        step_index: step.step_index,
                        source: step.source,
                        type: step.type,
                        status: step.status,
                        created_at: step.created_at,
                        content_length: step.content ? step.content.length : 0,
                        tool_calls: step.tool_calls ? step.tool_calls.map(tc => {
                            let toolArgs = {};
                            try {
                                toolArgs = typeof tc.args === 'string' ? JSON.parse(tc.args) : tc.args;
                            } catch (e) {}
                            return {
                                name: tc.name,
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
                                if (toVal.endsWith('.')) {
                                    toVal = toVal.slice(0, -1);
                                }
                                transcriptActiveModel = toVal.replace(/[`]/g, '').trim();
                            }
                        }
                    }
                } catch (e) {}
            }

            cachedTranscriptSteps = steps;
            cachedTranscriptActiveModel = transcriptActiveModel;
            cachedTranscriptTotalChars = totalCharacters;
            cachedTranscriptPath = tPath;
            cachedTranscriptMtime = stat.mtimeMs;
        }

        data.steps = cachedTranscriptSteps;
        data.stepsCount = cachedTranscriptSteps.length;
        const totalCharacters = cachedTranscriptTotalChars;
        const transcriptActiveModel = cachedTranscriptActiveModel;

        // Use live cached LSP data if available, with SQLite fallback
        if (cachedLspData && cachedLspData.modelsList && cachedLspData.modelsList.length > 0) {
            data.email = cachedLspData.email;
            data.plan = cachedLspData.plan;
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
                data.activeModel = activeModelObj.name;
                data.activeModelExpiration = activeModelObj.expiration;
                data.activeModelRemainingFraction = activeModelObj.remainingFraction;
            }
        } else {
            // SQLite Fallback (e.g. if LSP is loading)
            try {
                const pythonScript = path.join(__dirname, 'query_model_info.py');
                const modelInfoRaw = execSync(`python3 "${pythonScript}"`, { encoding: 'utf8' });
                if (modelInfoRaw) {
                    const modelInfo = JSON.parse(modelInfoRaw);
                    if (modelInfo.activeModel && !transcriptActiveModel) {
                        data.activeModel = modelInfo.activeModel;
                    }
                    data.activeModelExpiration = modelInfo.expiration;
                    data.activeModelRemainingFraction = modelInfo.remainingFraction;
                    data.modelsList = modelInfo.models;
                }
            } catch (e) {
                console.error('[Sentinel] Failed to query model info fallback:', e.message);
            }
        }

        // Map limits
        const MODEL_LIMITS = {
            'Gemini Pro 3.1 High': { limit: 2000000, warn: 1500000 },
            'Gemini 3.1 Pro (High)': { limit: 2000000, warn: 1500000 },
            'Gemini Pro 3.1 Low': { limit: 500000, warn: 375000 },
            'Gemini 3.1 Pro (Low)': { limit: 500000, warn: 375000 },
            'Gemini Flash 3.5 High': { limit: 1000000, warn: 750000 },
            'Gemini 3.5 Flash (High)': { limit: 1000000, warn: 750000 },
            'Gemini Flash 3.5 Medium': { limit: 500000, warn: 375000 },
            'Gemini 3.5 Flash (Medium)': { limit: 500000, warn: 375000 },
            'Gemini Flash 3.5 Low': { limit: 200000, warn: 150000 },
            'Gemini 3.5 Flash (Low)': { limit: 200000, warn: 150000 },
            'Claude Sonnet 4.6': { limit: 200000, warn: 150000 },
            'Claude Sonnet 4.6 (Thinking)': { limit: 200000, warn: 150000 },
            'Claude Opus 4.6': { limit: 200000, warn: 150000 },
            'Claude Opus 4.6 (Thinking)': { limit: 200000, warn: 150000 },
            'GPT OSS 12B': { limit: 32000, warn: 24000 },
            'GPT-OSS 120B (Medium)': { limit: 32000, warn: 24000 }
        };

        const currentModelLimits = MODEL_LIMITS[data.activeModel] || { limit: 1000000, warn: 750000 };
        data.stepsLimit = data.activeModel.includes('Pro') ? 150 : 100;
        data.estimatedTokens = Math.round(totalCharacters / 3.3);
        data.warningThreshold = currentModelLimits.warn;
        data.contextLimit = currentModelLimits.limit;

        // Scan Browser Recordings
        const recDir = path.join(homedir, '.gemini', 'antigravity-ide', 'browser_recordings', data.sessionId);
        if (fs.existsSync(recDir)) {
            const files = fs.readdirSync(recDir);
            const imageFiles = files.filter(f => f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.webp'))
                                    .sort((a, b) => b.localeCompare(a))
                                    .slice(0, 8);
            data.browserFrames = imageFiles.map(f => path.join(recDir, f));
        }

        // Scan Skills
        const skillsDir = path.join(homedir, '.gemini', 'config', 'skills');
        if (fs.existsSync(skillsDir)) {
            const skillFolders = fs.readdirSync(skillsDir);
            for (const folder of skillFolders) {
                const skillMdPath = path.join(skillsDir, folder, 'SKILL.md');
                if (fs.existsSync(skillMdPath)) {
                    const skillMd = fs.readFileSync(skillMdPath, 'utf8');
                    let skillName = folder;
                    let skillDesc = '';
                    const matchName = skillMd.match(/name:\s*(.*)/i);
                    const matchDesc = skillMd.match(/description:\s*>([\s\S]*?)---/i) || skillMd.match(/description:\s*(.*)/i);
                    if (matchName) skillName = matchName[1].trim();
                    if (matchDesc) skillDesc = matchDesc[1].trim().replace(/\n/g, ' ');
                    data.skills.push({ name: skillName, description: skillDesc });
                }
            }
        }

        // Scan MCP Config
        const mcpPath = path.join(homedir, '.gemini', 'config', 'mcp_config.json');
        if (fs.existsSync(mcpPath)) {
            try {
                const mcpRaw = fs.readFileSync(mcpPath, 'utf8');
                const mcpJson = JSON.parse(mcpRaw);
                if (mcpJson && mcpJson.mcpServers) {
                    for (const serverName in mcpJson.mcpServers) {
                        data.mcpServers.push({
                            name: serverName,
                            command: mcpJson.mcpServers[serverName].command,
                            status: 'Active'
                        });
                    }
                }
            } catch (e) {}
        }

        // Scan Child Sessions (Sub-trajectories)
        const conversationsDir = path.join(homedir, '.gemini', 'antigravity-ide', 'conversations');
        const agentapiPath = path.join(homedir, '.gemini', 'antigravity-ide', 'bin', 'agentapi');
        if (fs.existsSync(conversationsDir) && fs.existsSync(agentapiPath)) {
            const files = fs.readdirSync(conversationsDir);
            const dbFiles = files.filter(f => f.endsWith('.db') && !f.includes(data.sessionId));
            for (const dbFile of dbFiles) {
                const subSessionId = dbFile.substring(0, dbFile.length - 3);
                try {
                    const metadataRaw = execSync(`"${agentapiPath}" get-conversation-metadata ${subSessionId}`, { encoding: 'utf8' });
                    const metaData = JSON.parse(metadataRaw);
                    const parentId = metaData?.response?.conversationMetadata?.metadata?.parentConversationId;
                    if (parentId === data.sessionId) {
                        data.childSessions.push({
                            id: subSessionId,
                            nestingDepth: metaData?.response?.conversationMetadata?.metadata?.nestingDepth || 1
                        });
                    }
                } catch (e) {}
            }
        }

    } catch (err) {
        console.error('[Sentinel] Data gathering error:', err.message);
    }

    return data;
}

// Native Sidebar WebviewViewProvider Implementation
class SentinelViewProvider {
    constructor(extensionUri, context) {
        this._extensionUri = extensionUri;
        this._context = context;
        this._view = undefined;
    }

    resolveWebviewView(webviewView, context, token) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        const state = readState();
        const sentinelData = gatherSentinelData();

        // Translate browser frame paths to Webview URIs
        if (sentinelData.browserFrames.length > 0) {
            sentinelData.browserFrames = sentinelData.browserFrames.map(f => {
                return webviewView.webview.asWebviewUri(vscode.Uri.file(f)).toString();
            });
        }

        webviewView.webview.html = buildSettingsHtml({
            ...state,
            overwatch: sentinelData,
            version: this._context.extension?.packageJSON?.version || '1.0.0'
        });

        // Start active session polling timer (every 2 seconds)
        const pollInterval = setInterval(() => {
            if (webviewView.visible) {
                try {
                    const data = gatherSentinelData();
                    if (data.browserFrames.length > 0) {
                        data.browserFrames = data.browserFrames.map(f => {
                            return webviewView.webview.asWebviewUri(vscode.Uri.file(f)).toString();
                        });
                    }
                    webviewView.webview.postMessage({
                        command: 'updateOverwatch',
                        data: data
                    });
                    updateStatusBar();
                } catch (e) {
                    console.error('[Sentinel] Polling failed:', e.message);
                }
            }
        }, 2000);

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
                state.clickIntervalMs = msg.data.clickIntervalMs;
                state.scrollIntervalMs = msg.data.scrollIntervalMs;
                state.scrollPauseMs = msg.data.scrollPauseMs;
                state.clickPatterns = msg.data.clickPatterns;
                writeState(state);
            } else if (msg.command === 'clearLogs') {
                state.clickLog = [];
                state.totalClicks = 0;
                state.clickStats = {};
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

// Extension Activation entry point
function activate(context) {
    console.log('[Sentinel] Extension activated.');

    // Start LSP polling loop
    queryLsp().then(data => {
        if (data) {
            cachedLspData = data;
            updateStatusBar();
        }
    }).catch(()=>{});
    lspPollInterval = setInterval(async () => {
        try {
            const data = await queryLsp();
            if (data) {
                cachedLspData = data;
            }
        } catch (e) {}
        updateStatusBar();
    }, 3000);

    // Status bar item setup (placed on the far left)
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100000);
    statusBarItem.command = 'antigravity-super-sentinel.openSettings';
    context.subscriptions.push(statusBarItem);
    updateStatusBar();

    // Register Sidebar View Provider
    sidebarProvider = new SentinelViewProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'antigravity-super-sentinel-view',
            sidebarProvider
        )
    );

    // Auto-inject script on startup if not already injected
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

    // Register Enable Command
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-super-sentinel.enable', async () => {
            const success = injectScript(context, false);
            if (success) {
                clearCodeCache();
                updateChecksums();
                updateStatusBar();
                setupStateFileWatcher();
                vscode.window.showInformationMessage('[Sentinel] Clicker script injected successfully. Reloading window...', 'Reload Now').then(() => {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                });
            }
        })
    );

    // Register Disable Command
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-super-sentinel.disable', async () => {
            const success = removeScript();
            if (success) {
                if (stateWatcher) {
                    stateWatcher.close();
                    stateWatcher = null;
                }
                clearCodeCache();
                updateChecksums();
                updateStatusBar();
                vscode.window.showInformationMessage('[Sentinel] Clicker script removed successfully. Reloading window...', 'Reload Now').then(() => {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                });
            }
        })
    );

    // Register Toggle Command
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-super-sentinel.toggle', () => {
            if (!isScriptInjected()) {
                vscode.commands.executeCommand('antigravity-super-sentinel.enable');
                return;
            }

            const state = readState();
            const nextEnabled = !state.enabled;

            state.enabled = nextEnabled;
            writeState(state);
            updateStatusBar();

            const message = nextEnabled ? 'Auto-Accept clicker is now ACTIVE.' : 'Auto-Accept clicker is now PAUSED.';
            vscode.window.setStatusBarMessage(`[Sentinel] ${message}`, 3000);
        })
    );

    // Register Open Settings Dashboard Command (focuses the sidebar view)
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-super-sentinel.openSettings', () => {
            vscode.commands.executeCommand(
                'workbench.view.extension.antigravity-super-sentinel-container'
            );
        })
    );

    // Sync configuration changes from standard settings
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('antigravity-super-sentinel')) {
                const config = vscode.workspace.getConfiguration('antigravity-super-sentinel');
                const state = readState();
                state.enabled = config.get('enabled', true);
                state.scrollEnabled = config.get('scrollEnabled', true);
                writeState(state);
                updateStatusBar();
            }
        })
    );
}

function deactivate() {
    if (lspPollInterval) {
        clearInterval(lspPollInterval);
        lspPollInterval = null;
    }
    if (stateWatcher) {
        stateWatcher.close();
        stateWatcher = null;
    }
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}

module.exports = { activate, deactivate };
