/**
 * ChatGPT Performance Optimizer v2.3 — Background Service Worker
 * Manages keyboard commands, context menus, and sync configurations.
 */

// Target domains for injecting performance overlays and enabling menu actions
const URL_PATTERNS = [
  'https://chatgpt.com/*',
  'https://www.chatgpt.com/*',
  'https://chat.openai.com/*',
  'https://claude.ai/*',
  'https://gemini.google.com/*'
];

// --- Preset Rules (aligned with L1-L8 engine config) ---
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

// --- Setup Context Menus ---
chrome.runtime.onInstalled.addListener(() => {
  // Main Toggle Option
  chrome.contextMenus.create({
    id: 'cpo-toggle',
    title: '⚡ Toggle Performance Mode',
    contexts: ['page'],
    documentUrlPatterns: URL_PATTERNS,
  });

  // Separator
  chrome.contextMenus.create({
    id: 'cpo-separator-1',
    type: 'separator',
    contexts: ['page'],
    documentUrlPatterns: URL_PATTERNS,
  });

  // Preset Selections
  PRESET_ORDER.forEach(key => {
    chrome.contextMenus.create({
      id: `cpo-preset-${key}`,
      title: `Preset: ${PRESETS[key].label}`,
      contexts: ['page'],
      documentUrlPatterns: URL_PATTERNS,
    });
  });

  // Default preset setup
  chrome.storage.sync.get('cpo_preset', (data) => {
    if (!data.cpo_preset) {
      chrome.storage.sync.set({ cpo_preset: 'balanced' });
    }
  });
});

// --- Context Menu Actions ---
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'cpo-toggle') {
    chrome.storage.sync.get('cpo_enabled', (data) => {
      const newState = !data.cpo_enabled;
      chrome.storage.sync.set({ cpo_enabled: newState });
      updateBadge(newState);
    });
  }

  if (info.menuItemId.startsWith('cpo-preset-')) {
    const presetKey = info.menuItemId.replace('cpo-preset-', '');
    applyPreset(presetKey);
  }
});

// --- Keyboard Shortcuts Listener ---
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-performance') {
    chrome.storage.sync.get('cpo_enabled', (data) => {
      const newState = !data.cpo_enabled;
      chrome.storage.sync.set({ cpo_enabled: newState });
      updateBadge(newState);
    });
  } else if (command === 'toggle-floating-button') {
    // Alt+Shift+P keyboard shortcut to toggle visibility of floating button
    chrome.storage.sync.get('cpo_showFloatingBtn', (data) => {
      const current = data.cpo_showFloatingBtn !== undefined ? data.cpo_showFloatingBtn : true;
      chrome.storage.sync.set({ cpo_showFloatingBtn: !current });
    });
  } else if (command === 'cycle-preset') {
    chrome.storage.sync.get('cpo_preset', (data) => {
      const current = data.cpo_preset || 'balanced';
      const idx = PRESET_ORDER.indexOf(current);
      const next = PRESET_ORDER[(idx + 1) % PRESET_ORDER.length];
      applyPreset(next);
    });
  }
});

// --- Apply Preset configuration to synced storage ---
function applyPreset(key) {
  const preset = PRESETS[key];
  if (!preset) return;

  chrome.storage.sync.set({
    cpo_preset: key,
    cpo_visibleCount: preset.visibleCount,
    cpo_threshold: preset.threshold,
    
    // Set layer config matching preset values
    cpo_layer_killAnimations: preset.killAnimations,
    cpo_layer_lazyImages: preset.lazyImages,
    cpo_layer_optimizeCodeBlocks: preset.optimizeCodeBlocks,
    cpo_layer_cssContainment: preset.cssContainment,
    cpo_layer_autoDetect: preset.autoDetect,
    cpo_enabled: true, // Preset activation implicitly enables performance engine
  });

  updateBadge(true);
}

// --- Badge UI Manager ---
function updateBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: enabled ? '#7C3AED' : '#6B7280' }); // Electric Purple badge on active
}

// --- Sync state changes to Action Badge ---
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.cpo_enabled) {
    updateBadge(changes.cpo_enabled.newValue);
  }
});

// --- Load Badge state on startup ---
chrome.storage.sync.get('cpo_enabled', (data) => {
  updateBadge(data.cpo_enabled || false);
});
