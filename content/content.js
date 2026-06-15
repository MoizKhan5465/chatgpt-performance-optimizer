/**
 * ChatGPT Performance Optimizer v3.0 — ChatGPT-Only Edition
 *
 * Key fixes over v2.3:
 *  - Removed innerHTML virtualization (breaks React's virtual DOM reconciler)
 *  - Uses CSS visibility/height tricks instead (React-safe)
 *  - MutationObserver no longer runs expensive DOM queries per mutation
 *  - deduplicateGreetings() removed from hot path
 *  - All DOM work is idle-scheduled or debounced at ≥300ms
 *  - No more querySelectorAll inside observer callbacks
 *  - Streaming detection only triggers re-collapse, not on every token
 *  - Single selector for ChatGPT (no multi-platform overhead)
 */

(function () {
  'use strict';

  /* =========================================================================
     CONFIGURATION
     ========================================================================= */
  const DEBUG = false; // Set true for verbose logs

  // ChatGPT-only message selectors (ordered by specificity/reliability)
  const MSG_SELECTOR = [
    'article[data-testid^="conversation-turn"]',
    'div[data-message-id]',
    '[data-testid*="conversation-turn"]',
  ];

  // Scroll container selector for ChatGPT
  const SCROLL_ROOT_SELECTOR = [
    'main [class*="react-scroll-to-bottom"]',
    'main div[role="presentation"]',
    'main',
  ];

  /* =========================================================================
     STATE
     ========================================================================= */
  const STATE = {
    enabled: false,
    visibleCount: 15,        // Keep last N messages rendered
    threshold: 20,           // Auto-trigger when message count exceeds this
    showFloatingBtn: true,
    autoDetect: true,
    cssContainment: true,
    killAnimations: true,
    messageCollapsing: true,
    streamingThrottle: true,

    // Stats
    totalMessages: 0,
    hiddenMessages: 0,
    domNodesBefore: 0,
  };

  let contextValid = true;
  let isOptimizing = false;

  // Observer / timer references
  let mutationObserver = null;
  let navObserver = null;
  let debounceTimer = null;
  let healthTimer = null;
  let liveStatsInterval = null;

  // Streaming state
  let isStreaming = false;
  let streamingCheckTimer = null;

  // Hidden message tracking (CSS-based, React-safe)
  // We store the set of elements we've hidden
  const hiddenMessages = new Set();

  // Message cache
  let _msgCache = null;
  let _msgCacheTime = 0;
  const MSG_CACHE_TTL = 400; // ms

  // DOM node count cache
  let _nodeCountCache = 0;
  let _nodeCountTime = 0;
  const NODE_CACHE_TTL = 4000; // ms

  // Broadcast debounce
  let _broadcastTimer = null;

  // Navigation
  let lastUrl = location.href;

  /* =========================================================================
     LOGGING
     ========================================================================= */
  function log(...a) {
    if (DEBUG) console.log('%c[CPO]', 'color:#7C3AED;font-weight:bold;', ...a);
  }

  /* =========================================================================
     CHROME API SAFETY WRAPPER
     ========================================================================= */
  function safeCall(fn) {
    if (!contextValid) return;
    try {
      fn();
    } catch (e) {
      if (e.message?.includes('Extension context invalidated')) {
        contextValid = false;
        teardown();
      }
    }
  }

  /* =========================================================================
     DOM HELPERS
     ========================================================================= */

  /** Returns the main chat scroll container */
  function getScrollRoot() {
    for (const sel of SCROLL_ROOT_SELECTOR) {
      const el = document.querySelector(sel);
      if (el && el !== document.body) return el;
    }
    return null;
  }

  /**
   * Returns all conversation-turn elements.
   * Uses a 400ms cache to avoid repeated querySelectorAll during streaming.
   */
  function getMessages(forceRefresh) {
    const now = performance.now();
    if (!forceRefresh && _msgCache && (now - _msgCacheTime) < MSG_CACHE_TTL) {
      return _msgCache;
    }
    const root = getScrollRoot();
    if (!root) {
      _msgCache = [];
      _msgCacheTime = now;
      return [];
    }
    for (const sel of MSG_SELECTOR) {
      try {
        const nodes = root.querySelectorAll(sel);
        if (nodes.length > 0) {
          _msgCache = Array.from(nodes);
          _msgCacheTime = now;
          return _msgCache;
        }
      } catch (_) {}
    }
    _msgCache = [];
    _msgCacheTime = now;
    return [];
  }

  /** Counts DOM nodes inside scroll root (cached) */
  function countNodes() {
    const now = performance.now();
    if ((now - _nodeCountTime) < NODE_CACHE_TTL && _nodeCountCache > 0) {
      return _nodeCountCache;
    }
    const root = getScrollRoot();
    if (!root) return 0;
    _nodeCountCache = root.querySelectorAll('*').length;
    _nodeCountTime = now;
    return _nodeCountCache;
  }

  /** Invalidate caches (called on navigation / major DOM changes) */
  function invalidateCaches() {
    _msgCache = null;
    _msgCacheTime = 0;
    _nodeCountCache = 0;
    _nodeCountTime = 0;
  }

  /* =========================================================================
     L1 — MESSAGE COLLAPSING (CSS-Based, React-Safe)
     
     Instead of innerHTML = '' (which destroys React's reconciler state),
     we use CSS to make off-screen messages invisible while preserving their
     DOM structure. React continues to manage them normally.
     ========================================================================= */

  /** Injects the CPO hide class style once */
  let _collapseStyleEl = null;
  function ensureCollapseStyle() {
    if (_collapseStyleEl) return;
    _collapseStyleEl = document.createElement('style');
    _collapseStyleEl.id = 'cpo-collapse-style';
    _collapseStyleEl.textContent = `
      /* CPO: React-safe message hiding — preserves DOM, hides rendering */
      .cpo-msg-hidden {
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        user-select: none !important;
        overflow: hidden !important;
      }
    `;
    document.head.appendChild(_collapseStyleEl);
  }

  function removeCollapseStyle() {
    if (_collapseStyleEl) {
      _collapseStyleEl.remove();
      _collapseStyleEl = null;
    }
  }

  /** Hide a message element (React-safe CSS approach) */
  function hideMessage(el) {
    if (hiddenMessages.has(el)) return;
    // Capture current computed height so layout doesn't collapse
    const h = el.getBoundingClientRect().height;
    if (h === 0) return; // Don't hide already-collapsed elements
    el.dataset.cpoHeight = h;
    el.style.height = h + 'px';
    el.style.minHeight = h + 'px';
    el.classList.add('cpo-msg-hidden');
    hiddenMessages.add(el);
  }

  /** Restore a previously hidden message */
  function showMessage(el) {
    if (!hiddenMessages.has(el)) return;
    el.classList.remove('cpo-msg-hidden');
    el.style.height = '';
    el.style.minHeight = '';
    delete el.dataset.cpoHeight;
    hiddenMessages.delete(el);
  }

  /** Restore ALL hidden messages */
  function showAllMessages() {
    hiddenMessages.forEach(el => showMessage(el));
    hiddenMessages.clear();
    STATE.hiddenMessages = 0;
    updateExpandButton(false);
  }

  /**
   * Core collapse logic: hide old messages, keep latest STATE.visibleCount visible.
   * This is the ONLY place we touch message visibility — never inside observer callbacks.
   */
  function collapseMessages() {
    if (!STATE.enabled || !STATE.messageCollapsing || isOptimizing) return;

    ensureCollapseStyle();
    const messages = getMessages(true); // Force-refresh only here, not in observer
    STATE.totalMessages = messages.length;

    const total = messages.length;
    const cutoff = total - STATE.visibleCount;

    if (cutoff <= 0) {
      // Not enough messages to hide — restore any previously hidden ones
      if (hiddenMessages.size > 0) showAllMessages();
      STATE.hiddenMessages = 0;
      updateExpandButton(false);
      return;
    }

    let newlyHidden = 0;

    messages.forEach((el, i) => {
      if (i < cutoff) {
        // Should be hidden
        if (!hiddenMessages.has(el)) {
          hideMessage(el);
          newlyHidden++;
        }
      } else {
        // Should be visible (latest N messages)
        if (hiddenMessages.has(el)) {
          showMessage(el);
        }
      }
    });

    STATE.hiddenMessages = hiddenMessages.size;
    log(`Collapse: ${hiddenMessages.size} hidden, ${total - hiddenMessages.size} visible`);
    updateExpandButton(hiddenMessages.size > 0);
    debouncedBroadcast();
  }

  /* =========================================================================
     L2 — CSS CONTAINMENT
     ========================================================================= */
  let _containmentStyle = null;

  function applyCSSContainment() {
    if (_containmentStyle || !STATE.cssContainment) return;
    _containmentStyle = document.createElement('style');
    _containmentStyle.id = 'cpo-containment';
    // Use layout containment only — skip content-visibility:auto which fights ChatGPT's scroll
    _containmentStyle.textContent = `
      /* CPO L2: Containment — isolate layout/paint per message */
      article[data-testid^="conversation-turn"],
      div[data-message-id] {
        contain: layout;
      }
    `;
    document.head.appendChild(_containmentStyle);
  }

  function removeCSSContainment() {
    if (_containmentStyle) {
      _containmentStyle.remove();
      _containmentStyle = null;
    }
  }

  /* =========================================================================
     L3 — ANIMATION KILLER
     ========================================================================= */
  let _animStyle = null;

  function killAnimations() {
    if (_animStyle || !STATE.killAnimations) return;
    _animStyle = document.createElement('style');
    _animStyle.id = 'cpo-anim-killer';
    _animStyle.textContent = `
      /* CPO L3: Stop CSS animations and transitions in chat area */
      main article *,
      main div[data-message-id] * {
        animation-duration: 0.001ms !important;
        animation-delay: 0ms !important;
        transition-duration: 0.001ms !important;
        transition-delay: 0ms !important;
      }
      /* But keep CPO UI animations */
      [id^="cpo-"] * {
        animation-duration: revert !important;
        transition-duration: revert !important;
      }
    `;
    document.head.appendChild(_animStyle);
  }

  function restoreAnimations() {
    if (_animStyle) {
      _animStyle.remove();
      _animStyle = null;
    }
  }

  /* =========================================================================
     STREAMING DETECTION
     ========================================================================= */

  /**
   * Detects if ChatGPT is currently streaming a response.
   * Only called periodically, NOT inside mutation callbacks.
   */
  function checkStreaming() {
    try {
      const wasStreaming = isStreaming;
      isStreaming = !!(
        document.querySelector('button[aria-label="Stop generating"]') ||
        document.querySelector('button[data-testid="stop-button"]') ||
        document.querySelector('.result-streaming') ||
        document.querySelector('[data-testid="stop-button"]')
      );
      
      // When streaming STOPS, do a collapse pass to catch the final message
      if (wasStreaming && !isStreaming && STATE.enabled && STATE.messageCollapsing) {
        scheduleIdleWork(() => collapseMessages());
      }
    } catch (_) {}
  }

  /* =========================================================================
     IDLE SCHEDULER
     ========================================================================= */
  function scheduleIdleWork(fn) {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(fn, { timeout: 2000 });
    } else {
      setTimeout(fn, 100);
    }
  }

  /* =========================================================================
     MUTATION OBSERVER
     
     KEY FIX: The observer callback does NOTHING expensive.
     It only sets a debounce timer. All real work happens after 300ms idle.
     ========================================================================= */

  function startObserver() {
    if (mutationObserver) {
      mutationObserver.disconnect();
    }

    // Observe document.body so we never miss content, but do zero work in callback
    mutationObserver = new MutationObserver((mutations) => {
      if (isOptimizing) return;

      // Quick check: did any real nodes change?
      let hasContent = false;
      for (let i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length > 0 || mutations[i].removedNodes.length > 0) {
          hasContent = true;
          break;
        }
      }
      if (!hasContent) return;

      // Debounce: wait 300ms (or 1000ms during streaming) before doing any work
      const delay = isStreaming ? 1000 : 300;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(onDomSettled, delay);
    });

    const target = document.querySelector('main') || document.body;
    mutationObserver.observe(target, { childList: true, subtree: true });
    log('Observer started on:', target.tagName);
  }

  /**
   * Called 300ms after DOM mutations settle.
   * This is where all actual work happens — NOT in the observer callback.
   */
  function onDomSettled() {
    if (!contextValid) return;

    // Invalidate caches since DOM changed
    invalidateCaches();

    // Auto-detect trigger
    if (STATE.autoDetect && !STATE.enabled) {
      const msgCount = getMessages().length;
      if (msgCount >= STATE.threshold) {
        log(`Auto-trigger: ${msgCount} messages >= threshold ${STATE.threshold}`);
        togglePerformanceMode(true);
        return; // togglePerformanceMode calls collapseMessages already
      }
    }

    // If enabled, run collapse
    if (STATE.enabled && STATE.messageCollapsing && !isStreaming) {
      collapseMessages();
    }

    debouncedBroadcast();
  }

  /* =========================================================================
     NAVIGATION WATCHER
     ========================================================================= */
  function watchNavigation() {
    if (navObserver) navObserver.disconnect();

    navObserver = new MutationObserver(() => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      log('Navigation detected, resetting...');

      // Reset state for new conversation
      hiddenMessages.clear();
      STATE.hiddenMessages = 0;
      invalidateCaches();

      setTimeout(() => {
        startObserver();
        if (STATE.enabled) {
          scheduleIdleWork(() => collapseMessages());
        }
        debouncedBroadcast();
      }, 800);
    });

    const title = document.querySelector('title');
    if (title) {
      navObserver.observe(title, { childList: true });
    } else {
      const headObs = new MutationObserver(() => {
        const t = document.querySelector('title');
        if (t) {
          navObserver.observe(t, { childList: true });
          headObs.disconnect();
        }
      });
      headObs.observe(document.head || document.documentElement, { childList: true, subtree: false });
    }
  }

  /* =========================================================================
     UI — EXPAND BUTTON
     ========================================================================= */
  function updateExpandButton(show) {
    let btn = document.getElementById('cpo-expand-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'cpo-expand-btn';
      btn.addEventListener('click', () => {
        showAllMessages();
        btn.classList.remove('cpo-show');
        log('User expanded all hidden messages');
      });
      const root = getScrollRoot() || document.querySelector('main');
      if (root) root.prepend(btn);
    }
    const count = hiddenMessages.size;
    if (show && count > 0) {
      btn.textContent = `⬆ Show ${count} hidden message${count !== 1 ? 's' : ''}`;
      btn.classList.add('cpo-show');
    } else {
      btn.classList.remove('cpo-show');
    }
  }

  /* =========================================================================
     UI — TOGGLE BUTTON (Floating)
     ========================================================================= */
  function createToggleButton() {
    if (document.getElementById('cpo-toggle-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'cpo-toggle-btn';
    btn.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
      </svg>
      <span class="cpo-tooltip">Performance Mode (Ctrl+Shift+P)</span>
    `;
    btn.className = STATE.enabled ? 'cpo-active' : 'cpo-inactive';
    btn.addEventListener('click', () => togglePerformanceMode());
    document.body.appendChild(btn);
  }

  function updateToggleButton() {
    const btn = document.getElementById('cpo-toggle-btn');
    if (!btn) return;
    btn.className = STATE.enabled ? 'cpo-active' : 'cpo-inactive';
    btn.style.display = STATE.showFloatingBtn ? 'flex' : 'none';
  }

  /* =========================================================================
     UI — STATUS BADGE
     ========================================================================= */
  function createStatusBadge() {
    if (document.getElementById('cpo-status-badge')) return;
    const badge = document.createElement('div');
    badge.id = 'cpo-status-badge';
    badge.title = 'Click to toggle CPO Control Panel';
    badge.innerHTML = `<span class="cpo-badge-dot"></span><span class="cpo-badge-text"></span>`;
    badge.addEventListener('click', () => {
      const panel = document.getElementById('cpo-stats-panel');
      if (!panel) return;
      panel.classList.toggle('cpo-visible');
    });
    document.body.appendChild(badge);
  }

  function updateStatusBadge() {
    const badge = document.getElementById('cpo-status-badge');
    if (!badge) return;
    const text = badge.querySelector('.cpo-badge-text');
    if (STATE.enabled) {
      badge.className = 'cpo-badge-active cpo-visible';
      const parts = [];
      if (STATE.hiddenMessages > 0) parts.push(`${STATE.hiddenMessages} msgs hidden`);
      if (STATE.messageCollapsing && STATE.enabled) parts.push('active');
      text.textContent = parts.length ? `⚡ ${parts.join(' · ')}` : `⚡ Engine On`;
    } else {
      badge.className = 'cpo-badge-inactive';
      badge.classList.remove('cpo-visible');
      if (text) text.textContent = '';
    }
  }

  /* =========================================================================
     UI — STATS PANEL
     ========================================================================= */
  let isPanelMinimized = false;

  function createStatsPanel() {
    if (document.getElementById('cpo-stats-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'cpo-stats-panel';
    panel.innerHTML = `
      <div class="cpo-panel-header" id="cpo-panel-drag-handle">
        <span class="cpo-panel-title">⚡ CPO Control Panel</span>
        <div class="cpo-panel-actions">
          <button id="cpo-btn-minimize" title="Minimize">─</button>
          <button id="cpo-btn-close" title="Close">×</button>
        </div>
      </div>
      <div class="cpo-panel-content">
        <div class="cpo-stat-row"><span class="cpo-stat-label">Total Messages</span><span class="cpo-stat-value" id="cpo-sp-total">0</span></div>
        <div class="cpo-stat-row"><span class="cpo-stat-label">Hidden</span><span class="cpo-stat-value cpo-highlight" id="cpo-sp-hidden">0</span></div>
        <div class="cpo-stat-divider"></div>
        <div class="cpo-stat-row"><span class="cpo-stat-label">Opacity</span>
          <input type="range" id="cpo-opacity-slider" min="0.2" max="1.0" step="0.05" value="0.85">
          <span class="cpo-stat-value" id="cpo-opacity-val">85%</span>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    const fab = document.createElement('div');
    fab.id = 'cpo-minimized-fab';
    fab.title = 'Expand CPO Panel';
    fab.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>`;
    document.body.appendChild(fab);

    safeCall(() => {
      chrome.storage.local.get(['cpo_panel_pos', 'cpo_panel_opacity', 'cpo_panel_minimized'], (data) => {
        if (data.cpo_panel_pos) {
          panel.style.top = data.cpo_panel_pos.top;
          panel.style.left = data.cpo_panel_pos.left;
          panel.style.right = 'auto';
          panel.style.bottom = 'auto';
          fab.style.top = data.cpo_panel_pos.top;
          fab.style.left = data.cpo_panel_pos.left;
          fab.style.right = 'auto';
          fab.style.bottom = 'auto';
        }
        const opacity = data.cpo_panel_opacity || 0.85;
        panel.style.setProperty('--cpo-opacity', opacity);
        const slider = document.getElementById('cpo-opacity-slider');
        const valEl = document.getElementById('cpo-opacity-val');
        if (slider) slider.value = opacity;
        if (valEl) valEl.textContent = Math.round(opacity * 100) + '%';
        isPanelMinimized = !!data.cpo_panel_minimized;
      });
    });

    document.getElementById('cpo-btn-minimize').addEventListener('click', () => minimizePanel(true));
    document.getElementById('cpo-btn-close').addEventListener('click', () => panel.classList.remove('cpo-visible'));

    fab.addEventListener('click', () => {
      if (fab.dataset.dragged === 'true') { fab.dataset.dragged = 'false'; return; }
      minimizePanel(false);
    });

    const slider = document.getElementById('cpo-opacity-slider');
    if (slider) {
      slider.addEventListener('input', (e) => {
        const v = e.target.value;
        panel.style.setProperty('--cpo-opacity', v);
        document.getElementById('cpo-opacity-val').textContent = Math.round(v * 100) + '%';
        safeCall(() => chrome.storage.local.set({ cpo_panel_opacity: v }));
      });
    }

    makeDraggable(panel, document.getElementById('cpo-panel-drag-handle'), [fab]);
    makeDraggable(fab, fab, [panel]);
  }

  function minimizePanel(minimize) {
    const panel = document.getElementById('cpo-stats-panel');
    const fab = document.getElementById('cpo-minimized-fab');
    if (!panel || !fab) return;
    isPanelMinimized = minimize;
    safeCall(() => chrome.storage.local.set({ cpo_panel_minimized: minimize }));
    if (minimize) {
      panel.classList.remove('cpo-visible');
      fab.classList.add('cpo-show');
    } else {
      fab.classList.remove('cpo-show');
      panel.classList.add('cpo-visible');
    }
  }

  function makeDraggable(el, handle, synced = []) {
    let p1 = 0, p2 = 0, p3 = 0, p4 = 0, dragging = false;
    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.closest('button')) return;
      e.preventDefault();
      dragging = false;
      el.dataset.dragged = 'false';
      p3 = e.clientX; p4 = e.clientY;
      document.addEventListener('mouseup', up);
      document.addEventListener('mousemove', move);
    });
    function move(e) {
      e.preventDefault();
      dragging = true;
      el.dataset.dragged = 'true';
      p1 = p3 - e.clientX; p2 = p4 - e.clientY;
      p3 = e.clientX; p4 = e.clientY;
      const t = Math.max(10, Math.min(el.offsetTop - p2, window.innerHeight - el.offsetHeight - 10)) + 'px';
      const l = Math.max(10, Math.min(el.offsetLeft - p1, window.innerWidth - el.offsetWidth - 10)) + 'px';
      el.style.top = t; el.style.left = l; el.style.right = 'auto'; el.style.bottom = 'auto';
      synced.forEach(s => { s.style.top = t; s.style.left = l; s.style.right = 'auto'; s.style.bottom = 'auto'; });
    }
    function up() {
      document.removeEventListener('mouseup', up);
      document.removeEventListener('mousemove', move);
      if (dragging) {
        safeCall(() => chrome.storage.local.set({ cpo_panel_pos: { top: el.style.top, left: el.style.left } }));
      }
    }
  }

  function updateStatsPanel() {
    const totalEl = document.getElementById('cpo-sp-total');
    const hiddenEl = document.getElementById('cpo-sp-hidden');
    if (totalEl) totalEl.textContent = STATE.totalMessages;
    if (hiddenEl) hiddenEl.textContent = STATE.hiddenMessages;
  }

  /* =========================================================================
     CORE ENGINE ORCHESTRATION
     ========================================================================= */

  function applyOptimizations() {
    document.body.classList.add('cpo-perf-mode');
    if (STATE.cssContainment) applyCSSContainment();
    if (STATE.killAnimations) killAnimations();
    if (STATE.messageCollapsing) {
      scheduleIdleWork(() => collapseMessages());
    }
    // Start streaming checker
    clearInterval(streamingCheckTimer);
    streamingCheckTimer = setInterval(checkStreaming, 1500);
    startLiveStats();
  }

  function removeOptimizations() {
    document.body.classList.remove('cpo-perf-mode');
    showAllMessages();
    removeCSSContainment();
    restoreAnimations();
    removeCollapseStyle();
    clearInterval(streamingCheckTimer);
    streamingCheckTimer = null;
    stopLiveStats();
  }

  function togglePerformanceMode(force) {
    STATE.enabled = (typeof force === 'boolean') ? force : !STATE.enabled;

    if (STATE.enabled) {
      applyOptimizations();
    } else {
      removeOptimizations();
    }

    updateToggleButton();
    updateStatusBadge();
    updateStatsPanel();
    saveSettings();
    debouncedBroadcast();
  }

  /* =========================================================================
     LIVE STATS
     ========================================================================= */
  function startLiveStats() {
    stopLiveStats();
    // Send every 2s so popup feels real-time
    liveStatsInterval = setInterval(() => {
      if (STATE.enabled && contextValid) sendLiveStats();
    }, 2000);
  }

  function stopLiveStats() {
    if (liveStatsInterval) { clearInterval(liveStatsInterval); liveStatsInterval = null; }
  }

  function sendLiveStats() {
    const msgs = getMessages();
    STATE.totalMessages = msgs.length;
    STATE.hiddenMessages = hiddenMessages.size;
    safeCall(() => {
      chrome.runtime.sendMessage({
        action: 'live-stats-update',
        hiddenMessages: STATE.hiddenMessages,
        totalMessages: STATE.totalMessages,
        isStreaming: isStreaming,
        enabled: STATE.enabled,
      }, () => { const _ = chrome.runtime.lastError; });
    });
  }

  /* =========================================================================
     BROADCAST STATS (to storage for popup)
     ========================================================================= */
  function debouncedBroadcast() {
    clearTimeout(_broadcastTimer);
    _broadcastTimer = setTimeout(broadcastStats, 500);
  }

  function broadcastStats() {
    const msgs = getMessages();
    STATE.totalMessages = msgs.length;
    STATE.hiddenMessages = hiddenMessages.size;
    updateStatsPanel();
    updateStatusBadge();

    safeCall(() => {
      chrome.storage.local.set({
        cpo_stats: {
          total: STATE.totalMessages,
          hidden: STATE.hiddenMessages,
          visible: Math.max(0, STATE.totalMessages - STATE.hiddenMessages),
          enabled: STATE.enabled,
        },
      });
    });
  }

  /* =========================================================================
     PERSISTENCE
     ========================================================================= */
  function saveSettings() {
    safeCall(() => {
      chrome.storage.sync.set({
        cpo_enabled: STATE.enabled,
        cpo_visibleCount: STATE.visibleCount,
        cpo_threshold: STATE.threshold,
        cpo_showFloatingBtn: STATE.showFloatingBtn,
        cpo_layer_messageCollapsing: STATE.messageCollapsing,
        cpo_layer_cssContainment: STATE.cssContainment,
        cpo_layer_killAnimations: STATE.killAnimations,
        cpo_layer_autoDetect: STATE.autoDetect,
      });
    });
  }

  function loadSettings() {
    return new Promise(resolve => {
      try {
        chrome.storage.sync.get({
          cpo_enabled: false,
          cpo_visibleCount: 15,
          cpo_threshold: 20,
          cpo_showFloatingBtn: true,
          cpo_layer_messageCollapsing: true,
          cpo_layer_cssContainment: true,
          cpo_layer_killAnimations: true,
          cpo_layer_autoDetect: true,
        }, (data) => {
          STATE.enabled = data.cpo_enabled;
          STATE.visibleCount = data.cpo_visibleCount;
          STATE.threshold = data.cpo_threshold;
          STATE.showFloatingBtn = data.cpo_showFloatingBtn;
          STATE.messageCollapsing = data.cpo_layer_messageCollapsing;
          STATE.cssContainment = data.cpo_layer_cssContainment;
          STATE.killAnimations = data.cpo_layer_killAnimations;
          STATE.autoDetect = data.cpo_layer_autoDetect;
          resolve();
        });
      } catch (e) {
        contextValid = false;
        resolve();
      }
    });
  }

  /* =========================================================================
     TEARDOWN
     ========================================================================= */
  function teardown() {
    try { mutationObserver?.disconnect(); } catch (_) {}
    try { navObserver?.disconnect(); } catch (_) {}
    clearTimeout(debounceTimer);
    clearTimeout(_broadcastTimer);
    clearInterval(streamingCheckTimer);
    clearInterval(healthTimer);
    stopLiveStats();
    ['cpo-toggle-btn', 'cpo-status-badge', 'cpo-stats-panel', 'cpo-minimized-fab',
     'cpo-expand-btn', 'cpo-containment', 'cpo-anim-killer', 'cpo-collapse-style'].forEach(id => {
      document.getElementById(id)?.remove();
    });
    document.body.classList.remove('cpo-perf-mode');
  }

  /* =========================================================================
     STORAGE CHANGE LISTENER (from popup)
     ========================================================================= */
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (!contextValid || area !== 'sync') return;

      let recollapse = false;

      if (changes.cpo_enabled) {
        STATE.enabled = changes.cpo_enabled.newValue;
        STATE.enabled ? applyOptimizations() : removeOptimizations();
      }
      if (changes.cpo_visibleCount) { STATE.visibleCount = changes.cpo_visibleCount.newValue; recollapse = true; }
      if (changes.cpo_threshold) { STATE.threshold = changes.cpo_threshold.newValue; }
      if (changes.cpo_showFloatingBtn) { STATE.showFloatingBtn = changes.cpo_showFloatingBtn.newValue; updateToggleButton(); }
      if (changes.cpo_layer_messageCollapsing) { STATE.messageCollapsing = changes.cpo_layer_messageCollapsing.newValue; recollapse = true; }
      if (changes.cpo_layer_cssContainment) {
        STATE.cssContainment = changes.cpo_layer_cssContainment.newValue;
        STATE.enabled && (STATE.cssContainment ? applyCSSContainment() : removeCSSContainment());
      }
      if (changes.cpo_layer_killAnimations) {
        STATE.killAnimations = changes.cpo_layer_killAnimations.newValue;
        STATE.enabled && (STATE.killAnimations ? killAnimations() : restoreAnimations());
      }
      if (changes.cpo_layer_autoDetect) { STATE.autoDetect = changes.cpo_layer_autoDetect.newValue; }

      if (recollapse && STATE.enabled) {
        if (STATE.messageCollapsing) {
          scheduleIdleWork(() => collapseMessages());
        } else {
          showAllMessages();
        }
      }

      updateToggleButton();
      updateStatusBadge();
      updateStatsPanel();
      debouncedBroadcast();
    });
  } catch (e) {}

  /* =========================================================================
     RUNTIME MESSAGE LISTENER (from popup actions)
     ========================================================================= */
  try {
    chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
      if (!contextValid) return;
      if (req.action === 'force-optimize') {
        STATE.enabled = true;
        applyOptimizations();
        saveSettings();
        updateToggleButton();
        updateStatusBadge();
        updateStatsPanel();
        debouncedBroadcast();
        sendResponse({ status: 'optimized' });
      } else if (req.action === 'reset-all') {
        togglePerformanceMode(false);
        sendResponse({ status: 'reset' });
      }
    });
  } catch (e) {}

  /* =========================================================================
     HEALTH CHECK (every 30s — lightweight)
     ========================================================================= */
  healthTimer = setInterval(() => {
    if (!STATE.enabled || !contextValid) return;
    checkStreaming();
    // Gentle re-collapse to catch any messages that sneaked past
    if (STATE.messageCollapsing && !isStreaming) {
      scheduleIdleWork(() => collapseMessages());
    }
    debouncedBroadcast();
  }, 30000);

  /* =========================================================================
     INITIALIZATION
     ========================================================================= */
  async function init() {
    // Only run on ChatGPT
    const host = window.location.hostname;
    if (!['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com'].includes(host)) return;

    await loadSettings().catch(() => { contextValid = false; });
    if (!contextValid) return;

    createToggleButton();
    createStatusBadge();
    createStatsPanel();
    updateToggleButton();
    updateStatusBadge();

    if (STATE.enabled) {
      applyOptimizations();
      updateStatsPanel();
    }

    startObserver();
    watchNavigation();
    debouncedBroadcast();

    log('CPO v3.0 initialized on', host);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }

})();
