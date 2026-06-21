(function () {
    if (window._agSuperSentinelLoaded) return;
    window._agSuperSentinelLoaded = true;

    console.log('[Antigravity Super Sentinel] Script loaded in renderer.');

    // Clear any previous interval instances
    if (window._agSuperSentinelIntervals) {
        window._agSuperSentinelIntervals.forEach(clearInterval);
        window.removeEventListener('scroll', window._agSuperSentinelScrollListener, true);
    }
    window._agSuperSentinelIntervals = [];

    // Suppress VS Code corrupt banner
    (function suppressCorruptBanner() {
        function dismissCorrupt() {
            var banners = document.querySelectorAll('.notifications-toasts .notification-toast, .notification-list-item');
            banners.forEach(function (banner) {
                var text = banner.textContent || '';
                if (text.indexOf('corrupt') === -1 && text.indexOf('reinstall') === -1) return;

                var closeBtn = banner.querySelector('.codicon-notifications-clear, .codicon-close, .action-label[aria-label*="Close"], .action-label[aria-label*="clear"], .clear-notification-action');
                if (closeBtn) {
                    closeBtn.click();
                    console.log('[Super Sentinel] Dismissed corrupt notification');
                } else {
                    banner.style.display = 'none';
                    console.log('[Super Sentinel] Hid corrupt notification');
                }
            });
        }

        dismissCorrupt();
        var timer = setInterval(dismissCorrupt, 1000);
        window._agSuperSentinelIntervals.push(timer);

        try {
            var observer = new MutationObserver(dismissCorrupt);
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        } catch (e) { }
    })();

    // Default configuration values
    var STATE = {
        enabled: true,
        scrollEnabled: true,
        scrollPauseMs: 7000,
        clickIntervalMs: 1000,
        scrollIntervalMs: 500,
        allowMode: 'all', // 'all' or 'selective'
        selectivePermissions: {
            browser: true,
            command: true,
            files: true,
            planning: true
        },
        clickPatterns: [
            "Allow",
            "Always Allow",
            "Allow Once",
            "Allow This Con",
            "Allow in Workspace",
            "Always Allow in Workspace",
            "Always Proceed",
            "Proceed to execution",
            "Yes, approve",
            "Approve",
            "Run",
            "Always Run",
            "Submit",
            "Accept",
            "Accept all",
            "Keep Waiting",
            "Retry",
            "Yes, allow this time",
            "Yes, and always allow",
            "Yes, always run",
            "Yes, run"
        ],
        totalClicks: 0,
        clickStats: {},
        clickLog: []
    };

    var REJECT_WORDS = ['Reject', 'Deny', 'Cancel', 'Dismiss', 'Don\'t Allow', 'Decline'];
    var EDITOR_SKIP_WORDS = ['Accept Changes', 'Accept All', 'Accept Incoming', 'Accept Current', 'Accept Both', 'Accept Combination'];
    
    var WORKBENCH_DIR = /*{{WORKBENCH_DIR}}*/"";
    var _fs = null;
    var _path = null;
    var _stateFilePath = '';

    // Initialize FS access to read config updates directly from disk
    try {
        var req = (typeof require === 'function' && require) || (window && typeof window.require === 'function' && window.require);
        if (req) {
            _fs = req('fs');
            _path = req('path');
            if (WORKBENCH_DIR && _path) {
                var resolvedDir = WORKBENCH_DIR.replace(/\//g, _path.sep);
                _stateFilePath = _path.join(resolvedDir, 'ag-super-sentinel-state.json');
            }
        }
    } catch (e) { }

    function reloadLocalState() {
        if (!_fs || !_stateFilePath) return;
        try {
            if (_fs.existsSync(_stateFilePath)) {
                var raw = _fs.readFileSync(_stateFilePath, 'utf8');
                var parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    if (typeof parsed.enabled === 'boolean') STATE.enabled = parsed.enabled;
                    if (typeof parsed.scrollEnabled === 'boolean') STATE.scrollEnabled = parsed.scrollEnabled;
                    if (typeof parsed.scrollPauseMs === 'number') STATE.scrollPauseMs = parsed.scrollPauseMs;
                    if (typeof parsed.clickIntervalMs === 'number') STATE.clickIntervalMs = parsed.clickIntervalMs;
                    if (typeof parsed.scrollIntervalMs === 'number') STATE.scrollIntervalMs = parsed.scrollIntervalMs;
                    if (typeof parsed.allowMode === 'string') STATE.allowMode = parsed.allowMode;
                    if (parsed.selectivePermissions && typeof parsed.selectivePermissions === 'object') {
                        STATE.selectivePermissions = parsed.selectivePermissions;
                    }
                    if (Array.isArray(parsed.clickPatterns)) STATE.clickPatterns = parsed.clickPatterns;
                    if (typeof parsed.totalClicks === 'number') STATE.totalClicks = parsed.totalClicks;
                    if (parsed.clickStats && typeof parsed.clickStats === 'object') STATE.clickStats = parsed.clickStats;
                    if (Array.isArray(parsed.clickLog)) STATE.clickLog = parsed.clickLog;
                }
            } else {
                // Initialize state file if it doesn't exist
                _fs.writeFileSync(_stateFilePath, JSON.stringify(STATE, null, 4), 'utf8');
            }
        } catch (e) { }
    }

    function saveLocalState() {
        if (!_fs || !_stateFilePath) return;
        try {
            _fs.writeFileSync(_stateFilePath, JSON.stringify(STATE, null, 4), 'utf8');
        } catch (e) { }
    }

    // Check config changes every 2 seconds
    var stateTimer = setInterval(reloadLocalState, 2000);
    window._agSuperSentinelIntervals.push(stateTimer);
    reloadLocalState();

    // Smart Auto Scroll
    var _manualPauseUntil = 0;
    var _isAutoScrolling = false;
    var _lastContentChange = 0;
    var _contentActiveUntil = 0;
    var _observedChatPanel = null;
    var _scrollObserver = null;

    function getChatPanel() {
        return document.querySelector('.antigravity-agent-side-panel');
    }

    function isInsideChatPanel(node) {
        var el = node && node.nodeType === 3 ? node.parentElement : node;
        return !!(el && el.closest && el.closest('.antigravity-agent-side-panel'));
    }

    function isInputArea(node) {
        var el = node && node.nodeType === 3 ? node.parentElement : node;
        return !!(el && (
            el.tagName === 'TEXTAREA' ||
            el.tagName === 'INPUT' ||
            el.isContentEditable ||
            (el.closest && (
                el.closest('textarea') ||
                el.closest('[contenteditable="true"]') ||
                el.closest('[contenteditable="plaintext-only"]') ||
                el.closest('.chat-input') ||
                el.closest('.interactive-input-part') ||
                el.closest('.interactive-input') ||
                el.closest('.monaco-inputbox') ||
                el.closest('.input-editor')
            ))
        ));
    }

    function markContentActivity() {
        var now = Date.now();
        _lastContentChange = now;
        _contentActiveUntil = now + Math.max(2500, Math.round(STATE.scrollPauseMs * 0.6));
    }

    function ensureScrollObserver() {
        var chatPanel = getChatPanel();
        if (!chatPanel) return false;
        if (_observedChatPanel === chatPanel && _scrollObserver) return true;

        if (_scrollObserver) {
            try { _scrollObserver.disconnect(); } catch (e) { }
        }

        _observedChatPanel = chatPanel;
        _scrollObserver = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var target = mutations[i].target;
                var el = target && target.nodeType === 3 ? target.parentElement : target;
                if (el && isInsideChatPanel(el) && !isInputArea(el)) {
                    markContentActivity();
                    return;
                }
            }
        });

        _scrollObserver.observe(chatPanel, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'aria-expanded', 'aria-busy', 'open', 'data-state']
        });

        markContentActivity();
        return true;
    }

    function getElementDepth(el) {
        var depth = 0;
        while (el && el.parentElement) {
            depth++;
            el = el.parentElement;
        }
        return depth;
    }

    function collectScrollTargets(chatPanel) {
        var nodes = [chatPanel].concat(Array.from(chatPanel.querySelectorAll('*')));
        return nodes.filter(function (el) {
            if (!el || el.nodeType !== 1) return false;
            if (!el.closest || !el.closest('.antigravity-agent-side-panel')) return false;
            if (el.closest('.monaco-editor') || el.closest('.part.editor')) return false;
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return false;

            var style = window.getComputedStyle(el);
            var overflowY = style.overflowY;
            var hasScrollbar = el.scrollHeight > (el.clientHeight + 4);
            if (!hasScrollbar) return false;

            return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
        }).sort(function (a, b) {
            return getElementDepth(b) - getElementDepth(a);
        });
    }

    function scrollElementToBottom(el) {
        var maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
        var gap = maxScrollTop - el.scrollTop;
        if (gap <= 2) return false;

        try {
            el.scrollTo({ top: maxScrollTop, behavior: 'auto' });
        } catch (e) {
            el.scrollTop = maxScrollTop;
        }
        return true;
    }

    // Dynamic button scanner to scroll viewport
    function findJumpToBottomButton(chatPanel) {
        if (!chatPanel) return null;
        var panelRect = chatPanel.getBoundingClientRect();
        if (!panelRect || panelRect.width <= 0 || panelRect.height <= 0) return null;

        var candidates = Array.from(chatPanel.querySelectorAll('button, [role="button"]'));
        var best = null;
        var bestScore = -Infinity;

        candidates.forEach(function (btn) {
            if (!btn || btn.offsetParent === null) return;
            if (isInputArea(btn)) return;
            if (btn.closest && (btn.closest('.monaco-editor') || btn.closest('.part.editor'))) return;

            var rect = btn.getBoundingClientRect();
            if (!rect || rect.width < 16 || rect.height < 16 || rect.width > 72 || rect.height > 72) return;

            var gapRight = panelRect.right - rect.right;
            var gapBottom = panelRect.bottom - rect.bottom;
            if (gapRight < -4 || gapBottom < -4) return;
            if (gapRight > 120 || gapBottom > 160) return;

            var rawText = ((btn.innerText || btn.textContent || '') + ' ' + (btn.getAttribute('aria-label') || '') + ' ' + (btn.getAttribute('title') || '')).trim();
            var lower = rawText.toLowerCase();
            var hasSvg = !!btn.querySelector('svg, path, [data-icon], .codicon');

            var isDownSemantic = lower === '↓' || lower === '▼' || lower === '⌄' || /scroll|bottom|latest|new|down|jump/.test(lower);
            var isIconOnly = rawText.length === 0 && hasSvg;
            if (!isDownSemantic && !isIconOnly) return;

            var score = Math.max(0, 160 - gapRight) + Math.max(0, 180 - gapBottom) + (isIconOnly ? 35 : 0) + (isDownSemantic ? 55 : 0);
            if (score > bestScore) {
                bestScore = score;
                best = btn;
            }
        });
        return best;
    }

    function runAutoScrollTick() {
        ensureScrollObserver();

        if (!STATE.enabled || !STATE.scrollEnabled) return;
        var now = Date.now();
        if (now < _manualPauseUntil) return;
        if (_lastContentChange === 0 || now > _contentActiveUntil) return;

        var chatPanel = _observedChatPanel || getChatPanel();
        if (!chatPanel) return;

        var scrollables = collectScrollTargets(chatPanel);
        if (scrollables.length === 0) return;

        _isAutoScrolling = true;
        try {
            var jumpBtn = findJumpToBottomButton(chatPanel);
            if (jumpBtn) {
                try {
                    jumpBtn.click();
                } catch (e) {}
            }
            scrollables.forEach(function (el) {
                scrollElementToBottom(el);
            });
        } finally {
            setTimeout(function () { _isAutoScrolling = false; }, 100);
        }
    }

    // Set up auto scroll loop
    var scrollInterval = setInterval(runAutoScrollTick, STATE.scrollIntervalMs);
    window._agSuperSentinelIntervals.push(scrollInterval);

    // Watchdog to ensure scroll observer is always attached
    var observerWatchdog = setInterval(ensureScrollObserver, 1500);
    window._agSuperSentinelIntervals.push(observerWatchdog);

    window._agSuperSentinelScrollListener = function (e) {
        if (!e.isTrusted) return;
        if (_isAutoScrolling) return;
        if (!isInsideChatPanel(e.target)) return;

        _manualPauseUntil = Date.now() + STATE.scrollPauseMs;
    };
    window.addEventListener('scroll', window._agSuperSentinelScrollListener, true);


    // Smart Auto Clicker
    function normalizeButtonText(rawText) {
        return rawText.replace(/(?:Alt|Ctrl|Shift|Cmd|⌘|⌥|⇧)\+.*/i, '').replace(/\s+/g, ' ').trim();
    }

    function isInsideAgentPanel(el) {
        if (!el || !el.closest) return false;
        return !!(el.closest('.antigravity-agent-side-panel') ||
            el.closest('[class*="agent"]') ||
            el.closest('[class*="chat-widget"]') ||
            el.closest('[class*="interactive-session"]') ||
            el.closest('.chat-input-toolbars') ||
            el.closest('[class*="tool-confirmation"]') ||
            el.closest('[class*="confirmation-widget"]') ||
            el.closest('[class*="terminal-command"]') ||
            el.closest('[class*="tool-invocation"]') ||
            el.closest('[class*="tool-call"]') ||
            el.closest('[class*="approval"]') ||
            el.closest('[class*="permission"]') ||
            el.closest('[class*="confirm"]') ||
            el.closest('[class*="chat-panel"]') ||
            el.closest('[class*="chat-response"]') ||
            el.closest('[class*="chat-message"]') ||
            el.closest('[class*="step-widget"]'));
    }

    function hasDenySibling(btn) {
        var parent = btn.parentElement;
        for (var level = 0; level < 8; level++) {
            if (!parent) break;
            var siblingBtns = parent.querySelectorAll('button, a.action-label, [role="button"], .monaco-button, span.bg-ide-button-background');
            for (var i = 0; i < siblingBtns.length; i++) {
                var sibling = siblingBtns[i];
                if (sibling === btn) continue;
                var siblingRaw = (sibling.innerText || sibling.textContent || sibling.getAttribute && (sibling.getAttribute('aria-label') || sibling.getAttribute('title')) || '').trim();
                var siblingText = normalizeButtonText(siblingRaw);
                for (var j = 0; j < REJECT_WORDS.length; j++) {
                    if (siblingText === REJECT_WORDS[j] || siblingText.indexOf(REJECT_WORDS[j]) === 0) {
                        return true;
                    }
                }
            }
            parent = parent.parentElement;
        }
        return false;
    }

    // Classify permission prompt type based on surrounding text context
    function classifyPromptContext(btn) {
        var parent = btn.parentElement;
        var textAccumulator = "";
        for (var level = 0; level < 8; level++) {
            if (!parent) break;
            var text = (parent.innerText || parent.textContent || '').replace(/\s+/g, ' ').trim();
            textAccumulator += " " + text;
            parent = parent.parentElement;
        }
        var lower = textAccumulator.toLowerCase();
        
        if (/javascript|js\s+execution|execute\s+javascript|browser/i.test(lower)) {
            return 'browser';
        }
        if (/command|terminal|shell|script|process|execute\s+command/i.test(lower)) {
            return 'command';
        }
        if (/file|folder|directory|read|write|workspace|xwr/i.test(lower)) {
            return 'files';
        }
        if (/planning|review|artifact|policy|always\s+ask|lint/i.test(lower)) {
            return 'planning';
        }
        return 'other';
    }

    var _clicked = new Map();
    var clickLogGc = setInterval(function () {
        var now = Date.now();
        var expired = [];
        _clicked.forEach(function (ts, el) {
            if (now - ts > 30000) expired.push(el);
        });
        expired.forEach(function (el) { _clicked.delete(el); });
    }, 15000);
    window._agSuperSentinelIntervals.push(clickLogGc);

    function runAutoClickTick() {
        if (!STATE.enabled) return;

        var clickables = Array.from(document.querySelectorAll('button, a.action-label, [role="button"], .monaco-button, span.bg-ide-button-background, [class*="ide-button"]'));
        document.querySelectorAll('span.cursor-pointer').forEach(function (span) { clickables.push(span); });

        for (var i = 0; i < clickables.length; i++) {
            var btn = clickables[i];
            if (btn.offsetParent === null) continue; // Skip hidden elements

            var clickedAt = _clicked.get(btn);
            if (clickedAt && (Date.now() - clickedAt) < 30000) continue; // Prevent double-clicking

            var rawText = (btn.innerText || btn.textContent || btn.getAttribute && (btn.getAttribute('aria-label') || btn.getAttribute('title')) || '').trim();
            if (!rawText || rawText.length > 120) continue;

            // Prevent clicking VS Code activity bar buttons (like "Run and Debug")
            if (/^Run\s+and\s+Debug\b/i.test(rawText)) continue;
            if (btn.closest && (
                btn.closest('.activitybar') ||
                btn.closest('.part.activitybar') ||
                btn.closest('[id*="workbench.parts.activitybar"]') ||
                btn.closest('.composite-bar') ||
                btn.closest('.pane-composite-part') ||
                btn.closest('[aria-label="Activity Bar"]')
            )) continue;

            var text = normalizeButtonText(rawText);
            if (!text) continue;

            // Match configuration patterns
            var matchesPattern = false;
            var matchedPattern = '';
            for (var p = 0; p < STATE.clickPatterns.length; p++) {
                var pattern = STATE.clickPatterns[p];
                if (text === pattern || text.indexOf(pattern) === 0 || rawText === pattern || rawText.indexOf(pattern) === 0) {
                    matchesPattern = true;
                    matchedPattern = pattern;
                    break;
                }
            }
            if (!matchesPattern) continue;

            // Editor safety guard
            var skipEditor = false;
            for (var se = 0; se < EDITOR_SKIP_WORDS.length; se++) {
                if (text.indexOf(EDITOR_SKIP_WORDS[se]) === 0) {
                    skipEditor = true;
                    break;
                }
            }
            if (skipEditor) continue;

            // Skip code editor areas, diffs, statusbar
            if (btn.closest && (
                btn.closest('.monaco-diff-editor') ||
                btn.closest('.merge-editor-view') ||
                btn.closest('.inline-merge-region') ||
                btn.closest('.merged-editor') ||
                btn.closest('.view-zones') ||
                btn.closest('.view-lines') ||
                btn.closest('.statusbar') ||
                btn.closest('.part.statusbar') ||
                btn.closest('[id*="workbench.parts.statusbar"]')
            )) continue;

            // Only allow clicking if inside Agent panel or has a nearby Deny sibling
            var isApproval = isInsideAgentPanel(btn) || hasDenySibling(btn);
            if (!isApproval) continue;

            // SELECTIVE SECURITY MODE FILTER
            if (STATE.allowMode === 'selective') {
                var category = classifyPromptContext(btn);
                if (category !== 'other' && STATE.selectivePermissions && STATE.selectivePermissions[category] === false) {
                    // Selective mode active, and this specific category is UNCHECKED (blocked)
                    continue;
                }
                if (category === 'other') {
                    // Unclassified security prompt - skip to be safe in selective mode
                    continue;
                }
            }

            // Click!
            console.log('[Super Sentinel] Auto Clicking: [' + rawText + ']');
            _clicked.set(btn, Date.now());
            try {
                btn.click();

                // Reload latest local state to avoid writing stale info
                reloadLocalState();

                // Log click stats & click log
                STATE.totalClicks = (STATE.totalClicks || 0) + 1;
                if (!STATE.clickStats) STATE.clickStats = {};
                STATE.clickStats[matchedPattern] = (STATE.clickStats[matchedPattern] || 0) + 1;

                var d = new Date();
                var pad = function (n) { return n < 10 ? '0' + n : n };
                var timeStr = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
                
                if (!STATE.clickLog) STATE.clickLog = [];
                STATE.clickLog.unshift({
                    time: timeStr,
                    button: rawText.substring(0, 40),
                    pattern: matchedPattern
                });
                if (STATE.clickLog.length > 100) STATE.clickLog.pop();

                saveLocalState();
            } catch (e) {
                console.error('[Super Sentinel] Click failed:', e);
            }
            break; // Click one button at a time per tick
        }
    }

    var clickInterval = setInterval(runAutoClickTick, STATE.clickIntervalMs);
    window._agSuperSentinelIntervals.push(clickInterval);

    console.log('[Antigravity Super Sentinel] smart scroll & auto-click loops started.');
})();
