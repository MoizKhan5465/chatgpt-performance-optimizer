/**
 * ChatGPT Performance Optimizer v2.2 — Background Service Worker
 * Handles keyboard shortcuts, context menus, and badge updates.
 */

const CHATGPT_URL_PATTERNS = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];

// ── Performance Presets ──────────────────────────────────────────
const PRESETS = {
  mild: {
    label: 'Mild',
    visibleCount: 25,
    threshold: 30,
    killAnimations: false,
    lazyImages: false,
    optimizeCodeBlocks: false,
    cssContainment: true,
    autoDetect: true,
  },
  balanced: {
    label: 'Balanced',
    visibleCount: 15,
    threshold: 20,
    killAnimations: true,
    lazyImages: true,
    optimizeCodeBlocks: false,
    cssContainment: true,
    autoDetect: true,
  },
  aggressive: {
    label: 'Aggressive',
    visibleCount: 8,
    threshold: 12,
    killAnimations: true,
    lazyImages: true,
    optimizeCodeBlocks: true,
    cssContainment: true,
    autoDetect: true,
  },
  extreme: {
    label: 'Extreme',
    visibleCount: 3,
    threshold: 5,
    killAnimations: true,
    lazyImages: true,
    optimizeCodeBlocks: true,
    cssContainment: true,
    autoDetect: true,
  },
};

const PRESET_ORDER = ['mild', 'balanced', 'aggressive', 'extreme'];

// ── Context Menu Setup ───────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'cpo-toggle',
    title: '⚡ Toggle Performance Mode',
    contexts: ['page'],
    documentUrlPatterns: CHATGPT_URL_PATTERNS,
  });

  chrome.contextMenus.create({
    id: 'cpo-separator-1',
    type: 'separator',
    contexts: ['page'],
    documentUrlPatterns: CHATGPT_URL_PATTERNS,
  });

  PRESET_ORDER.forEach(key => {
    chrome.contextMenus.create({
      id: `cpo-preset-${key}`,
      title: `Preset: ${PRESETS[key].label}`,
      contexts: ['page'],
      documentUrlPatterns: CHATGPT_URL_PATTERNS,
    });
  });

  // Set default preset
  chrome.storage.local.get('cpo_preset', (data) => {
    if (!data.cpo_preset) {
      chrome.storage.local.set({ cpo_preset: 'balanced' });
    }
  });
});

// ── Context Menu Click Handler ───────────────────────────────────
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'cpo-toggle') {
    chrome.storage.local.get('cpo_enabled', (data) => {
      chrome.storage.local.set({ cpo_enabled: !data.cpo_enabled });
      updateBadge(!data.cpo_enabled);
    });
  }

  if (info.menuItemId.startsWith('cpo-preset-')) {
    const presetKey = info.menuItemId.replace('cpo-preset-', '');
    applyPreset(presetKey);
  }
});

// ── Keyboard Shortcut Handler ────────────────────────────────────
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-performance') {
    chrome.storage.local.get('cpo_enabled', (data) => {
      const newState = !data.cpo_enabled;
      chrome.storage.local.set({ cpo_enabled: newState });
      updateBadge(newState);
    });
  }

  if (command === 'cycle-preset') {
    chrome.storage.local.get('cpo_preset', (data) => {
      const current = data.cpo_preset || 'balanced';
      const idx = PRESET_ORDER.indexOf(current);
      const next = PRESET_ORDER[(idx + 1) % PRESET_ORDER.length];
      applyPreset(next);
    });
  }
});

// ── Apply Preset ─────────────────────────────────────────────────
function applyPreset(key) {
  const preset = PRESETS[key];
  if (!preset) return;

  chrome.storage.local.set({
    cpo_preset: key,
    cpo_visibleCount: preset.visibleCount,
    cpo_threshold: preset.threshold,
    cpo_killAnimations: preset.killAnimations,
    cpo_lazyImages: preset.lazyImages,
    cpo_optimizeCodeBlocks: preset.optimizeCodeBlocks,
    cpo_cssContainment: preset.cssContainment,
    cpo_autoDetect: preset.autoDetect,
    cpo_enabled: true,
  });

  updateBadge(true);
}

// ── Badge Update ─────────────────────────────────────────────────
function updateBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: enabled ? '#10b981' : '#6b7280' });
}

// ── Listen for state changes to update badge ─────────────────────
chrome.storage.onChanged.addListener((changes) => {
  if (changes.cpo_enabled) {
    updateBadge(changes.cpo_enabled.newValue);
  }
});

// ── Init badge on startup ────────────────────────────────────────
chrome.storage.local.get('cpo_enabled', (data) => {
  updateBadge(data.cpo_enabled || false);
});
