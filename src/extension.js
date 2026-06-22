const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const execSync = require('child_process').execSync;
const buildSettingsHtml = require('./settingsHtml');

function debugLog(msg) {
    try {
        const logPath = '/home/kadzura/.gemini/antigravity-ide/brain/a9d1c664-09eb-4e68-b570-253a24f7eddc/scratch/sentinel_debug.log';
        const ts = new Date().toISOString();
        fs.appendFileSync(logPath, `[${ts}] ${msg}\n`, 'utf8');
    } catch (e) {}
}


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

// Dynamic app config directory path resolver based on platform
function getAppConfigDir() {
    const os = require('os');
    const home = os.homedir();
    if (process.platform === 'win32') {
        const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
        return path.join(appdata, 'Antigravity IDE');
    } else if (process.platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Antigravity IDE');
    } else {
        const configDir = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
        return path.join(configDir, 'Antigravity IDE');
    }
}

// Get Windows APPDATA path if running inside WSL environment
function getWindowsAppDataFromWsl() {
    try {
        const raw = execSync('cmd.exe /c "echo %APPDATA%"', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) {
            const winPath = lines[lines.length - 1];
            if (/^[a-zA-Z]:\\/.test(winPath)) {
                const wslPath = execSync(`wslpath -u "${winPath}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
                if (wslPath && fs.existsSync(wslPath)) {
                    return wslPath;
                }
            }
        }
    } catch (e) {
        // Ignore error
    }
    return null;
}

// Get the path of state.vscdb
function getDbPath() {
    const os = require('os');
    const home = os.homedir();
    
    if (process.platform === 'win32') {
        const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
        return path.join(appdata, 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb');
    }
    
    // Linux/macOS candidates
    const candidates = [];
    
    // Add Windows candidates if running in WSL
    if (process.platform === 'linux') {
        const winAppData = getWindowsAppDataFromWsl();
        if (winAppData) {
            candidates.push(path.join(winAppData, 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb'));
        }
    }
    
    if (process.platform === 'darwin') {
        candidates.push(path.join(home, 'Library', 'Application Support', 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb'));
    } else {
        // Linux desktop
        const configDir = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
        candidates.push(path.join(configDir, 'Antigravity IDE', 'User', 'globalStorage', 'state.vscdb'));
    }
    
    // Remote server candidates (for WSL / SSH remote hosts)
    candidates.push(path.join(home, '.antigravity-ide-server', 'data', 'User', 'globalStorage', 'state.vscdb'));
    candidates.push(path.join(home, '.antigravity-server', 'data', 'User', 'globalStorage', 'state.vscdb'));
    
    // Find first that exists
    for (const cand of candidates) {
        if (fs.existsSync(cand)) {
            return cand;
        }
    }
    
    // Fallback to first desktop candidate
    return candidates[0];
}

let cachedModelInfoRaw = null;
let cachedDbMtime = 0;
let cachedDbPath = '';
let lastPythonRunTime = 0;

// Robust runner for the query_model_info.py script passing dynamic DB path (with mtime caching optimization)
function runQueryModelInfo() {
    try {
        const dbPath = getDbPath();
        debugLog(`runQueryModelInfo: dbPath=${dbPath}, exists=${fs.existsSync(dbPath)}`);
        if (!fs.existsSync(dbPath)) return null;

        const now = Date.now();
        const stat = fs.statSync(dbPath);
        const cacheAge = now - lastPythonRunTime;

        // On Windows, file mtime changes are instantly visible.
        // On WSL/Linux, file mtime changes on Windows mounts (drvfs) are often cached by the kernel,
        // so we enforce a maximum cache age of 4 seconds to force checking.
        const isCacheValid = (process.platform === 'win32')
            ? (dbPath === cachedDbPath && stat.mtimeMs === cachedDbMtime && cachedModelInfoRaw)
            : (dbPath === cachedDbPath && stat.mtimeMs === cachedDbMtime && cacheAge < 4000 && cachedModelInfoRaw);

        if (isCacheValid) {
            debugLog(`runQueryModelInfo: Cache hit (age: ${cacheAge}ms)`);
            return cachedModelInfoRaw;
        }

        const pythonScript = path.join(__dirname, 'query_model_info.py');
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        let modelInfoRaw = null;

        try {
            debugLog(`runQueryModelInfo: executing "${pythonCmd}" "${pythonScript}" "${dbPath}"`);
            modelInfoRaw = execSync(`"${pythonCmd}" "${pythonScript}" "${dbPath}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (e) {
            debugLog(`runQueryModelInfo error with "${pythonCmd}": ${e.message}. Stderr: ${e.stderr ? e.stderr.toString() : ''}`);
            if (process.platform === 'win32') {
                const fallbacks = ['python3', 'py'];
                for (const cmd of fallbacks) {
                    try {
                        debugLog(`runQueryModelInfo fallback: executing "${cmd}"`);
                        modelInfoRaw = execSync(`"${cmd}" "${pythonScript}" "${dbPath}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
                        if (modelInfoRaw) break;
                    } catch (e2) {
                        debugLog(`runQueryModelInfo fallback "${cmd}" error: ${e2.message}`);
                    }
                }
            }
        }

        if (modelInfoRaw) {
            cachedModelInfoRaw = modelInfoRaw;
            cachedDbMtime = stat.mtimeMs;
            cachedDbPath = dbPath;
            lastPythonRunTime = now;
            debugLog(`runQueryModelInfo success, returned length: ${modelInfoRaw.length}`);
        } else {
            debugLog(`runQueryModelInfo failed, returned null`);
        }
        return modelInfoRaw;
    } catch (err) {
        debugLog(`runQueryModelInfo outer catch: ${err.message}`);
    }
    return null;
}

// Scans PIDs, detects ports, updates cachedLspData
async function queryLsp() {
    try {
        debugLog("queryLsp: starting scan");
        let processes = [];
        const isWin = process.platform === 'win32';
        
        if (isWin) {
            try {
                // Command to list process details in JSON on Windows using PowerShell
                const cmd = 'powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name LIKE \'%language_server%\'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"';
                const psOut = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
                if (psOut.trim()) {
                    const parsed = JSON.parse(psOut);
                    if (parsed) {
                        const procs = Array.isArray(parsed) ? parsed : [parsed];
                        procs.forEach(p => {
                            processes.push({
                                ProcessId: p.ProcessId,
                                CommandLine: p.CommandLine,
                                isWindowsProcess: true
                            });
                        });
                    }
                }
            } catch (e) {
                // Fallback using older gwmi command
                try {
                    const cmd = 'powershell -Command "Get-WmiObject Win32_Process -Filter \\"Name LIKE \'%language_server%\'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"';
                    const psOut = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
                    if (psOut.trim()) {
                        const parsed = JSON.parse(psOut);
                        if (parsed) {
                            const procs = Array.isArray(parsed) ? parsed : [parsed];
                            procs.forEach(p => {
                                processes.push({
                                    ProcessId: p.ProcessId,
                                    CommandLine: p.CommandLine,
                                    isWindowsProcess: true
                                });
                            });
                        }
                    }
                } catch (e2) {}
            }
        } else {
            // Linux/macOS native process scanning
            let psOut = '';
            try {
                psOut = execSync('ps -ef | grep language_server | grep -v grep', { encoding: 'utf8' });
            } catch (e) {
                debugLog(`queryLsp ps grep failed: ${e.message}`);
            }
            if (psOut.trim()) {
                const lines = psOut.trim().split(/\r?\n/);
                lines.forEach(line => {
                    const parts = line.trim().split(/\s+/);
                    const pid = parts[1];
                    if (pid && !isNaN(Number(pid))) {
                        processes.push({
                            ProcessId: Number(pid),
                            CommandLine: line,
                            isWindowsProcess: false
                        });
                    }
                });
            }
            
            // If no native processes are found, check if we are in WSL and can query Windows processes via powershell.exe
            if (processes.length === 0) {
                try {
                    const cmd = 'powershell.exe -Command "Get-CimInstance Win32_Process -Filter \\"Name LIKE \'%language_server%\'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"';
                    const psOut = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
                    if (psOut.trim()) {
                        const parsed = JSON.parse(psOut);
                        if (parsed) {
                            const procs = Array.isArray(parsed) ? parsed : [parsed];
                            procs.forEach(p => {
                                processes.push({
                                    ProcessId: p.ProcessId,
                                    CommandLine: p.CommandLine,
                                    isWindowsProcess: true
                                });
                            });
                        }
                    }
                } catch (e) {
                    // Fallback using older gwmi command via powershell.exe
                    try {
                        const cmd = 'powershell.exe -Command "Get-WmiObject Win32_Process -Filter \\"Name LIKE \'%language_server%\'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"';
                        const psOut = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
                        if (psOut.trim()) {
                            const parsed = JSON.parse(psOut);
                            if (parsed) {
                                const procs = Array.isArray(parsed) ? parsed : [parsed];
                                procs.forEach(p => {
                                    processes.push({
                                        ProcessId: p.ProcessId,
                                        CommandLine: p.CommandLine,
                                        isWindowsProcess: true
                                    });
                                });
                            }
                        }
                    } catch (e2) {}
                }
            }
        }
        
        debugLog(`queryLsp: found ${processes.length} processes`);
        if (processes.length === 0) return null;
        
        for (const proc of processes) {
            const pid = proc.ProcessId;
            const cmdLine = proc.CommandLine || '';
            if (!pid || isNaN(Number(pid))) continue;
            
            const tokenMatch = cmdLine.match(/--csrf_token[\s=]+([^\s]+)/);
            if (!tokenMatch) {
                debugLog(`queryLsp: PID ${pid} missing csrf token in cmdLine`);
                continue;
            }
            const csrf = tokenMatch[1].replace(/['"]+/g, "").trim();
            debugLog(`queryLsp: PID ${pid} token=${csrf}`);
            
            const ports = [];
            if (proc.isWindowsProcess) {
                try {
                    const netstatCmd = process.platform === 'win32' ? 'netstat -ano' : 'netstat.exe -ano';
                    const netstatOut = execSync(netstatCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
                    netstatOut.split(/\r?\n/).forEach((l) => {
                        if (l.includes('LISTENING') && l.includes(String(pid))) {
                            const parts = l.trim().split(/\s+/);
                            if (parts[parts.length - 1] === String(pid)) {
                                const address = parts[1];
                                const portMatch = address.match(/:(\d+)$/);
                                if (portMatch) ports.push(portMatch[1]);
                            }
                        }
                    });
                } catch (e) {
                    debugLog(`queryLsp netstat.exe failed: ${e.message}`);
                }
            } else {
                let lsofOut = '';
                try {
                    lsofOut = execSync(`lsof -nP -iTCP -sTCP:LISTEN -a -p ${pid}`, { encoding: 'utf8' });
                } catch (e) {
                    try {
                        lsofOut = execSync(`ss -lntp | grep "pid=${pid}," || true`, { encoding: 'utf8' });
                    } catch (e2) {}
                }
                if (lsofOut.trim()) {
                    lsofOut.trim().split(/\r?\n/).forEach((l) => {
                        const portMatch = l.match(/:(\d+)\s+/) || l.match(/127\.0\.0\.1:(\d+)/);
                        if (portMatch) ports.push(portMatch[1]);
                    });
                }
            }
            
            const uniquePorts = [...new Set(ports)];
            debugLog(`queryLsp: PID ${pid} unique ports found: ${uniquePorts.join(',')}`);
            for (const port of uniquePorts) {
                debugLog(`queryLsp: posting to port ${port}`);
                const result = await postToLsp(port, csrf);
                if (result) {
                    debugLog(`queryLsp: success on port ${port}, email=${result.email}`);
                    return result;
                } else {
                    debugLog(`queryLsp: failed on port ${port}`);
                }
            }
        }
    } catch (e) {
        debugLog(`queryLsp outer error: ${e.message}`);
    }
    return null;
}

// Helper to get active model preference name from SQLite DB
function getActiveModelNameFromSqlite() {
    try {
        const modelInfoRaw = runQueryModelInfo();
        if (modelInfoRaw) {
            const modelInfo = JSON.parse(modelInfoRaw);
            return modelInfo.activeModel;
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

// Find workbench.html location
function getWorkbenchPath() {
    const appRoot = vscode.env.appRoot;
    const candidates = [
        path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.html'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// Find product.json location
function getProductJsonPath() {
    if (process.resourcesPath) {
        const p = path.join(process.resourcesPath, 'app', 'product.json');
        if (fs.existsSync(p)) return p;
    }
    const appRoot = vscode.env.appRoot;
    const p = path.join(appRoot, 'product.json');
    if (fs.existsSync(p)) return p;
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
        const cacheDir = path.join(getAppConfigDir(), 'Code Cache', 'js');
        if (fs.existsSync(cacheDir)) {
            fs.rmSync(cacheDir, { recursive: true, force: true });
            console.log(`[Sentinel] Cleared cache directory: ${cacheDir}`);
        }
    } catch (e) {
        console.warn('[Sentinel] Failed to clear V8 code cache:', e.message);
    }
}

// Build the custom client script with interpolated config variables
function buildScriptContent(context, wbPath) {
    const templatePath = path.join(context.extensionPath, 'media', 'autoScript.js');
    let content = fs.readFileSync(templatePath, 'utf8');

    const wbDir = path.dirname(wbPath).replace(/\\/g, '/');
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
function injectScript(context) {
    const wbPath = getWorkbenchPath();
    if (!wbPath) {
        vscode.window.showErrorMessage('[Sentinel] workbench.html not found!');
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
        vscode.window.showErrorMessage(`[Sentinel] Injection failed: ${e.message}`);
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
    if (!statusBarItem) {
        debugLog("updateStatusBar: statusBarItem is null/undefined");
        return;
    }
    
    try {
        const isRemote = !!vscode.env.remoteName;
        const injected = isRemote || isScriptInjected();
        const state = readState();

        if (!injected) {
            statusBarItem.text = '$(circle-slash) Kadzura Super Sentinel : NOT INSTALLED';
            statusBarItem.tooltip = 'Antigravity Super Sentinel clicker is not injected. Click to install/enable.';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            statusBarItem.color = '#ef4444';
            debugLog("updateStatusBar: NOT INSTALLED status");
        } else {
            const data = gatherSentinelData();
            const activeModel = data.activeModel || 'Gemini 3.5 Flash (High)';
            const quotaPct = Math.round((data.activeModelRemainingFraction || 0.0) * 100);
            const countdown = formatCountdown(data.activeModelExpiration);

            const statusLabel = isRemote ? 'REMOTE ACTIVE' : (state.enabled ? 'ACTIVE' : 'PAUSED');
            const icon = state.enabled ? '$(eye)' : '$(circle-slash)';
            
            statusBarItem.text = `${icon} Kadzura Super Sentinel : ${statusLabel} | ${activeModel} ${quotaPct}% (${countdown})`;
            debugLog(`updateStatusBar: text="${statusBarItem.text}"`);
            
            if (state.enabled) {
                statusBarItem.backgroundColor = undefined; // Avoid using unsupported ThemeColor 'statusBarItem.remoteBackground'
                statusBarItem.color = '#c084fc';
                statusBarItem.tooltip = `Antigravity Super Sentinel clicker is ${statusLabel}.\nActive Model: ${activeModel}\nQuota Remaining: ${quotaPct}%\nReset in: ${countdown}\nClick to open Sentinel Dashboard.`;
            } else {
                statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                statusBarItem.color = '#fbbf24';
                statusBarItem.tooltip = `Antigravity Super Sentinel clicker is ${statusLabel}.\nActive Model: ${activeModel}\nQuota Remaining: ${quotaPct}%\nReset in: ${countdown}\nClick to open Sentinel Dashboard.`;
            }
        }
        statusBarItem.show();
    } catch (err) {
        debugLog(`updateStatusBar error: ${err.message}`);
        console.error('[Sentinel] Error in updateStatusBar:', err.message);
    }
}

// Unified synchronization function to update both the status bar and the active webview panel
function syncOverwatchData() {
    try {
        const data = gatherSentinelData();
        debugLog(`syncOverwatchData: gathered activeModel=${data.activeModel}, email=${data.email}, modelsListCount=${data.modelsList.length}`);
        updateStatusBar();
        if (sidebarProvider && sidebarProvider._view) {
            if (sidebarProvider._view.visible) {
                // Translate browser frame paths to Webview URIs
                if (data.browserFrames.length > 0) {
                    data.browserFrames = data.browserFrames.map(f => {
                        return sidebarProvider._view.webview.asWebviewUri(vscode.Uri.file(f)).toString();
                    });
                }
                debugLog(`syncOverwatchData: posting to visible webview`);
                sidebarProvider._view.webview.postMessage({
                    command: 'updateOverwatch',
                    data: data
                });
            } else {
                debugLog(`syncOverwatchData: webview is not visible`);
            }
        }
    } catch (e) {
        debugLog(`syncOverwatchData error: ${e.message}`);
        console.error('[Sentinel] Failed to sync overwatch data to webview:', e.message);
    }
}

let dbWatcher = null;
let transcriptWatcher = null;
let currentWatchedTranscriptPath = '';

// Watch the state.vscdb file for real-time model preferences changes
function setupDbWatcher() {
    if (dbWatcher) return;
    const dbPath = getDbPath();
    if (!fs.existsSync(dbPath)) {
        // If file doesn't exist yet, watch the folder to detect when it's created
        const dir = path.dirname(dbPath);
        if (fs.existsSync(dir)) {
            try {
                dbWatcher = fs.watch(dir, (eventType, filename) => {
                    if (filename === 'state.vscdb') {
                        syncOverwatchData();
                    }
                });
            } catch (e) {}
        }
        return;
    }
    try {
        dbWatcher = fs.watch(dbPath, (eventType) => {
            if (eventType === 'change') {
                syncOverwatchData();
            }
        });
    } catch (e) {}
}

// Watch the active transcript.jsonl file for real-time execution steps and model updates
function setupTranscriptWatcher(tPath) {
    if (currentWatchedTranscriptPath === tPath) return;
    if (transcriptWatcher) {
        transcriptWatcher.close();
        transcriptWatcher = null;
    }
    if (!tPath || !fs.existsSync(tPath)) return;
    try {
        const dir = path.dirname(tPath);
        transcriptWatcher = fs.watch(dir, (eventType, filename) => {
            if (filename === 'transcript.jsonl') {
                syncOverwatchData();
            }
        });
        currentWatchedTranscriptPath = tPath;
    } catch (e) {}
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
                syncOverwatchData();
                
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
        const os = require('os');
        const geminiBaseDir = path.join(os.homedir(), '.gemini');
        const brainDir = path.join(geminiBaseDir, 'antigravity-ide', 'brain');
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

        // Register transcript file watcher for real-time status updates
        setupTranscriptWatcher(cachedLatestSession.transcriptPath);

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
            // 1. Prioritize SQLite database active model by name
            const sqliteActiveName = getActiveModelNameFromSqlite();
            if (sqliteActiveName) {
                activeModelObj = cachedLspData.modelsList.find(m => m.name === sqliteActiveName);
            }
            // 2. Fall back to transcript's Model Selection event
            if (!activeModelObj && transcriptActiveModel) {
                activeModelObj = cachedLspData.modelsList.find(m => m.name === transcriptActiveModel);
            }
            // 3. Default fallback to first model
            if (!activeModelObj && cachedLspData.modelsList.length > 0) {
                activeModelObj = cachedLspData.modelsList[0];
            }

            if (activeModelObj) {
                data.activeModel = activeModelObj.name;
                data.activeModelExpiration = activeModelObj.expiration;
                data.activeModelRemainingFraction = activeModelObj.remainingFraction;
            } else {
                if (transcriptActiveModel) {
                    data.activeModel = transcriptActiveModel;
                }
            }
        } else {
            // SQLite Fallback (e.g. if LSP is loading)
            try {
                const modelInfoRaw = runQueryModelInfo();
                if (modelInfoRaw) {
                    const modelInfo = JSON.parse(modelInfoRaw);
                    data.modelsList = modelInfo.models || [];
                    
                    let activeModelObj = null;
                    // 1. Prioritize database selection
                    if (modelInfo.activeModel) {
                        activeModelObj = data.modelsList.find(m => m.name === modelInfo.activeModel);
                    }
                    // 2. Fall back to transcript
                    if (!activeModelObj && transcriptActiveModel) {
                        activeModelObj = data.modelsList.find(m => m.name === transcriptActiveModel);
                    }
                    
                    if (activeModelObj) {
                        data.activeModel = activeModelObj.name;
                        data.activeModelExpiration = activeModelObj.expiration;
                        data.activeModelRemainingFraction = activeModelObj.remainingFraction;
                    } else {
                        if (modelInfo.activeModel) {
                            data.activeModel = modelInfo.activeModel;
                        } else if (transcriptActiveModel) {
                            data.activeModel = transcriptActiveModel;
                        }
                        data.activeModelExpiration = modelInfo.expiration;
                        data.activeModelRemainingFraction = modelInfo.remainingFraction;
                    }
                } else {
                    if (transcriptActiveModel) {
                        data.activeModel = transcriptActiveModel;
                    }
                }
            } catch (e) {
                console.error('[Sentinel] Failed to query model info fallback:', e.message);
                if (transcriptActiveModel) {
                    data.activeModel = transcriptActiveModel;
                }
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
        const recDir = path.join(geminiBaseDir, 'antigravity-ide', 'browser_recordings', data.sessionId);
        if (fs.existsSync(recDir)) {
            const files = fs.readdirSync(recDir);
            const imageFiles = files.filter(f => f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.webp'))
                                    .sort((a, b) => b.localeCompare(a))
                                    .slice(0, 8);
            data.browserFrames = imageFiles.map(f => path.join(recDir, f));
        }

        // Scan Skills
        const skillsDir = path.join(geminiBaseDir, 'config', 'skills');
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
        const mcpPath = path.join(geminiBaseDir, 'config', 'mcp_config.json');
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
        const conversationsDir = path.join(geminiBaseDir, 'antigravity-ide', 'conversations');
        let agentapiPath = path.join(geminiBaseDir, 'antigravity-ide', 'bin', 'agentapi');
        if (process.platform === 'win32') {
            const winExe = agentapiPath + '.exe';
            const winCmd = agentapiPath + '.cmd';
            const winBat = agentapiPath + '.bat';
            if (fs.existsSync(winExe)) {
                agentapiPath = winExe;
            } else if (fs.existsSync(winCmd)) {
                agentapiPath = winCmd;
            } else if (fs.existsSync(winBat)) {
                agentapiPath = winBat;
            }
        }
        if (fs.existsSync(conversationsDir) && fs.existsSync(agentapiPath)) {
            const files = fs.readdirSync(conversationsDir);
            
            // Optimize scan: only scan DB files modified after this session started (or in the last 15 minutes)
            const currentSessionStat = fs.statSync(tPath);
            const currentSessionTime = currentSessionStat.birthtimeMs || currentSessionStat.mtimeMs || Date.now();
            const thresholdTime = currentSessionTime - 15 * 60 * 1000;

            const dbFiles = files.filter(f => {
                if (!f.endsWith('.db') || f.includes(data.sessionId)) return false;
                try {
                    const dbStat = fs.statSync(path.join(conversationsDir, f));
                    return dbStat.mtimeMs > thresholdTime;
                } catch (e) {
                    return false;
                }
            });

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
                syncOverwatchData();
            }
        }, 2000);

        // Handle messages from Webview
        webviewView.webview.onDidReceiveMessage((msg) => {
            const state = readState();
            if (msg.command === 'toggleAccept') {
                state.enabled = msg.enabled;
                writeState(state);
                syncOverwatchData();
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
                syncOverwatchData();
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
    debugLog("Extension activate() called");
    console.log('[Sentinel] Extension activated.');

    // Start LSP polling loop
    queryLsp().then(data => {
        if (data) cachedLspData = data;
    }).catch(()=>{});
    lspPollInterval = setInterval(async () => {
        try {
            const data = await queryLsp();
            if (data) {
                cachedLspData = data;
                syncOverwatchData();
            }
        } catch (e) {}
    }, 5000);

    // Status bar item setup (placed on the far left)
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100000);
    statusBarItem.command = 'antigravity-super-sentinel.openSettings';
    context.subscriptions.push(statusBarItem);
    syncOverwatchData();

    // Register Sidebar View Provider
    sidebarProvider = new SentinelViewProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'antigravity-super-sentinel-view',
            sidebarProvider
        )
    );

    // Auto-inject script on startup if not already injected and not in a remote session
    if (!vscode.env.remoteName && !isScriptInjected()) {
        console.log('[Sentinel] Script not found in workbench.html, executing auto-inject...');
        const success = injectScript(context);
        if (success) {
            clearCodeCache();
            updateChecksums();
            syncOverwatchData();
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
    setupDbWatcher();

    // Poll status every 4 seconds in the background to ensure real-time status bar updates even under WSL Remote file watcher limitations
    const bgPollInterval = setInterval(() => {
        try {
            syncOverwatchData();
        } catch (e) {}
    }, 4000);
    context.subscriptions.push({ dispose: () => clearInterval(bgPollInterval) });

    // Auto-dump configuration on startup (Experimental for debugging active model)
    setTimeout(() => {
        try {
            const config = vscode.workspace.getConfiguration('antigravity');
            const allKeys = Object.keys(config);
            let output = "=== Antigravity Workspace Config Dump ===\n";
            for (const key of allKeys) {
                output += `${key} : ${JSON.stringify(config.get(key), null, 2)}\n`;
            }
            const fs = require('fs');
            fs.writeFileSync('/tmp/antigravity_config_dump.txt', output);
            vscode.window.showInformationMessage('[Sentinel] Config dumped to /tmp! Kadzura will read it automatically.');
        } catch (e) {
            console.error(e);
        }
    }, 5000);

    // Register Enable Command
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-super-sentinel.enable', async () => {
            if (vscode.env.remoteName) {
                vscode.window.showWarningMessage('[Sentinel] Auto-clicker script injection is not supported in remote windows (WSL/SSH).');
                return;
            }
            const success = injectScript(context);
            if (success) {
                clearCodeCache();
                updateChecksums();
                syncOverwatchData();
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
            if (vscode.env.remoteName) {
                vscode.window.showWarningMessage('[Sentinel] Auto-clicker script removal is not supported in remote windows (WSL/SSH).');
                return;
            }
            const success = removeScript();
            if (success) {
                if (stateWatcher) {
                    stateWatcher.close();
                    stateWatcher = null;
                }
                clearCodeCache();
                updateChecksums();
                syncOverwatchData();
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
            syncOverwatchData();

            const message = nextEnabled ? 'Auto-Accept clicker is now ACTIVE.' : 'Auto-Accept clicker is now PAUSED.';
            vscode.window.setStatusBarMessage(`[Sentinel] ${message}`, 3000);
        })
    );

    // Register Dump Config Command (Experimental for debugging active model)
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-super-sentinel.dumpConfig', () => {
            const config = vscode.workspace.getConfiguration('antigravity');
            const allKeys = Object.keys(config);
            let output = "=== Antigravity Workspace Config Dump ===\n";
            for (const key of allKeys) {
                output += `${key} : ${JSON.stringify(config.get(key), null, 2)}\n`;
            }
            
            const quotaConfig = vscode.workspace.getConfiguration('antigravity-quota');
            output += "\n=== Antigravity Quota Config Dump ===\n";
            for (const key of Object.keys(quotaConfig)) {
                output += `${key} : ${JSON.stringify(quotaConfig.get(key), null, 2)}\n`;
            }
            
            const ext = vscode.extensions.getExtension('google.antigravity');
            output += `\ngoogle.antigravity Extension loaded: ${ext ? 'Yes' : 'No'}\n`;
            if (ext) {
                output += `isActive: ${ext.isActive}\n`;
                if (ext.exports) {
                    output += `exports keys: ${Object.keys(ext.exports).join(', ')}\n`;
                }
            }

            const channel = vscode.window.createOutputChannel('Super Sentinel Config Dump');
            channel.appendLine(output);
            channel.show();
            vscode.window.showInformationMessage('Config dumped! Check the Output panel.');
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
                syncOverwatchData();
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
    if (dbWatcher) {
        dbWatcher.close();
        dbWatcher = null;
    }
    if (transcriptWatcher) {
        transcriptWatcher.close();
        transcriptWatcher = null;
    }
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}

module.exports = { activate, deactivate };
