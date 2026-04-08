/**
 * ChatGPT Performance Optimizer v2.2 — Advanced Content Script
 *
 * Multi-layer optimization engine:
 *   L1 — Message Collapsing (DOM detach, not display:none)
 *   L2 — CSS Containment & content-visibility
 *   L3 — Animation & Transition Killer
 *   L4 — Code Block Optimizer (flatten syntax highlighting)
 *   L5 — Image Lazy Loading (IntersectionObserver)
 *   L6 — Streaming Throttle (adaptive debouncing)
 *   L7 — Idle Scheduler (requestIdleCallback)
 *   L8 — Memory Pressure Monitor
 */

(function () {
  'use strict';
  const DEBUG = false;

  // Re-entry guard
  let isOptimizing = false;
  let contextValid = true;
  let navObserver = null;

  function log(...args) {
    if (DEBUG) console.log('[CPO]', ...args);
  }

  function warn(...args) {
    if (DEBUG) console.warn('[CPO]', ...args);
  }

  // Safe wrapper for chrome.* API calls (handles extension reload)
  function safeChromeCall(fn) {
    if (!contextValid) return;
    try {
      fn();
    } catch (e) {
      if (e.message?.includes('Extension context invalidated')) {
        log('Extension reloaded — cleaning up old instance.');
        contextValid = false;
        cleanup();
      } else {
        warn('Safe chrome call failed:', e?.message || e);
      }
    }
  }

  function incrementDiagnostic(type) {
    safeChromeCall(() => {
      chrome.storage.local.get('cpo_diagnostics', (data) => {
        const diagnostics = data.cpo_diagnostics || {};
        diagnostics[type] = (diagnostics[type] || 0) + 1;
        diagnostics.lastErrorAt = Date.now();
        chrome.storage.local.set({ cpo_diagnostics: diagnostics });
      });
    });
  }

  function cleanup() {
    // Stop all observers and timers
    if (observer) observer.disconnect();
    if (navObserver) navObserver.disconnect();
    if (healthCheckInterval) clearInterval(healthCheckInterval);
    // Remove injected UI
    ['cpo-toggle-btn', 'cpo-status-badge', 'cpo-stats-panel', 'cpo-expand-btn',
     'cpo-containment-styles', 'cpo-anim-killer'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    document.body.classList.remove('cpo-perf-mode');
  }

  /* ================================================================
     STATE
     ================================================================ */
  const STATE = {
    enabled: false,
    visibleCount: 15,
    threshold: 20,
    autoDetect: true,
    showFloatingBtn: true,
    expanded: false,

    // Optimization toggles
    killAnimations: true,
    lazyImages: true,
    optimizeCodeBlocks: true,
    cssContainment: true,

    // Stats
    totalMessages: 0,
    hiddenMessages: 0,
    domNodesRemoved: 0,
    codeBlocksOptimized: 0,
    imagesDeferred: 0,
    domNodesBefore: 0,
    domNodesAfter: 0,
    containmentApplied: false,
    animationsKilled: false,
  };

  // Store detached DOM nodes for restoration
  const detachedNodes = new Map();
  const generatedMessageKeys = new WeakMap();
  let generatedKeyCounter = 0;

  /* ================================================================
     SELECTORS — Updated for current ChatGPT DOM (2024-2026)
     ================================================================ */
  const MESSAGE_SELECTORS = [
    // Primary: ChatGPT uses article elements with data-testid
    'article[data-testid^="conversation-turn"]',
    // Alternate: div wrappers with message IDs
    'div[data-message-id]',
    // Class-based fallbacks
    '[data-testid*="conversation-turn"]',
    'div.group\\/conversation-turn',
    // Generic turn wrappers in main thread
    'main .text-base',
  ];

  /* ================================================================
     DOM HELPERS
     ================================================================ */
  function getMessages() {
    for (const sel of MESSAGE_SELECTORS) {
      try {
        const nodes = document.querySelectorAll(sel);
        if (nodes.length > 2) return Array.from(nodes);
      } catch (e) { /* invalid selector, skip */ }
    }
    // Broad fallback: direct children of conversation container
    const container = getConversationContainer();
    if (container) {
      const kids = Array.from(container.children).filter(
        el => el.textContent.trim().length > 20
          && !el.id?.startsWith('cpo-')
          && el.tagName !== 'SCRIPT'
          && el.tagName !== 'STYLE'
      );
      if (kids.length > 2) return kids;
    }
    return [];
  }

  function getConversationContainer() {
    // Try multiple container selectors
    const selectors = [
      'main [role="presentation"]',
      'main .flex.flex-col.items-center',
      'main .flex.flex-col',
      'main',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.children.length > 2) return el;
    }
    return document.querySelector('main');
  }

  let cachedNodeCount = 0;
  let lastNodeCountAt = 0;
  let nodeCountDirty = true;

  function countDOMNodes(excludeOwnUI, force = false) {
    if (excludeOwnUI && !force && !nodeCountDirty && (Date.now() - lastNodeCountAt) < 1500) {
      return cachedNodeCount;
    }
    if (excludeOwnUI) {
      // Count excluding our injected elements
      let count = document.querySelectorAll('*').length;
      document.querySelectorAll('[id^="cpo-"]').forEach(el => {
        count -= el.querySelectorAll('*').length + 1;
      });
      cachedNodeCount = Math.max(0, count);
      lastNodeCountAt = Date.now();
      nodeCountDirty = false;
      return cachedNodeCount;
    }
    return document.querySelectorAll('*').length;
  }

  function getMessageKey(el, index) {
    const stableAttr = el.getAttribute('data-message-id') || el.getAttribute('data-testid');
    if (stableAttr) return stableAttr;
    if (generatedMessageKeys.has(el)) return generatedMessageKeys.get(el);
    const generated = `cpo-msg-${index}-${++generatedKeyCounter}`;
    generatedMessageKeys.set(el, generated);
    return generated;
  }

  /* ================================================================
     L1 — MESSAGE COLLAPSING (True DOM Detach)
     ================================================================ */
  function collapseMessages() {
    if (!STATE.enabled || STATE.expanded || isOptimizing) return;
    isOptimizing = true;
    if (observer) observer.disconnect();

    try {
      const messages = getMessages();
      STATE.totalMessages = messages.length;

      // Snapshot DOM count BEFORE our changes (exclude our UI)
      if (STATE.domNodesBefore === 0) {
        STATE.domNodesBefore = countDOMNodes(true);
      }

      if (messages.length <= STATE.visibleCount) {
        STATE.hiddenMessages = 0;
        updateExpandButton(false);
        broadcastStats();
        return;
      }

      const cutoff = messages.length - STATE.visibleCount;
      let hidden = 0;
      let nodesDetached = 0;

      messages.forEach((el, i) => {
        if (i < cutoff) {
          const messageKey = getMessageKey(el, i);
          if (el.parentNode && !detachedNodes.has(messageKey)) {
            // Count child nodes before detaching
            const childNodeCount = el.querySelectorAll('*').length + 1;
            const placeholder = document.createComment(`cpo-${messageKey}`);
            el.parentNode.insertBefore(placeholder, el);
            el.parentNode.removeChild(el);
            detachedNodes.set(messageKey, { node: el, placeholder });
            nodesDetached += childNodeCount;
          }
          hidden++;
        }
      });

      STATE.hiddenMessages = hidden;
      STATE.domNodesRemoved += nodesDetached;
      STATE.domNodesAfter = countDOMNodes(true, true);
      updateExpandButton(true);
      broadcastStats();
    } finally {
      isOptimizing = false;
      reconnectObserver();
    }
  }

  function restoreMessages() {
    isOptimizing = true;
    if (observer) observer.disconnect();

    try {
      detachedNodes.forEach(({ node, placeholder }) => {
        if (placeholder.parentNode) {
          placeholder.parentNode.insertBefore(node, placeholder);
          placeholder.parentNode.removeChild(placeholder);
        }
      });
      detachedNodes.clear();

      document.querySelectorAll('[data-cpo-hidden]').forEach(el => {
        el.removeAttribute('data-cpo-hidden');
      });

      STATE.hiddenMessages = 0;
      STATE.domNodesRemoved = 0;
      updateExpandButton(false);
      broadcastStats();
    } finally {
      isOptimizing = false;
      reconnectObserver();
    }
  }

  /* ================================================================
     L2 — CSS CONTAINMENT & content-visibility
     ================================================================ */
  let containmentStyleEl = null;

  function applyCSSContainment() {
    if (!STATE.cssContainment || containmentStyleEl) return;

    containmentStyleEl = document.createElement('style');
    containmentStyleEl.id = 'cpo-containment-styles';
    containmentStyleEl.textContent = `
      /* L2: CSS Containment — isolate each message for layout/paint */
      article[data-testid^="conversation-turn"],
      div[data-message-id] {
        contain: layout style paint;
        content-visibility: auto;
        contain-intrinsic-size: auto 300px;
      }
      /* Reduce compositing layers on heavy conversation content only */
      .cpo-perf-mode main article[data-testid^="conversation-turn"] *,
      .cpo-perf-mode main div[data-message-id] *,
      .cpo-perf-mode main pre *,
      .cpo-perf-mode main code * {
        will-change: auto !important;
      }
    `;
    document.head.appendChild(containmentStyleEl);
    STATE.containmentApplied = true;
  }

  function removeCSSContainment() {
    if (containmentStyleEl) {
      containmentStyleEl.remove();
      containmentStyleEl = null;
    }
    STATE.containmentApplied = false;
  }

  /* ================================================================
     L3 — ANIMATION & TRANSITION KILLER
     ================================================================ */
  let animKillerStyleEl = null;

  function killAnimations() {
    if (!STATE.killAnimations || animKillerStyleEl) return;

    animKillerStyleEl = document.createElement('style');
    animKillerStyleEl.id = 'cpo-anim-killer';
    animKillerStyleEl.textContent = `
      /* L3: Kill animations & transitions (preserve our own UI) */
      .cpo-perf-mode *:not([id^="cpo-"]):not([id^="cpo-"] *) {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
      .cpo-perf-mode * {
        scroll-behavior: auto !important;
      }
      .cpo-perf-mode main [class*="backdrop"],
      .cpo-perf-mode main [style*="backdrop-filter"] {
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
      /* Reduce box-shadows on non-essential elements */
      .cpo-perf-mode main div:not([id^="cpo-"]) {
        box-shadow: none !important;
      }
    `;
    document.head.appendChild(animKillerStyleEl);
    STATE.animationsKilled = true;
  }

  function restoreAnimations() {
    if (animKillerStyleEl) {
      animKillerStyleEl.remove();
      animKillerStyleEl = null;
    }
    STATE.animationsKilled = false;
  }

  /* ================================================================
     L4 — CODE BLOCK OPTIMIZER
     Flatten syntax highlighting spans in large code blocks.
     ================================================================ */
  function optimizeCodeBlocks() {
    if (!STATE.optimizeCodeBlocks) return;

    // Multiple selectors for code blocks
    const codeBlocks = document.querySelectorAll(
      'pre code:not([data-cpo-opt]), pre > div > code:not([data-cpo-opt]), .code-block code:not([data-cpo-opt]), [class*="highlight"] code:not([data-cpo-opt])'
    );
    let optimized = 0;

    codeBlocks.forEach(code => {
      const pre = code.closest('pre') || code.parentElement;
      if (!pre) return;

      const spans = code.querySelectorAll('span');
      const textLen = code.textContent.length;

      // Only optimize blocks with significant span count or text
      if (spans.length < 20 && textLen < 400) return;

      code.setAttribute('data-cpo-opt', 'true');
      code.setAttribute('data-cpo-original-html', code.innerHTML);

      const removedSpans = spans.length;
      const plainText = code.textContent;
      const shouldTruncate = plainText.length > 500;
      const displayText = shouldTruncate ? plainText.slice(0, 500) : plainText;

      code.textContent = displayText;
      STATE.domNodesRemoved += removedSpans;
      nodeCountDirty = true;

      if (shouldTruncate) {
        const expandBtn = document.createElement('button');
        expandBtn.className = 'cpo-code-expand';
        expandBtn.textContent = `⋯ Show full code (${(textLen / 1000).toFixed(1)}K chars, ${removedSpans} spans removed)`;
        expandBtn.addEventListener('click', () => {
          code.innerHTML = code.getAttribute('data-cpo-original-html');
          code.removeAttribute('data-cpo-opt');
          code.removeAttribute('data-cpo-original-html');
          expandBtn.remove();
          STATE.codeBlocksOptimized = Math.max(0, STATE.codeBlocksOptimized - 1);
        });
        pre.appendChild(expandBtn);
      }

      optimized++;
    });

    STATE.codeBlocksOptimized += optimized;
    if (optimized > 0) {
      STATE.domNodesAfter = countDOMNodes(true, true);
    }
  }

  function restoreCodeBlocks() {
    document.querySelectorAll('code[data-cpo-opt]').forEach(code => {
      const original = code.getAttribute('data-cpo-original-html');
      if (original) {
        code.innerHTML = original;
        code.removeAttribute('data-cpo-opt');
        code.removeAttribute('data-cpo-original-html');
      }
    });
    document.querySelectorAll('.cpo-code-expand').forEach(btn => btn.remove());
    STATE.codeBlocksOptimized = 0;
  }

  /* ================================================================
     L5 — IMAGE LAZY LOADING
     ================================================================ */
  let imageObserver = null;

  function setupLazyImages() {
    if (!STATE.lazyImages) return;

    if (!imageObserver) {
      imageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          const img = entry.target;
          if (entry.isIntersecting && img.dataset.cpoSrc) {
            img.src = img.dataset.cpoSrc;
            delete img.dataset.cpoSrc;
            img.removeAttribute('data-cpo-lazy');
            imageObserver.unobserve(img);
          }
        });
      }, { rootMargin: '300px' });
    }

    document.querySelectorAll('main img:not([data-cpo-lazy])').forEach(img => {
      if (!img.src || img.src.startsWith('data:') || img.naturalWidth > 0) return;
      const rect = img.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) return; // in viewport

      img.dataset.cpoSrc = img.src;
      img.setAttribute('data-cpo-lazy', 'true');
      img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"%3E%3C/svg%3E';
      imageObserver.observe(img);
      STATE.imagesDeferred++;
    });
  }

  function teardownLazyImages() {
    if (imageObserver) {
      imageObserver.disconnect();
      imageObserver = null;
    }
    document.querySelectorAll('[data-cpo-lazy]').forEach(img => {
      if (img.dataset.cpoSrc) {
        img.src = img.dataset.cpoSrc;
        delete img.dataset.cpoSrc;
      }
      img.removeAttribute('data-cpo-lazy');
    });
    STATE.imagesDeferred = 0;
  }

  /* ================================================================
     L6 — STREAMING THROTTLE
     ================================================================ */
  let isStreaming = false;

  function detectStreaming() {
    try {
      return !!(
        document.querySelector('button[aria-label="Stop generating"]')
        || document.querySelector('button[data-testid="stop-button"]')
        || document.querySelector('.result-streaming')
        || document.querySelector('button[class*="stop"]')
      );
    } catch (e) {
      return false;
    }
  }

  function getThrottleDelay() {
    return isStreaming ? 2000 : 400;
  }

  /* ================================================================
     L7 — IDLE SCHEDULER
     ================================================================ */
  function scheduleIdleWork(callback) {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(callback, { timeout: 3000 });
    } else {
      setTimeout(callback, 150);
    }
  }

  /* ================================================================
     L8 — MEMORY PRESSURE MONITOR
     ================================================================ */
  function checkMemoryPressure() {
    const nodeCount = countDOMNodes(true);
    if (nodeCount > 15000 && !STATE.enabled && STATE.autoDetect) {
      log('High DOM pressure:', nodeCount, 'nodes — auto-activating.');
      togglePerformanceMode(true);
    }
    return nodeCount;
  }

  /* ================================================================
     UI: EXPAND BUTTON
     ================================================================ */
  function updateExpandButton(show) {
    let btn = document.getElementById('cpo-expand-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'cpo-expand-btn';
      btn.addEventListener('click', () => {
        STATE.expanded = true;
        restoreAllOptimizations();
        btn.classList.remove('cpo-show');
      });
      const container = getConversationContainer();
      if (container) container.prepend(btn);
    }

    const count = STATE.hiddenMessages;
    const saved = STATE.domNodesRemoved;
    if (count > 0) {
      btn.textContent = `⬆ Show ${count} hidden message${count !== 1 ? 's' : ''}${saved > 0 ? ` · ${saved.toLocaleString()} DOM nodes freed` : ''}`;
    }
    btn.classList.toggle('cpo-show', show && count > 0);
  }

  /* ================================================================
     UI: FLOATING TOGGLE BUTTON
     ================================================================ */
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

  /* ================================================================
     UI: STATUS BADGE — now shows accurate info
     ================================================================ */
  function createStatusBadge() {
    if (document.getElementById('cpo-status-badge')) return;

    const badge = document.createElement('div');
    badge.id = 'cpo-status-badge';
    badge.innerHTML = `<span class="cpo-badge-dot"></span><span class="cpo-badge-text"></span>`;
    badge.addEventListener('mouseenter', () => showStatsPanel(true));
    badge.addEventListener('mouseleave', () => showStatsPanel(false));
    document.body.appendChild(badge);
  }

  function updateStatusBadge() {
    const badge = document.getElementById('cpo-status-badge');
    if (!badge) return;
    const text = badge.querySelector('.cpo-badge-text');

    if (STATE.enabled) {
      badge.className = 'cpo-badge-active cpo-visible';

      // Build accurate status parts
      const parts = [];
      if (STATE.hiddenMessages > 0) parts.push(`${STATE.hiddenMessages} msgs hidden`);
      if (STATE.domNodesRemoved > 0) parts.push(`${STATE.domNodesRemoved.toLocaleString()} nodes freed`);
      if (STATE.containmentApplied) parts.push('containment');
      if (STATE.animationsKilled) parts.push('anims killed');
      if (STATE.codeBlocksOptimized > 0) parts.push(`${STATE.codeBlocksOptimized} code opt`);
      if (STATE.imagesDeferred > 0) parts.push(`${STATE.imagesDeferred} imgs deferred`);

      if (parts.length === 0) {
        // All layers active but nothing to optimize yet
        const layers = [STATE.containmentApplied, STATE.animationsKilled, STATE.cssContainment, STATE.killAnimations].filter(Boolean).length;
        text.textContent = `⚡ Active · ${STATE.totalMessages} msgs · ${layers > 0 ? layers + ' layers' : 'monitoring'}`;
      } else {
        text.textContent = `⚡ ${parts.join(' · ')}`;
      }
    } else {
      badge.className = 'cpo-badge-inactive cpo-visible';
      text.textContent = 'Performance Mode Off';
      setTimeout(() => {
        if (!STATE.enabled) badge.classList.remove('cpo-visible');
      }, 4000);
    }
  }

  /* ================================================================
     UI: STATS PANEL (hover on badge)
     ================================================================ */
  function createStatsPanel() {
    if (document.getElementById('cpo-stats-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'cpo-stats-panel';
    panel.innerHTML = `
      <h4>⚡ Live Performance Stats</h4>
      <div class="cpo-stat-row">
        <span class="cpo-stat-label">Total Messages</span>
        <span class="cpo-stat-value" id="cpo-sp-total">0</span>
      </div>
      <div class="cpo-stat-row">
        <span class="cpo-stat-label">Visible</span>
        <span class="cpo-stat-value" id="cpo-sp-visible">0</span>
      </div>
      <div class="cpo-stat-row">
        <span class="cpo-stat-label">Hidden (detached)</span>
        <span class="cpo-stat-value cpo-highlight" id="cpo-sp-hidden">0</span>
      </div>
      <div class="cpo-stat-divider"></div>
      <div class="cpo-stat-row">
        <span class="cpo-stat-label">DOM Nodes (page)</span>
        <span class="cpo-stat-value" id="cpo-sp-nodes-before">0</span>
      </div>
      <div class="cpo-stat-row">
        <span class="cpo-stat-label">DOM Nodes (now)</span>
        <span class="cpo-stat-value cpo-highlight" id="cpo-sp-nodes-after">0</span>
      </div>
      <div class="cpo-stat-row">
        <span class="cpo-stat-label">Nodes Freed</span>
        <span class="cpo-stat-value cpo-highlight" id="cpo-sp-removed">0</span>
      </div>
      <div class="cpo-stat-divider"></div>
      <div class="cpo-stat-row">
        <span class="cpo-stat-label">CSS Containment</span>
        <span class="cpo-stat-value" id="cpo-sp-containment">Off</span>
      </div>
      <div class="cpo-stat-row">
        <span class="cpo-stat-label">Animations Killed</span>
        <span class="cpo-stat-value" id="cpo-sp-anims">Off</span>
      </div>
      <div class="cpo-stat-row">
        <span class="cpo-stat-label">Code Blocks Opt.</span>
        <span class="cpo-stat-value" id="cpo-sp-code">0</span>
      </div>
      <div class="cpo-stat-row">
        <span class="cpo-stat-label">Images Deferred</span>
        <span class="cpo-stat-value" id="cpo-sp-images">0</span>
      </div>
      <div class="cpo-stat-row">
        <span class="cpo-stat-label">Streaming</span>
        <span class="cpo-stat-value" id="cpo-sp-streaming">No</span>
      </div>
    `;
    document.body.appendChild(panel);
  }

  function showStatsPanel(visible) {
    const panel = document.getElementById('cpo-stats-panel');
    if (panel) panel.classList.toggle('cpo-visible', visible);
  }

  function updateStatsPanel() {
    const currentNodes = countDOMNodes(true, true);
    const saved = Math.max(0, STATE.domNodesBefore - currentNodes);

    const updates = {
      'cpo-sp-total': STATE.totalMessages,
      'cpo-sp-visible': STATE.totalMessages - STATE.hiddenMessages,
      'cpo-sp-hidden': STATE.hiddenMessages,
      'cpo-sp-nodes-before': STATE.domNodesBefore > 0 ? STATE.domNodesBefore.toLocaleString() : currentNodes.toLocaleString(),
      'cpo-sp-nodes-after': currentNodes.toLocaleString(),
      'cpo-sp-removed': saved > 0 ? saved.toLocaleString() : STATE.domNodesRemoved.toLocaleString(),
      'cpo-sp-containment': STATE.containmentApplied ? '✅ Active' : '⬜ Off',
      'cpo-sp-anims': STATE.animationsKilled ? '✅ Killed' : '⬜ Off',
      'cpo-sp-code': STATE.codeBlocksOptimized,
      'cpo-sp-images': STATE.imagesDeferred,
      'cpo-sp-streaming': isStreaming ? '🔴 Yes' : '⚪ No',
    };

    for (const [id, val] of Object.entries(updates)) {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    }
  }

  /* ================================================================
     MASTER TOGGLE
     ================================================================ */
  function applyAllOptimizations() {
    // Capture baseline DOM count BEFORE adding anything
    STATE.domNodesBefore = countDOMNodes(true, true);
    STATE.domNodesRemoved = 0;

    document.body.classList.add('cpo-perf-mode');

    // L1 — Collapse messages (only if enough messages)
    collapseMessages();

    // L2 — CSS containment (always beneficial)
    applyCSSContainment();

    // L3 — Kill animations (always beneficial)
    killAnimations();

    // L4+L5 — Code blocks + images (idle-scheduled)
    scheduleIdleWork(() => {
      optimizeCodeBlocks();
      setupLazyImages();
      STATE.domNodesAfter = countDOMNodes(true, true);
      updateStatsPanel();
      updateStatusBadge();
      broadcastStats();
    });

    STATE.domNodesAfter = countDOMNodes(true, true);
  }

  function restoreAllOptimizations() {
    document.body.classList.remove('cpo-perf-mode');

    restoreMessages();
    removeCSSContainment();
    restoreAnimations();
    restoreCodeBlocks();
    teardownLazyImages();

    STATE.domNodesRemoved = 0;
    STATE.codeBlocksOptimized = 0;
    STATE.domNodesBefore = 0;
    STATE.domNodesAfter = 0;
  }

  function togglePerformanceMode(force) {
    STATE.enabled = typeof force === 'boolean' ? force : !STATE.enabled;
    STATE.expanded = false;

    if (STATE.enabled) {
      applyAllOptimizations();
    } else {
      restoreAllOptimizations();
    }

    updateToggleButton();
    updateStatusBadge();
    updateStatsPanel();
    saveSettings();
  }

  /* ================================================================
     SMART AUTO-DETECTION
     ================================================================ */
  function smartDetect() {
    if (!STATE.autoDetect || STATE.enabled || isOptimizing) return;

    const messages = getMessages();
    if (messages.length >= STATE.threshold) {
      log('Auto-activating — messages:', messages.length, '≥ threshold:', STATE.threshold);
      togglePerformanceMode(true);
    }
  }

  /* ================================================================
     MUTATION OBSERVER
     ================================================================ */
  let observer = null;
  let debounceTimer = null;
  let observerTarget = null;

  function startObserver() {
    if (observer) observer.disconnect();

    observerTarget = getConversationContainer() || document.body;

    observer = new MutationObserver((mutations) => {
      if (isOptimizing) return;
      nodeCountDirty = true;

      isStreaming = detectStreaming();

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const hasNewContent = mutations.some(m =>
          m.addedNodes.length > 0 || m.removedNodes.length > 0
        );
        if (!hasNewContent) return;

        smartDetect();

        if (STATE.enabled && !STATE.expanded) {
          collapseMessages();
          scheduleIdleWork(() => {
            optimizeCodeBlocks();
            setupLazyImages();
            updateStatusBadge();
            updateStatsPanel();
            broadcastStats();
          });
        }
      }, getThrottleDelay());
    });

    observer.observe(observerTarget, { childList: true, subtree: true });
  }

  function reconnectObserver() {
    if (observer && observerTarget) {
      try {
        observer.observe(observerTarget, { childList: true, subtree: true });
      } catch (e) {
        startObserver();
      }
    }
  }

  /* ================================================================
     SPA NAVIGATION WATCHER
     ================================================================ */
  let lastUrl = location.href;

  function watchNavigation() {
    navObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        log('Navigation detected, re-initializing');

        // Reset state for new conversation
        STATE.expanded = false;
        detachedNodes.clear();
        STATE.domNodesRemoved = 0;
        STATE.codeBlocksOptimized = 0;
        STATE.imagesDeferred = 0;
        STATE.domNodesBefore = 0;
        STATE.domNodesAfter = 0;
        nodeCountDirty = true;

        setTimeout(() => {
          startObserver();
          if (STATE.enabled) applyAllOptimizations();
          updateStatsPanel();
          updateStatusBadge();
        }, 1500);
      }
    });
    navObserver.observe(document.body, { childList: true, subtree: true });
  }

  /* ================================================================
     PERSISTENCE
     ================================================================ */
  function saveSettings() {
    safeChromeCall(() => {
      chrome.storage.local.set({
        cpo_enabled: STATE.enabled,
        cpo_visibleCount: STATE.visibleCount,
        cpo_threshold: STATE.threshold,
        cpo_autoDetect: STATE.autoDetect,
        cpo_showFloatingBtn: STATE.showFloatingBtn,
        cpo_killAnimations: STATE.killAnimations,
        cpo_lazyImages: STATE.lazyImages,
        cpo_optimizeCodeBlocks: STATE.optimizeCodeBlocks,
        cpo_cssContainment: STATE.cssContainment,
      });
    });
  }

  function loadSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get(null, (data) => {
        if (data.cpo_enabled !== undefined)           STATE.enabled           = data.cpo_enabled;
        if (data.cpo_visibleCount !== undefined)       STATE.visibleCount      = data.cpo_visibleCount;
        if (data.cpo_threshold !== undefined)          STATE.threshold         = data.cpo_threshold;
        if (data.cpo_autoDetect !== undefined)         STATE.autoDetect        = data.cpo_autoDetect;
        if (data.cpo_showFloatingBtn !== undefined)    STATE.showFloatingBtn   = data.cpo_showFloatingBtn;
        if (data.cpo_killAnimations !== undefined)     STATE.killAnimations    = data.cpo_killAnimations;
        if (data.cpo_lazyImages !== undefined)         STATE.lazyImages        = data.cpo_lazyImages;
        if (data.cpo_optimizeCodeBlocks !== undefined) STATE.optimizeCodeBlocks = data.cpo_optimizeCodeBlocks;
        if (data.cpo_cssContainment !== undefined)     STATE.cssContainment    = data.cpo_cssContainment;
        resolve();
      });
    });
  }

  /* ================================================================
     BROADCAST STATS TO POPUP
     ================================================================ */
  function broadcastStats() {
    const currentNodes = countDOMNodes(true, true);
    const saved = STATE.domNodesBefore > 0 ? Math.max(0, STATE.domNodesBefore - currentNodes) : STATE.domNodesRemoved;

    safeChromeCall(() => {
      chrome.storage.local.set({
        cpo_stats: {
          total: STATE.totalMessages,
          hidden: STATE.hiddenMessages,
          visible: STATE.totalMessages - STATE.hiddenMessages,
          domNodesBefore: STATE.domNodesBefore,
          domNodesAfter: currentNodes,
          domNodesRemoved: saved > 0 ? saved : STATE.domNodesRemoved,
          codeBlocksOptimized: STATE.codeBlocksOptimized,
          imagesDeferred: STATE.imagesDeferred,
          containmentActive: STATE.containmentApplied,
          animationsKilled: STATE.animationsKilled,
          isStreaming: isStreaming,
        },
      });
    });
  }

  /* ================================================================
     LISTEN FOR POPUP SETTING CHANGES
     ================================================================ */
  try {
    chrome.storage.onChanged.addListener((changes) => {
      if (!contextValid) return;
      // Ignore our own stats broadcasts
      if (changes.cpo_stats && Object.keys(changes).length === 1) return;

      let shouldRecollapse = false;

      if (changes.cpo_enabled)           { STATE.enabled           = changes.cpo_enabled.newValue; }
      if (changes.cpo_visibleCount)      { STATE.visibleCount      = changes.cpo_visibleCount.newValue; shouldRecollapse = true; }
      if (changes.cpo_threshold)         { STATE.threshold         = changes.cpo_threshold.newValue; }
      if (changes.cpo_autoDetect)        { STATE.autoDetect        = changes.cpo_autoDetect.newValue; }
      if (changes.cpo_showFloatingBtn)   { STATE.showFloatingBtn   = changes.cpo_showFloatingBtn.newValue; }
      if (changes.cpo_killAnimations)    { STATE.killAnimations    = changes.cpo_killAnimations.newValue; }
      if (changes.cpo_lazyImages)        { STATE.lazyImages        = changes.cpo_lazyImages.newValue; }
      if (changes.cpo_optimizeCodeBlocks){ STATE.optimizeCodeBlocks = changes.cpo_optimizeCodeBlocks.newValue; }
      if (changes.cpo_cssContainment)    { STATE.cssContainment    = changes.cpo_cssContainment.newValue; }

      STATE.expanded = false;

      if (changes.cpo_enabled) {
        if (STATE.enabled) {
          applyAllOptimizations();
        } else {
          restoreAllOptimizations();
        }
      } else if (STATE.enabled) {
        // Apply only changed layers instead of full restore/reapply.
        if (changes.cpo_cssContainment) {
          STATE.cssContainment ? applyCSSContainment() : removeCSSContainment();
        }
        if (changes.cpo_killAnimations) {
          STATE.killAnimations ? killAnimations() : restoreAnimations();
        }
        if (changes.cpo_lazyImages) {
          if (STATE.lazyImages) {
            setupLazyImages();
          } else {
            teardownLazyImages();
          }
        }
        if (changes.cpo_optimizeCodeBlocks) {
          if (STATE.optimizeCodeBlocks) {
            scheduleIdleWork(() => optimizeCodeBlocks());
          } else {
            restoreCodeBlocks();
          }
        }
        if (shouldRecollapse && !STATE.expanded) {
          collapseMessages();
        }
      } else {
        // no-op
      }

      updateToggleButton();
      updateStatusBadge();
      updateStatsPanel();
    });
  } catch (e) {
    // Extension context already invalidated — ignore
    incrementDiagnostic('storageListenerError');
  }

  /* ================================================================
     PERIODIC HEALTH CHECK (every 10s)
     ================================================================ */
  let healthCheckInterval = setInterval(() => {
    if (!STATE.enabled || !contextValid) return;
    isStreaming = detectStreaming();

    scheduleIdleWork(() => {
      if (STATE.enabled && contextValid) {
        optimizeCodeBlocks();
        setupLazyImages();
        STATE.domNodesAfter = countDOMNodes(true, true);
        updateStatsPanel();
        updateStatusBadge();
        broadcastStats();
      }
    });
  }, 10000);

  /* ================================================================
     INIT
     ================================================================ */
  async function init() {
    log(
      '%c⚡ ChatGPT Performance Optimizer v2.2 loaded',
      'color: #10b981; font-weight: bold; font-size: 14px; background: #0a0b10; padding: 4px 8px; border-radius: 4px;'
    );

    await loadSettings().catch(() => { contextValid = false; });
    if (!contextValid) return;

    createToggleButton();
    createStatusBadge();
    createStatsPanel();
    updateToggleButton();
    updateStatusBadge();

    if (STATE.enabled) {
      applyAllOptimizations();
      updateStatsPanel();
    }

    startObserver();
    watchNavigation();

    // Delayed memory check
    setTimeout(() => checkMemoryPressure(), 8000);
  }

  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
