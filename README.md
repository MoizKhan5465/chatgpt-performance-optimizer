<p align="center">
  <img src="icons/icon128.png" alt="CPO Logo" width="80" />
</p>

<h1 align="center">⚡ ChatGPT Performance Optimizer</h1>

<p align="center">
  <strong>A production-ready Chrome Extension (Manifest V3) that dramatically reduces lag in the ChatGPT web interface.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue?style=flat-square" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/Version-2.2-green?style=flat-square" alt="Version 2.2" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
  <img src="https://img.shields.io/badge/Chrome-Extension-red?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome Extension" />
</p>

---

## 🚀 The Problem

Long ChatGPT conversations become **painfully slow**. As messages pile up, the DOM grows to 10,000+ nodes, causing:

- ⏱️ Input lag when typing
- 🐌 Slow scrolling and rendering
- 💾 High memory usage
- 🔥 CPU spikes during streaming responses

## 💡 The Solution

**ChatGPT Performance Optimizer** uses an **8-layer optimization engine** that intelligently reduces DOM overhead, kills unnecessary animations, and virtualizes old messages — all without breaking any ChatGPT functionality.

---

## ✨ Features

### 🎯 8 Optimization Layers

| Layer | Name | What It Does |
|-------|------|-------------|
| **L1** | DOM Virtualization | Detaches old messages from the DOM (not just `display:none`) and replaces them with lightweight comment placeholders |
| **L2** | CSS Containment | Applies `contain: layout style paint` and `content-visibility: auto` to isolate each message's rendering |
| **L3** | Animation Killer | Disables all CSS animations, transitions, backdrop filters, and box shadows globally |
| **L4** | Code Block Optimizer | Flattens syntax-highlighted code blocks (removes hundreds of `<span>` nodes) with expandable previews |
| **L5** | Lazy Image Loading | Uses `IntersectionObserver` to defer loading of off-screen images |
| **L6** | Streaming Throttle | Dynamically adjusts mutation observation frequency during ChatGPT response streaming |
| **L7** | Idle Scheduler | Uses `requestIdleCallback` to schedule non-critical optimization work |
| **L8** | Memory Pressure Monitor | Auto-activates Performance Mode when DOM node count exceeds 15,000 |

### 🎛️ Advanced Controls

- **4 Performance Presets** — Mild (25 msgs) → Balanced (15) → Aggressive (8) → Extreme (3)
- **Custom Message Count** — Keep anywhere from 1 to 100 messages visible
- **Quick Select Buttons** — One-click presets: 3, 5, 10, 15, 20, 30, 50
- **Per-Layer Toggles** — Enable/disable each optimization layer independently
- **Auto-Trigger Threshold** — Configure when auto-detection kicks in (5-80 messages)

### ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+P` | Toggle Performance Mode on/off |
| `Ctrl+Shift+O` | Cycle through performance presets |

### 📊 Real-Time Stats

- **Live DOM node counter** (before/after optimization)
- **DOM reduction percentage bar**
- **Message count** (total / visible / hidden)
- **Layer status indicators** (✅ Active / ⬜ Off)
- **Streaming detection** indicator
- **Hover stats panel** on the in-page status badge

### 🖱️ Right-Click Context Menu

Right-click on any ChatGPT page to:
- Toggle Performance Mode
- Switch between presets (Mild / Balanced / Aggressive / Extreme)

---

## 📦 Installation

### From Source (Developer Mode)

1. **Clone the repository**
   ```bash
   git clone https://github.com/MoizKhan5465/chatgpt-performance-optimizer.git
   ```

2. **Open Chrome Extensions**
   - Navigate to `chrome://extensions/`
   - Enable **Developer mode** (top-right toggle)

3. **Load the extension**
   - Click **"Load unpacked"**
   - Select the `chatgpt-performance-optimizer` folder

