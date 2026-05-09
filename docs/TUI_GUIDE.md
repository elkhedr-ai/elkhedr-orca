# Elkhedr Orca: TUI & Interface Guide

Elkhedr Orca features a rich, interactive Terminal User Interface (TUI) designed for maximum productivity and aesthetic appeal.

## 🎨 The TUI Experience

The TUI is powered by `@clack/prompts`, `chalk`, and `boxen`, providing:
- **Interactive Prompts:** A clean, modern input field for multi-step tasks.
- **Real-time Status:** Live feedback on which agent is currently working (e.g., `[Frontend React Expert] Building UI components`).
- **Formatted Reports:** Final outputs are rendered in elegant panels for readability.
- **Branded Splash:** A cyan-blue gradient splash screen upon startup.

## 🚀 How to Launch

### Interactive Mode (TUI)
Simply run the command without arguments:
```bash
orca
```

### CLI Mode (Single Shot)
Pass your prompt as an argument for a direct result:
```bash
orca "Write a summary of the project architecture"
```

## ⌨️ Navigation & Shortcuts
- **Enter:** Submit your task.
- **Ctrl+C / Esc:** Exit the Orca system gracefully.
- **Up/Down:** Navigate command history (if supported by terminal).

## 🛠️ Technical Details
- **Entry Point:** `src/tui.js` handles the UI loop.
- **Event Streaming:** The core `orchestrate` function in `src/index.js` supports an `onEvent` callback used by the TUI to update the spinner message in real-time.
