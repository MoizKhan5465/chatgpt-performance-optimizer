/**
 * ChatGPT Performance Optimizer v2.2 — Popup Script
 * Handles presets, custom message count, optimization layers, and live stats.
 */

(function () {
  'use strict';

  /* ================================================================
     PRESET DEFINITIONS (must match service_worker.js)
     ================================================================ */
  const PRESETS = {
    mild:       { visibleCount: 25, threshold: 30, killAnimations: false, lazyImages: false, optimizeCodeBlocks: false, cssContainment: true, autoDetect: true },
    balanced:   { visibleCount: 15, threshold: 20, killAnimations: true,  lazyImages: true,  optimizeCodeBlocks: false, cssContainment: true, autoDetect: true },
    aggressive: { visibleCount: 8,  threshold: 12, killAnimations: true,  lazyImages: true,  optimizeCodeBlocks: true,  cssContainment: true, autoDetect: true },
    extreme:    { visibleCount: 3,  threshold: 5,  killAnimations: true,  lazyImages: true,  optimizeCodeBlocks: true,  cssContainment: true, autoDetect: true },
  };

  /* ================================================================
     DOM REFS
     ================================================================ */
  const mainToggle       = document.getElementById('mainToggle');
  const statusCard       = document.getElementById('statusCard');
  const statusLabel      = document.getElementById('statusLabel');
  const statusSublabel   = document.getElementById('statusSublabel');

  // Message count
  const visibleCountInput  = document.getElementById('visibleCount');
  const visibleSlider      = document.getElementById('visibleSlider');
  const thresholdSlider    = document.getElementById('threshold');
  const thresholdDisplay   = document.getElementById('thresholdDisplay');

  // Optimization checkboxes
  const autoDetect         = document.getElementById('autoDetect');
  const killAnimations     = document.getElementById('killAnimations');
  const cssContainment     = document.getElementById('cssContainment');
  const optimizeCodeBlocks = document.getElementById('optimizeCodeBlocks');
  const lazyImages         = document.getElementById('lazyImages');
  const showFloatingBtn    = document.getElementById('showFloatingBtn');

  // Stats
  const statHidden         = document.getElementById('statHidden');
  const statVisible        = document.getElementById('statVisible');
  const statTotal          = document.getElementById('statTotal');
  const statNodesRemoved   = document.getElementById('statNodesRemoved');
  const statCodeBlocks     = document.getElementById('statCodeBlocks');
  const statImagesDeferred = document.getElementById('statImagesDeferred');
  const reductionPct       = document.getElementById('reductionPct');
  const reductionFill      = document.getElementById('reductionFill');
  const nodesBefore        = document.getElementById('nodesBefore');
  const nodesAfter         = document.getElementById('nodesAfter');
  const nodesSaved         = document.getElementById('nodesSaved');

  // Preset buttons
  const presetGrid         = document.getElementById('presetGrid');
  const presetBtns         = presetGrid.querySelectorAll('.preset-btn');
  const presetState        = document.getElementById('presetState');

  // Quick count buttons
  const quickBtns          = document.querySelectorAll('.quick-btn');

  /* ================================================================
     LOAD SETTINGS
     ================================================================ */
  function loadSettings() {
    chrome.storage.local.get(null, (data) => {
      // Main toggle
      mainToggle.checked = data.cpo_enabled || false;
      updateStatusUI(mainToggle.checked);

      // Message count
      const count = data.cpo_visibleCount || 15;
      visibleCountInput.value = count;
      visibleSlider.value = count;
      highlightQuickBtn(count);

      // Threshold
      const thresh = data.cpo_threshold || 20;
      thresholdSlider.value = thresh;
      thresholdDisplay.textContent = thresh;

      // Optimizations
      autoDetect.checked         = data.cpo_autoDetect !== undefined ? data.cpo_autoDetect : true;
      killAnimations.checked     = data.cpo_killAnimations !== undefined ? data.cpo_killAnimations : true;
      cssContainment.checked     = data.cpo_cssContainment !== undefined ? data.cpo_cssContainment : true;
      optimizeCodeBlocks.checked = data.cpo_optimizeCodeBlocks !== undefined ? data.cpo_optimizeCodeBlocks : true;
      lazyImages.checked         = data.cpo_lazyImages !== undefined ? data.cpo_lazyImages : true;
      showFloatingBtn.checked    = data.cpo_showFloatingBtn !== undefined ? data.cpo_showFloatingBtn : true;

      // Update card states
      updateOptCards();

      // Active preset
      highlightPreset(data.cpo_preset || 'balanced');

      // Stats
      updateStats(data.cpo_stats);
    });
  }

  /* ================================================================
     UI UPDATERS
     ================================================================ */
  function updateStatusUI(enabled) {
    statusCard.classList.toggle('active', enabled);
    statusLabel.textContent = enabled ? 'Active' : 'Disabled';

    // Count enabled layers
    const layers = [autoDetect, killAnimations, cssContainment, optimizeCodeBlocks, lazyImages].filter(c => c.checked).length;
    statusSublabel.textContent = enabled
      ? `${layers + 3} optimization layers running`  // +3 for L1 DOM detach, L6 throttle, L7 idle, L8 memory
      : 'Toggle to boost performance';
  }

  function updateStats(stats) {
    if (!stats) return;

    statHidden.textContent         = stats.hidden || 0;
    statVisible.textContent        = stats.visible || 0;
    statTotal.textContent          = stats.total || 0;
    statNodesRemoved.textContent   = stats.domNodesRemoved || 0;
    statCodeBlocks.textContent     = stats.codeBlocksOptimized || 0;
    statImagesDeferred.textContent = stats.imagesDeferred || 0;

    // DOM reduction bar
    const before = stats.domNodesBefore || 0;
    const after  = stats.domNodesAfter || before;
    const saved  = Math.max(0, before - after);
    const pct    = before > 0 ? Math.round((saved / before) * 100) : 0;
    const clamped = Math.max(0, Math.min(pct, 100));

    reductionPct.textContent  = clamped + '%';
    reductionFill.style.width = clamped + '%';

    nodesBefore.textContent = 'Before: ' + (before > 0 ? before.toLocaleString() : '—');
    nodesAfter.textContent  = 'After: ' + (after > 0 ? after.toLocaleString() : '—');
    nodesSaved.textContent  = 'Saved: ' + (saved > 0 ? saved.toLocaleString() : '—');
  }

  function highlightPreset(key) {
    presetBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === key);
    });
    const label = key === 'custom' ? 'Custom' : (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Balanced');
    presetState.textContent = `Current preset: ${label}`;
  }

  function highlightQuickBtn(count) {
    quickBtns.forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.count) === count);
    });
  }

  function updateOptCards() {
    document.querySelectorAll('.opt-card').forEach(card => {
      const checkbox = card.querySelector('input[type="checkbox"]');
      card.classList.toggle('enabled', checkbox.checked);
    });
  }

  function setVisibleCount(count) {
    count = Math.max(1, Math.min(100, parseInt(count) || 15));
    visibleCountInput.value = count;
    visibleSlider.value = count;
    highlightQuickBtn(count);
    chrome.storage.local.set({ cpo_visibleCount: count, cpo_preset: 'custom' });
    highlightPreset('custom'); // deselect preset
  }

  /* ================================================================
     EVENT LISTENERS
     ================================================================ */

  // ── Main Toggle ──
  mainToggle.addEventListener('change', () => {
    chrome.storage.local.set({ cpo_enabled: mainToggle.checked });
    updateStatusUI(mainToggle.checked);
  });

  // ── Presets ──
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.preset;
      const preset = PRESETS[key];
      if (!preset) return;

      highlightPreset(key);

      // Apply preset values to UI
      visibleCountInput.value = preset.visibleCount;
      visibleSlider.value = preset.visibleCount;
      highlightQuickBtn(preset.visibleCount);
      thresholdSlider.value = preset.threshold;
      thresholdDisplay.textContent = preset.threshold;
      autoDetect.checked         = preset.autoDetect;
      killAnimations.checked     = preset.killAnimations;
      cssContainment.checked     = preset.cssContainment;
      optimizeCodeBlocks.checked = preset.optimizeCodeBlocks;
      lazyImages.checked         = preset.lazyImages;
      updateOptCards();

      // Save to storage (content script will react)
      chrome.storage.local.set({
        cpo_preset: key,
        cpo_visibleCount: preset.visibleCount,
        cpo_threshold: preset.threshold,
        cpo_autoDetect: preset.autoDetect,
        cpo_killAnimations: preset.killAnimations,
        cpo_cssContainment: preset.cssContainment,
        cpo_optimizeCodeBlocks: preset.optimizeCodeBlocks,
        cpo_lazyImages: preset.lazyImages,
        cpo_enabled: true,
      });
      mainToggle.checked = true;
      updateStatusUI(true);
    });
  });

  // ── Custom message count (number input) ──
  visibleCountInput.addEventListener('input', () => {
    setVisibleCount(visibleCountInput.value);
  });

  // ── Slider sync ──
  visibleSlider.addEventListener('input', () => {
    setVisibleCount(visibleSlider.value);
  });

  // ── Quick count buttons ──
  quickBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      setVisibleCount(btn.dataset.count);
    });
  });

  // ── Threshold ──
  thresholdSlider.addEventListener('input', () => {
    thresholdDisplay.textContent = thresholdSlider.value;
    chrome.storage.local.set({
      cpo_threshold: parseInt(thresholdSlider.value, 10),
      cpo_preset: 'custom',
    });
    highlightPreset('custom');
  });

  // ── Optimization toggles ──
  const optMap = [
    [autoDetect,         'cpo_autoDetect'],
    [killAnimations,     'cpo_killAnimations'],
    [cssContainment,     'cpo_cssContainment'],
    [optimizeCodeBlocks, 'cpo_optimizeCodeBlocks'],
    [lazyImages,         'cpo_lazyImages'],
    [showFloatingBtn,    'cpo_showFloatingBtn'],
  ];

  optMap.forEach(([el, key]) => {
    el.addEventListener('change', () => {
      chrome.storage.local.set({ [key]: el.checked, cpo_preset: 'custom' });
      updateOptCards();
      updateStatusUI(mainToggle.checked);
      highlightPreset('custom');
    });
  });

  // ── Clicking opt-card also toggles checkbox ──
  document.querySelectorAll('.opt-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.type === 'checkbox') return;  // let checkbox handle itself
      const checkbox = card.querySelector('input[type="checkbox"]');
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change'));
    });
  });

  /* ================================================================
     LIVE UPDATES FROM CONTENT SCRIPT
     ================================================================ */
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.cpo_stats) {
      updateStats(changes.cpo_stats.newValue);
    }
    if (changes.cpo_enabled) {
      mainToggle.checked = changes.cpo_enabled.newValue;
      updateStatusUI(changes.cpo_enabled.newValue);
    }
    if (changes.cpo_preset) {
      highlightPreset(changes.cpo_preset.newValue);
    }
    if (changes.cpo_visibleCount) {
      const v = changes.cpo_visibleCount.newValue;
      visibleCountInput.value = v;
      visibleSlider.value = v;
      highlightQuickBtn(v);
    }
  });

  /* ================================================================
     INIT
     ================================================================ */
  loadSettings();
})();
