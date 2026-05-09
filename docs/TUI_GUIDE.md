# Elkhedr Orca: TUI & Interface Guide

Elkhedr Orca features a rich, interactive Terminal User Interface (TUI) designed for maximum productivity and aesthetic appeal.

## 🎨 Premium TUI Experience

The TUI provides a world-class interface inspired by Claude and OpenCode:
- **Responsive Layout:** Dynamically centers content based on terminal width.
- **Interactive Status Bar:** Displays:
  - **Cost ($):** Live estimation of API costs.
  - **Threads:** Number of background agents actively processing.
  - **Agent:** The currently active subagent's role.
  - **Sandbox:** Security status indicator.
- **Branded Splash:** High-fidelity ASCII art with blue-gradient effects.
- **Formatted Reports:** Executive summaries in high-impact double-bordered panels.

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
