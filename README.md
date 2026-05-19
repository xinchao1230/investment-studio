# Investment Studio

**Investment Studio** is an AI-powered investment research workstation for buy-side and sell-side analysts. It organizes work by *target* (a tracked company) — not by chat thread — and pairs every target with **Stella**, your AI investment analyst, who reads, writes, and organizes notes inside the right folder automatically. Local-first, file-based, MIT-licensed.

![Investment Studio Screenshot](screenshot.png)

## Quick Start

**Prereqs**: Node.js ≥ 18, Python ≥ 3.10 (for some MCP servers), GitHub Copilot subscription.

```bash
git clone https://github.com/xinchao1230/investment-studio.git
cd investment-studio
cp .env.example .env.local                 # Windows: copy .env.example .env.local
npm install
npx electron-rebuild                       # See platform build tools[1]
BRAND=investment-studio npm run dev:full   # Windows PowerShell: $env:BRAND='investment-studio'; npm run dev:full
```

[1] Windows: [VS Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) · macOS: `xcode-select --install` · Linux: `sudo apt install build-essential`.

## ✨ Highlights

- 📊 **Portfolio-first** — Research is organized by *target*; every target is a real folder on disk.
- 🤖 **Stella, your AI analyst** — Target-bound chat that edits notes inside the right folder automatically.
- ⚡ **7 research slash commands** — `/stock-analyze`, `/key-drivers`, `/earnings-review`, plus earnings forecast, industry comparison, marginal tracking, and fundamental screening.
- 📝 **Autosave Markdown editor** — Monaco-powered, debounced autosave with live status (`Ctrl+S` / `Ctrl+E` / `Esc`).
- 🏠 **Local-first & portable** — Your portfolio lives on disk, is `git`-able, and never locked in.
- 🔌 **MCP + multi-model** — Any MCP server (stdio/SSE/HTTP); GitHub Copilot, OpenAI, Azure OpenAI, Claude, Gemini, Cohere, Ollama.
- 🧠 **Long-term memory** — Local vector store remembers your investment style across sessions.
- 🖥️ **Cross-platform** — Windows, macOS, Linux.

## The Three-Pane Workstation

| Pane | What it holds |
|------|---------------|
| **Left — Portfolio** | Tracked companies, listed by ticker (e.g. `600519 贵州茅台`, `00700.HK 腾讯控股`) or as `未上市` for private names. Inline add by ticker/name with live suggestions. |
| **Center — Reading & Writing** | Multi-tab preview/editor (Markdown, CSV, Excel/Univer). Per-target tab order and the active tab persist across launches. |
| **Right — Stella** | Target-bound agent chat. Switch to **Ask Stella** for global screening / market questions. |

Panes are resizable and collapsible (`Ctrl/Cmd+B` for portfolio, `Ctrl/Cmd+/` for chat); widths, the last-active target, and reopened tabs persist across launches.

## Per-Target Research Workflow

Each target ships with a standardized folder structure tuned for fundamental research:
`纪要` · `专家交流` · `公司交流` · `研报` · `模型` · `公告` · `其它`.

Files support drag-and-drop with conflict resolution (skip / rename / overwrite) and explicit cross-target move confirmation. A chokidar-backed watcher reflects external edits (e.g. `git pull`) in real time. Deleting a target moves its folder to the OS trash; chat history previously bound to it survives as ordinary Ask Stella history.

Stella has two modes:
- **Workspace mode** — Bound to the active target; quick-start cards adapt (深度分析, 财报点评, 边际跟踪, 同业对比, 投资逻辑).
- **Ask Stella mode** — Global and target-agnostic. If Stella creates a target mid-conversation, the chat auto-migrates into Workspace mode — no copy/paste, no history lost.

The Ask tab lists every chat (both target-bound and global) in one chronological view, with a pill marking target-bound rows so you can find that "compass discussion three weeks ago" without remembering which target it lived under.

## ⚡ Built-in Research Skills

Seven preconfigured research skills ship as slash commands invocable from any chat — covering initiation, framework building, quarterly tracking, peer comparison, and screening:

