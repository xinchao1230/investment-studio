# Investment Studio

**Investment Studio** is an AI-powered investment research workstation for buy-side and sell-side analysts. It organizes your work by *target* (a company you're researching) instead of chat threads, gives every target its own on-disk file workspace, and pairs it with **Stella** — your AI investment analyst — who can run deep equity reports, build investment frameworks, and edit your notes alongside you.

It runs entirely on your desktop, keeps every artifact as a plain folder you own (git-able, portable), and connects to live market data and the broader AI ecosystem through MCP servers, skills, and multi-model support.

![Investment Studio Screenshot](screenshot.png)

## ✨ Highlights

- 📊 **Portfolio-first workflow** — Organize research by *target* (a tracked company), not by chat thread. Every target is a real folder on disk.
- 🤖 **Stella, your AI analyst** — Target-bound AI chat that reads, writes, and organizes notes inside the right folder automatically.
- ⚡ **Research slash commands** — `/stock-analyze`, `/deep-report`, `/key-drivers` for one-line deep equity reports, lightweight due diligence, and investment frameworks.
- 📝 **Autosave Markdown editor** — Monaco-powered editor with debounced autosave, live status indicator, and `Ctrl+E` / `Esc` shortcuts.
- 🏠 **Local-first** — Runs on your machine. Your portfolio stays on your device, version-controllable, and never locked in.
- 🔌 **MCP + multi-model** — Plug in any MCP tool server (stdio/SSE/HTTP); switch between GitHub Copilot, OpenAI, Azure OpenAI, Anthropic Claude, Google Gemini, Cohere, and Ollama.
- 🧠 **Long-term memory** — Stella remembers your investment style, watchlist preferences, and prior discussions across sessions.
- 🖥️ **Cross-platform** — Windows, macOS, and Linux.

## The Three-Pane Workstation

Investment Studio is designed around the way an analyst actually works:

| Pane | What it holds |
|------|---------------|
| **Left — Portfolio** | Your tracked companies, each expandable into a standardized research file tree (纪要 / 专家交流 / 公司交流 / 研报 / 模型 / 公告 / 其它). |
| **Center — Reading & Writing** | Multi-tab preview/editor for whichever research artifact you're working on (Markdown notes, CSV exports, Excel/Univer models). |
| **Right — Stella** | Full agent chat scoped to the active target. Switch to **Ask Stella** mode for global screening / market questions. |

All three panes are resizable and collapsible (`Ctrl/Cmd+B` collapses the portfolio, `Ctrl/Cmd+/` collapses the chat); widths and the last-active target persist across launches.

## 🏢 Portfolio & Target Management
- **Targets, not chats** — Each target is a real folder on disk, so everything you produce stays portable and version-controllable outside the app.
- **Listed & unlisted companies** — First-class support for both publicly-listed tickers (e.g. `600519 贵州茅台`, `00700.HK 腾讯控股`) and unlisted/private companies. The sidebar transparently shows `未上市` instead of a ticker for private targets.
- **Inline add by ticker or name** — Type in the search combobox at the top of the sidebar; ticker suggestions resolve in real time. Empty portfolio auto-opens the add form so first-launch UX is one keystroke away.
- **Trash-to-recycle-bin deletion** — Removing a target moves its folder to the OS trash (not permanent delete), and any chat sessions previously bound to it survive as ordinary “Ask Stella” history rather than dangling rows.

## 🗂️ Per-Target Research File Tree
- **Standardized sub-folders** — Every target ships with a fixed category structure tuned for fundamental research:
  - `纪要` (meeting minutes)
  - `专家交流` (expert calls)
  - `公司交流` (company calls / IR)
  - `研报` (sell-side reports)
  - `模型` (financial models)
  - `公告` (filings & announcements)
  - `其它` (other)
- **Drag & drop, rename, move across targets** — Full file-tree interactions with conflict resolution (skip / rename / overwrite) and an explicit cross-target move confirmation so you can't accidentally drag last quarter's model into the wrong company.
- **Realtime filesystem sync** — A chokidar-backed watcher reflects external edits (e.g. you opened a `.md` in another editor, or `git pull` brought new files) without forcing a manual refresh.

## 📝 Multi-Tab Editor with Autosave
- **Open many files per target** — Markdown notes, CSV exports, and Univer spreadsheets each get a tab. Tab order and the active tab persist per target, so switching targets restores exactly where you left off.
- **Monaco-powered Markdown editor** — Toggle between rendered preview and a real code editor with word wrap, find/replace, and syntax highlighting.
- **Autosave + live status indicator** — Edits flush to disk on a 500 ms debounce. The toolbar shows `保存中…` while writing, `未保存` during the debounce window, and `已保存 HH:MM:SS` when on disk. `Ctrl+S` triggers an immediate save; `Esc` exits edit mode (two-step: first press blurs the editor, second press returns to preview); `Ctrl+E` toggles edit/preview.
- **Safe by default** — Pending autosaves flush on tab close, target switch, and window close, so you never lose keystrokes. Downloading a dirty file auto-flushes first.

## 🤖 Stella — Your AI Investment Analyst
- **Target-bound chat** — The right pane is a full agent chat that automatically scopes to whichever target you've selected. Stella reads/writes inside the target's folder, so notes she produces land in the right place automatically.
- **Two modes**:
  - **Workspace mode** — Chat is bound to the active target; quick-start cards adapt to it (深度分析, 财报点评, 边际跟踪, 同业对比, 投资逻辑).
  - **Ask Stella mode** — Global, target-agnostic chat for screening, market questions, or starting a new target (“帮我研究下海底捞”). If Stella decides to create a target during the conversation, the UI auto-migrates the chat into Workspace mode bound to the new target — no copy/paste, no chat history lost.
- **Unified chat history** — The Ask tab shows every chat in one chronological list (both target-bound and global), with a small pill in front of target-bound rows so you can find that “compass discussion three weeks ago” without remembering which target it was under.
- **Long-term memory** — A local vector store remembers your investment style, watchlist preferences, and prior discussions across sessions (gated by feature flag).

## ⚡ Built-in Research Skills (Slash Commands)
Investment Studio ships three preconfigured research skills as slash commands you can invoke from any chat:

| Command | What it does | Typical runtime |
|---------|--------------|-----------------|
| `/stock-analyze <ticker\|name>` | Full **6-phase deep equity report** — gathers data via `research-mcp`, writes a structured multi-section report into the target folder. | 1–3 min |
| `/deep-report <name>` | **Lightweight due-diligence** snapshot — fast, no `research-mcp` dependency, runs against general web/knowledge tools. | seconds |
| `/key-drivers <ticker\|name>` | Builds an **investment framework** and writes `key-drivers.md` with short-term / long-term thesis, tracking variables, valuation, and risks. | ~30 s |

All three are regular skills — you can inspect them, fork them, or build your own following the same pattern via the built-in `skill-creator`.

## 🔌 MCP & Tools
- **Universal MCP support** — Connect to any MCP server via stdio, SSE, or HTTP transport. Import server configs directly from VS Code settings.
- **30+ built-in tools** — Web search (Bing/Google), web fetch, file read/write/search, shell command execution, Office document parsing (`.docx` / `.xlsx` / `.pptx`), and more — available to Stella by default.
- **Browser control (Windows, optional)** — Drive your local Chrome/Edge from chat via a companion extension.
- **Voice input** — Speech-to-text powered by Whisper, running locally with GPU acceleration (Vulkan on Windows/Linux, Metal on macOS).

## 🌐 Multi-Model AI Support
- **GitHub Copilot** — First-class integration with OAuth device flow authentication (primary provider).
- **Other providers** — OpenAI, Azure OpenAI, Google Gemini, Anthropic Claude, Cohere, and Ollama.
- **Model switching** — Change models mid-conversation without losing context.
- **Streaming responses** — Real-time token streaming with typewriter animation.

## 🪟 Workstation UX Touches
- **Three resizable, collapsible panes** — Drag the dividers, or use `Ctrl/Cmd+B` to collapse the portfolio and `Ctrl/Cmd+/` to collapse the chat. Pane widths and collapsed state persist across launches.
- **Last-active target restored** — On startup, the app re-selects whichever target you were on, expands the same sub-folders, and reopens the same tab — even after a full restart.
- **Settings in a standalone window** — Opening Settings spawns a separate window instead of unmounting the research workspace, so your in-progress edits and pane layout stay intact when you tweak a setting.
- **Glass-morphism + research theme** — Status pills for 边际改善 / 边际承压 / 边际恶化, accent colors tuned for long reading sessions, multi-tab chat, and seamless in-app auto-update.

## 📂 Where Your Portfolio Lives
Investment Studio uses an isolated user-data directory (`investment-studio-app`) so it installs side-by-side with other Kosmos-based apps. Your portfolio is just a folder tree on disk:

```
{userData}/KOSMOS_PORTFOLIO/
  600519_贵州茅台/
    纪要/2025-Q3-业绩说明会.md
    研报/中金-深度.pdf
    模型/dcf.xlsx
    key-drivers.md
    tracking.md
  00700.HK_腾讯控股/
    ...
```

You can `git init` inside that folder, back it up to OneDrive / Dropbox, or open it in VS Code — the app never locks you in.

## Getting Started

### Prerequisites

- **Node.js** 18.0.0 or later
- **Python** 3.10 or later (for some MCP servers)
- **GitHub Copilot** subscription (primary AI provider)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/xinchao1230/investment-studio.git
   cd investment-studio
   ```

2. **Configure environment variables**
   ```bash
   # Windows
   copy .env.example .env.local

   # macOS/Linux
   cp .env.example .env.local
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Rebuild native modules for Electron**
   ```bash
   npx electron-rebuild
   ```

   > **Build tools required**: Windows needs [VS Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/), macOS needs `xcode-select --install`, Linux needs `sudo apt install build-essential`.

### Quick Start

Investment Studio is shipped as a brand of the underlying Kosmos platform; the build scripts pick the brand via the `BRAND` environment variable.

```bash
# One-command development mode (recommended)
BRAND=investment-studio npm run dev:full

# Or start components separately
BRAND=investment-studio npm run dev          # Terminal 1: webpack-dev-server with HMR
BRAND=investment-studio npm run dev:main     # Terminal 2: Main process watch mode
BRAND=investment-studio npm run electron:dev # Terminal 3: Launch Electron
```

> **Windows PowerShell**: use `$env:BRAND='investment-studio'; npm run dev:full` instead.

Production build & installer:
```bash
BRAND=investment-studio npm run build
npm run dist --brandname=investment-studio   # Installer for current platform
```

## Architecture

Investment Studio is built on Electron with a clean multi-process architecture:

```
src/
├── main/                # Electron main process
│   └── lib/
│       ├── auth/        # GitHub Copilot OAuth authentication
│       ├── chat/        # Agent conversation engine
│       ├── mcpRuntime/  # MCP server lifecycle & built-in tools
│       ├── mem0/        # Long-term memory (vector + graph)
│       ├── featureFlags/# Feature flag system
│       ├── workspace/   # File tree & ripgrep search
│       └── userDataADO/ # Profile & data persistence
├── renderer/            # React 18 + TailwindCSS UI
│   ├── components/      # Research workstation, chat, agents, settings
│   │   └── research/    # Three-pane workstation (portfolio / tabs / Stella)
│   ├── atom/            # Custom atom-based state management
│   └── lib/             # Frontend utilities
├── shared/              # Type-safe IPC framework & constants
└── brands/              # Per-brand configuration (icons, app id, etc.)
    └── investment-studio/
```

**Key design principles:**
- **Type-safe IPC** — Renderer ↔ Main communication is fully typed at compile time.
- **Lazy initialization** — All heavy managers use lazy getters for fast startup.
- **Non-fatal errors** — Subsystem failures are logged, never crash the app.
- **Per-profile isolation** — Auth, data, memory, and skills are scoped per user.

For full architectural details, see [CLAUDE.md](./CLAUDE.md).

## Development

### Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/xinchao1230/investment-studio).

### Workflow

```bash
git switch main && git pull
git checkout -b user/<your-alias>/<feature-name>
# Make changes, then submit PR
```

### Commands

```bash
# Development
BRAND=investment-studio npm run dev:full         # Full dev mode with HMR
BRAND=investment-studio npm run build            # Production build

# Testing & Quality
npm test                 # Jest unit tests
npm run test:e2e         # Playwright E2E tests
npm run lint             # Lint check
npm run lint:fix         # Auto-fix

# Distribution
npm run dist --brandname=investment-studio       # Installer for current platform
npm run dist:win --brandname=investment-studio   # Windows (NSIS + ZIP)
npm run dist:mac --brandname=investment-studio   # macOS (DMG + ZIP)
npm run dist:linux --brandname=investment-studio # Linux (AppImage)
```

## License

This project is licensed under the [MIT License](LICENSE).

## Credits

Investment Studio is built on top of the open-source **Kosmos** desktop AI agent platform (MIT licensed, copyright Microsoft Corporation). The Kosmos platform provides the underlying agent engine, MCP runtime, multi-model integration, memory system, and Electron shell that Investment Studio extends with its research-specific workstation, portfolio model, and built-in research skills.

See [NOTICE](NOTICE) for full third-party software attributions.

## Contact

For questions, bug reports, or feature requests, please open an issue on [GitHub](https://github.com/xinchao1230/investment-studio/issues).