4. **Done!** Visit [chatgpt.com](https://chatgpt.com) — the extension activates automatically.

---

## 🗂️ Project Structure

```
chatgpt-performance-optimizer/
├── manifest.json              # Extension configuration (Manifest V3)
├── README.md                  # This file
│
├── background/
│   └── service_worker.js      # Keyboard shortcuts, context menus, presets, badge
│
├── content/
│   ├── content.js             # Main optimization engine (8 layers)
│   └── styles.css             # Injected styles (floating button, badges, panels)
│
├── popup/
│   ├── popup.html             # Settings UI with preset grid & stats
│   └── popup.js               # Popup logic, storage sync, live updates
│
└── icons/
    ├── icon16.png             # Toolbar icon
    ├── icon48.png             # Extensions page icon
    └── icon128.png            # Chrome Web Store icon
```

---

## 🔧 How It Works

### Activation Flow

```
Page Load → Load Settings → Create UI Elements
                ↓
        MutationObserver starts watching
                ↓
    New messages detected? → Smart Detection check
                ↓
    Message count ≥ threshold? → Auto-activate Performance Mode
                ↓
    L1: Detach old messages from DOM
    L2: Apply CSS containment
    L3: Kill animations & transitions
    L4: Flatten code blocks (idle-scheduled)
    L5: Lazy-load off-screen images
    L6: Throttle during streaming
    L7: Schedule via requestIdleCallback
    L8: Monitor memory pressure
                ↓
    Broadcast stats to popup → Update badge
```

### SPA Navigation Handling

ChatGPT is a Single Page Application. The extension watches for URL changes via `MutationObserver` and re-initializes all optimizations when switching between conversations.

### Extension Context Safety

When Chrome reloads the extension, old content scripts become "orphaned." This extension uses a `safeChromeCall()` wrapper and `contextValid` flag to gracefully clean up orphaned instances without throwing errors.

---

## ⚙️ Configuration

### Via Popup UI

Click the extension icon in the toolbar to access:

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| Performance Mode | Off | On/Off | Master toggle for all optimizations |
| Visible Messages | 15 | 1-100 | Number of recent messages to keep in DOM |
| Auto-Trigger Threshold | 20 | 5-80 | Message count that triggers auto-activation |
| Smart Detection | On | On/Off | Auto-enable when lag is detected |
| Kill Animations | On | On/Off | Disable CSS animations & transitions |
| CSS Containment | On | On/Off | Apply layout/paint containment |
| Code Optimizer | On | On/Off | Flatten syntax highlighting |
| Lazy Images | On | On/Off | Defer off-screen image loading |
| Floating Button | On | On/Off | Show on-page toggle button |

### Via Presets

| Preset | Visible Msgs | Threshold | Animations | Code Opt | Images |
|--------|-------------|-----------|------------|----------|--------|
| 🌿 Mild | 25 | 30 | Keep | Keep | Keep |
| ⚖️ Balanced | 15 | 20 | Kill | Keep | Lazy |
| 🔥 Aggressive | 8 | 12 | Kill | Flatten | Lazy |
| 💀 Extreme | 3 | 5 | Kill | Flatten | Lazy |

---

## 🛠️ Technical Details

### Permissions

| Permission | Why |
|-----------|-----|
| `storage` | Persist settings and sync stats between popup and content script |
| `contextMenus` | Right-click menu integration on ChatGPT pages |
| Host: `chatgpt.com/*` | Inject content scripts into ChatGPT |
| Host: `chat.openai.com/*` | Support legacy OpenAI domain |

### Browser Compatibility

- ✅ Google Chrome 102+
- ✅ Microsoft Edge 102+
- ✅ Brave Browser
- ✅ Any Chromium-based browser supporting Manifest V3

---

## 📝 Changelog

### v2.2 (Current)
- ⚡ Reduced self-overhead from frequent full-page DOM counting via caching/dirty tracking
- 🧠 Smarter live setting updates (incremental layer updates instead of full restore/reapply loops)
- 🔐 More robust message detachment with stable per-message keys (safer during DOM reshuffles)
- 🧹 Improved lifecycle cleanup by disconnecting SPA navigation observer during teardown
- 🌐 Popup now avoids external font dependency (better privacy/offline reliability)
- 🎛️ Preset UX update: non-preset slider/toggle changes are explicitly tracked as **Custom**
- 📚 Docs/version consistency refreshed across extension files and UI

### v2.1
- 🛡️ Fixed "Extension context invalidated" errors
- 🛡️ Fixed invalid CSS selector crash in streaming detection
- 📊 DOM node counting now excludes extension's own UI elements
- 📊 Status badge shows accurate layer status instead of misleading "0 nodes saved"
- 🧹 Graceful cleanup when extension is reloaded

### v2.0
- 🚀 8-layer optimization engine
- ⌨️ Keyboard shortcuts (Ctrl+Shift+P, Ctrl+Shift+O)
- 🖱️ Right-click context menu with preset selection
- 🎛️ Performance presets (Mild/Balanced/Aggressive/Extreme)
- 🔢 Custom message count (1-100) with quick-select buttons
- 📊 Redesigned popup with live stats and DOM reduction bar
- 🔄 Background service worker with badge updates

### v1.0
- Initial release with basic message collapsing
- Floating toggle button
- MutationObserver-based detection

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## 👤 Author

**Moiz Khan** — [GitHub](https://github.com/MoizKhan5465)

---

<p align="center">
  <strong>⚡ Made to make ChatGPT fast again.</strong>
</p>