| Command | What it does | Typical runtime |
|---------|--------------|-----------------|
| `/stock-analyze <ticker\|name>` | **6-phase deep equity report** — gathers data via `research-mcp`, writes a structured multi-section report into the target folder. | 1–3 min |
| `/key-drivers <ticker\|name>` | Builds an **investment framework** and writes `key-drivers.md` (thesis, tracking variables, valuation, risks). | ~30 s |
| `/earnings-review <ticker> <period>` | Quarterly **财报点评** — reads the filing, analyses beats / misses vs. consensus, and writes the review into the target's `纪要` folder. | ~1 min |
| `/earnings-forecast <ticker>` | Builds a **revenue / profit prediction model** with editable assumptions. | ~1 min |
| `/marginal-tracking <ticker>` | Tracks **marginal changes** in key metrics vs. the last snapshot. | ~30 s |
| `/industry-comparison <industry\|tickers>` | **Horizontal peer comparison** across an industry or a supplied list of tickers. | ~1 min |
| `/stock-screening <tickers\|criteria>` | Quick **fundamental screen** of a stock pool (PE / ROE / revenue growth, etc.). | ~30 s |

All are regular skills — inspect them, fork them, or build your own via the built-in `skill-creator`.

## 🔌 Tools, MCP & Models

- **MCP** — Connect any stdio / SSE / HTTP MCP server. Import server configs directly from VS Code settings.
- **30+ built-in tools** — Web search (Bing/Google), web fetch, file read/write/search, shell exec, Office parsing (`.docx` / `.xlsx` / `.pptx`).
- **Models** — GitHub Copilot (primary, OAuth device flow), OpenAI, Azure OpenAI, Claude, Gemini, Cohere, Ollama. Switch mid-conversation; streaming with typewriter animation.
- **Voice input** — Local Whisper STT with GPU acceleration (Vulkan on Windows/Linux, Metal on macOS).
- **Browser control** *(Windows, optional)* — Drive Chrome/Edge from chat via a companion extension.

## 📂 Where Your Portfolio Lives

Investment Studio uses an isolated user-data directory (`investment-studio-app`) so it installs side-by-side with other Kosmos-based apps. Your portfolio is just a folder tree:

```
{userData}/KOSMOS_PORTFOLIO/
  600519_贵州茅台/
    纪要/2025-Q3-业绩说明会.md
    研报/中金-深度.pdf
    模型/dcf.xlsx
    key-drivers.md
  00700.HK_腾讯控股/
    ...
```

You can `git init` inside that folder, back it up to OneDrive / Dropbox, or open it in VS Code — the app never locks you in.

## Architecture

Electron multi-process app: the **main** process (Node) handles auth, MCP runtime, chat engine, file system, and memory; the **renderer** (React 18 + TailwindCSS) hosts the three-pane workstation; they communicate via a type-safe IPC framework. Design principles: type-safe IPC (compile-time checked), lazy initialization for fast startup, non-fatal subsystem errors, per-profile isolation of auth / data / memory / skills.

For the full subsystem map, data flow, and build internals, see [CLAUDE.md](./CLAUDE.md).

## Development

```bash
# Dev / build
BRAND=investment-studio npm run dev:full         # Full dev mode with HMR
BRAND=investment-studio npm run build            # Production build

# Quality
npm test                                         # Jest unit tests
npm run test:e2e                                 # Playwright E2E tests
npm run lint                                     # Lint check (lint:fix to auto-fix)

# Distribution (installer for current or target platform)
npm run dist --brandname=investment-studio
npm run dist:win --brandname=investment-studio   # NSIS + ZIP
npm run dist:mac --brandname=investment-studio   # DMG + ZIP
npm run dist:linux --brandname=investment-studio # AppImage
```

**Workflow**: branch from `main` as `user/<alias>/<feature>`, PR back. Issues and PRs welcome on [GitHub](https://github.com/xinchao1230/investment-studio).

## License & Credits

Licensed under the [MIT License](LICENSE).

Built on top of the open-source **Kosmos** desktop AI agent platform (MIT, © Microsoft Corporation), which provides the agent engine, MCP runtime, multi-model integration, memory system, and Electron shell. Investment Studio extends Kosmos with the research workstation, portfolio model, and built-in research skills. See [NOTICE](NOTICE) for third-party attributions.

## Contact

Open an issue on [GitHub](https://github.com/xinchao1230/investment-studio/issues).