/**
 * CPO v3.0 — Popup Controller
 */
(function () {
  'use strict';

  /* -------------------------------------------------------------------------
     Element refs — new clean UI
     ------------------------------------------------------------------------- */
  const mainToggle          = document.getElementById('mainToggle');
  const themeToggle         = document.getElementById('themeToggle');
  const thresholdSlider     = document.getElementById('thresholdSlider');
  const thresholdDisplay    = document.getElementById('thresholdDisplay');
  const visibleCountSlider  = document.getElementById('visibleCountSlider');
  const visibleCountDisplay = document.getElementById('visibleCountDisplay');
  const toggleFloatingBtn   = document.getElementById('toggleFloatingBtn');
  const runNowBtn           = document.getElementById('runNowBtn');
  const resetAllBtn         = document.getElementById('resetAllBtn');

  // Status row
  const statusPip   = document.getElementById('statusPip');
  const statusText  = document.getElementById('statusText');

  // Stats grid
  const ringValue   = document.getElementById('ringValue');
  const hiddenCount = document.getElementById('hiddenCount');
  const visibleCount= document.getElementById('visibleCount');
  const savingPct   = document.getElementById('savingPct');

  // Load bar
  const progressFill      = document.getElementById('progressFill');
  const progressThreshold = document.getElementById('progressThreshold');
  const progressInfo      = document.getElementById('progressInfo');
  const thresholdLabel    = document.getElementById('thresholdLabel');

  // Compat hidden spans (keep for popup.js API)
  const statHidden    = document.getElementById('statHidden');
  const statTotal     = document.getElementById('statTotal');
  const scoreValue    = document.getElementById('scoreValue');
  const scoreSubtitle = document.getElementById('scoreSubtitle');
  const canvas        = document.getElementById('sparkline');
  const ctx           = canvas ? canvas.getContext('2d') : null;
  const timelineNodes = document.getElementById('timelineNodes');

  /* -------------------------------------------------------------------------
     Config
     ------------------------------------------------------------------------- */
  const LAYER_KEYS = ['messageCollapsing', 'cssContainment', 'killAnimations', 'autoDetect'];

  const DEFAULT_PREFS = {
    cpo_enabled: false,
    cpo_theme: 'dark',
    cpo_threshold: 20,
    cpo_visibleCount: 15,
    cpo_showFloatingBtn: true,
    cpo_layer_messageCollapsing: true,
    cpo_layer_cssContainment: true,
    cpo_layer_killAnimations: true,
    cpo_layer_autoDetect: true,
  };

  /* -------------------------------------------------------------------------
     Helpers
     ------------------------------------------------------------------------- */
  function safe(fn) { try { fn(); } catch (_) {} }

  function setNum(el, val) {
    if (!el) return;
    const next = typeof val === 'number' ? val : (parseInt(val, 10) || 0);
    if (el.textContent === String(next)) return;
    el.textContent = next;
    el.classList.remove('num-changed');
    void el.offsetWidth;
    el.classList.add('num-changed');
  }

  /* -------------------------------------------------------------------------
     Status pip + text
     ------------------------------------------------------------------------- */
  function setStatus(enabled, streaming) {
    if (!statusPip || !statusText) return;
    if (streaming) {
      statusPip.className  = 'status-pip streaming';
      statusText.className = 'status-text streaming';
      statusText.textContent = 'Streaming';
    } else if (enabled) {
      statusPip.className  = 'status-pip active';
      statusText.className = 'status-text active';
      statusText.textContent = 'Active';
    } else {
      statusPip.className  = 'status-pip';
      statusText.className = 'status-text';
      statusText.textContent = 'Inactive';
    }
  }

  /* -------------------------------------------------------------------------
     Load bar
     ------------------------------------------------------------------------- */
  function setLoadBar(total, threshold) {
    const maxVal = Math.max(threshold * 2, total + 4, 10);
    const pct    = Math.min((total / maxVal) * 100, 100);
    const tPct   = Math.min((threshold / maxVal) * 100, 96);

    if (progressFill)   progressFill.style.width = pct + '%';
    if (progressInfo)   progressInfo.textContent = `${total} message${total !== 1 ? 's' : ''} in chat`;
    if (thresholdLabel) thresholdLabel.textContent = `trigger at ${threshold}`;

    // Position threshold marker — it lives outside overflow:hidden
    if (progressThreshold) {
      progressThreshold.style.left = tPct + '%';
    }
  }

  /* -------------------------------------------------------------------------
     Layer rows — dot + checkbox + count badge
     ------------------------------------------------------------------------- */
  function setLayers(prefs, stats, enabled) {
    const hidden = (stats && stats.hidden) || 0;

    LAYER_KEYS.forEach(key => {
      const on    = !!(prefs[`cpo_layer_${key}`]);
      const cb    = document.getElementById(`layer-${key}`);
      const dot   = document.getElementById(`dot-${key}`);
      const badge = document.getElementById(`badge-${key}`);
      const row   = document.getElementById(`lc-${key}`);

      if (cb)  cb.checked = on;
      if (dot) dot.className = (enabled && on) ? 'layer-dot on' : 'layer-dot';

      if (badge) {
        if (key === 'messageCollapsing' && enabled && on && hidden > 0) {
          badge.textContent = hidden;
        } else {
          badge.textContent = '';
        }
      }
    });
  }

  /* -------------------------------------------------------------------------
     Full dashboard refresh
     ------------------------------------------------------------------------- */
  function refresh(prefs, stats) {
    const enabled   = !!prefs.cpo_enabled;
    const total     = (stats && stats.total)  || 0;
    const hidden    = (stats && stats.hidden) || 0;
    const rendering = Math.max(0, total - hidden);
    const threshold = prefs.cpo_threshold || 20;
    const streaming = !!(stats && stats.isStreaming);
    const pct       = total > 0 ? Math.round((hidden / total) * 100) : 0;

    // Status
    setStatus(enabled, streaming);

    // Sync main toggle
    if (mainToggle) mainToggle.checked = enabled;

    // Sliders display
    if (visibleCountDisplay) visibleCountDisplay.textContent = prefs.cpo_visibleCount || 15;
    if (thresholdDisplay)    thresholdDisplay.textContent    = threshold;
    if (visibleCountSlider)  visibleCountSlider.value        = prefs.cpo_visibleCount || 15;
    if (thresholdSlider)     thresholdSlider.value           = threshold;
    if (toggleFloatingBtn)   toggleFloatingBtn.checked       = !!prefs.cpo_showFloatingBtn;

    // Stats grid
    setNum(ringValue,    total);
    setNum(hiddenCount,  hidden);
    setNum(visibleCount, rendering);
    if (savingPct) savingPct.textContent = enabled && total > 0 ? pct + '%' : '—';

    // Load bar
    setLoadBar(total, threshold);

    // Layer rows
    setLayers(prefs, stats, enabled);

    // Compat
    if (statTotal)     statTotal.textContent     = total;
    if (statHidden)    statHidden.textContent     = hidden;
    if (scoreValue)    scoreValue.textContent     = pct + '%';
    if (scoreSubtitle) scoreSubtitle.textContent  = `${hidden} of ${total} hidden`;
  }

  /* -------------------------------------------------------------------------
     Load state from storage
     ------------------------------------------------------------------------- */
  function loadState() {
    safe(() => {
      chrome.storage.sync.get(DEFAULT_PREFS, prefs => {
        applyTheme(prefs.cpo_theme || 'dark');
        safe(() => {
          chrome.storage.local.get({ cpo_stats: null, cpo_history: [] }, local => {
            refresh(prefs, local.cpo_stats);
            drawTimeline(local.cpo_history || []);
            if (timelineNodes && local.cpo_history && local.cpo_history.length) {
              timelineNodes.textContent = local.cpo_history[local.cpo_history.length - 1];
            }
          });
        });
      });
    });
  }

  /* -------------------------------------------------------------------------
     Theme
     ------------------------------------------------------------------------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (!themeToggle) return;
    themeToggle.innerHTML = theme === 'light'
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  }

  /* -------------------------------------------------------------------------
     Sparkline (compat)
     ------------------------------------------------------------------------- */
  function drawTimeline(history) {
    if (!ctx || !canvas || !history || history.length < 2) return;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const max = Math.max(...history), min = Math.min(...history);
    const range = max - min || 1;
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    history.forEach((v, i) => {
      const x = (i / (history.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  /* DOM reduction compat */
  function updateDOMReductionDisplay(pct, savedNodes, hiddenMsgs, totalMsgs) {
    if (scoreValue)    scoreValue.textContent    = pct + '%';
    if (scoreSubtitle) scoreSubtitle.textContent = `${hiddenMsgs} of ${totalMsgs || 0} hidden`;
  }

  /* -------------------------------------------------------------------------
     Send message to active tab
     ------------------------------------------------------------------------- */
  function sendToTab(msg) {
    safe(() => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, msg, () => { const _ = chrome.runtime.lastError; });
        }
      });
    });
  }

  /* -------------------------------------------------------------------------
     Event listeners
     ------------------------------------------------------------------------- */
  if (mainToggle) {
    mainToggle.addEventListener('change', () => {
      safe(() => chrome.storage.sync.set({ cpo_enabled: mainToggle.checked }));
    });
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const cur  = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = cur === 'dark' ? 'light' : 'dark';
      safe(() => chrome.storage.sync.set({ cpo_theme: next }));
      applyTheme(next);
    });
  }

  if (thresholdSlider) {
    thresholdSlider.addEventListener('input', () => {
      if (thresholdDisplay) thresholdDisplay.textContent = thresholdSlider.value;
    });
    thresholdSlider.addEventListener('change', () => {
      safe(() => chrome.storage.sync.set({ cpo_threshold: +thresholdSlider.value }));
    });
  }

  if (visibleCountSlider) {
    visibleCountSlider.addEventListener('input', () => {
      if (visibleCountDisplay) visibleCountDisplay.textContent = visibleCountSlider.value;
    });
    visibleCountSlider.addEventListener('change', () => {
      safe(() => chrome.storage.sync.set({ cpo_visibleCount: +visibleCountSlider.value }));
    });
  }

  if (toggleFloatingBtn) {
    toggleFloatingBtn.addEventListener('change', () => {
      safe(() => chrome.storage.sync.set({ cpo_showFloatingBtn: toggleFloatingBtn.checked }));
    });
  }

  // Layer rows — click on row toggles, or toggle the checkbox directly
  LAYER_KEYS.forEach(key => {
    const cb  = document.getElementById(`layer-${key}`);
    const row = document.getElementById(`lc-${key}`);
    if (cb) {
      row?.addEventListener('click', e => {
        if (e.target === cb || e.target.closest('.toggle-pill')) return;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      });
      cb.addEventListener('change', () => {
        safe(() => chrome.storage.sync.set({ [`cpo_layer_${key}`]: cb.checked }));
      });
    }
  });

  if (runNowBtn) {
    runNowBtn.addEventListener('click', () => {
      sendToTab({ action: 'force-optimize' });
      safe(() => chrome.storage.sync.set({ cpo_enabled: true }));
      if (mainToggle) mainToggle.checked = true;
    });
  }

  if (resetAllBtn) {
    resetAllBtn.addEventListener('click', () => {
      safe(() => {
        chrome.storage.sync.set(DEFAULT_PREFS, () => {
          chrome.storage.local.set({ cpo_stats: null, cpo_history: [] }, () => {
            sendToTab({ action: 'reset-all' });
            loadState();
          });
        });
      });
    });
  }

  /* -------------------------------------------------------------------------
     Storage change listener — live refresh
     ------------------------------------------------------------------------- */
  safe(() => {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' || area === 'local') loadState();
    });
  });

  /* -------------------------------------------------------------------------
     Runtime message listener — live push from content script
     ------------------------------------------------------------------------- */
  safe(() => {
    chrome.runtime.onMessage.addListener(message => {
      if (message.action === 'live-stats-update') {
        const hidden    = message.hiddenMessages || 0;
        const total     = message.totalMessages  || 0;
        const streaming = !!message.isStreaming;
        const enabled   = !!message.enabled;
        const pct       = total > 0 ? Math.round((hidden / total) * 100) : 0;

        setStatus(enabled, streaming);
        setNum(ringValue,    total);
        setNum(hiddenCount,  hidden);
        setNum(visibleCount, Math.max(0, total - hidden));
        if (savingPct) savingPct.textContent = enabled && total > 0 ? pct + '%' : '—';

        const threshold = thresholdSlider ? +thresholdSlider.value : 20;
        setLoadBar(total, threshold);

        if (statTotal)  statTotal.textContent  = total;
        if (statHidden) statHidden.textContent = hidden;

      } else if (message.type === 'STATS_RESET' || message.action === 'STATS_RESET') {
        safe(() => {
          chrome.storage.local.set({ cpo_stats: null, cpo_history: [] }, () => loadState());
        });
      }
    });
  });

  /* -------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------- */
  loadState();
  setInterval(loadState, 3000);

})();
