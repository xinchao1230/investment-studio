# Investment Studio

**AI-powered investment research workstation.** Organize work by *target* (the company you're tracking), not by chat thread. Every target gets a folder on disk and a dedicated AI analyst — **Stella** — who reads, writes, and files your notes for you. Local-first, file-based, MIT-licensed.

![Investment Studio Screenshot](screenshot.png)

## Highlights

- **Portfolio-first** — Research is organized by target; each target is a real folder you own.
- **Stella, your AI analyst** — Target-bound chat that writes notes into the right folder automatically.
- **7 research slash commands** — `/stock-analyze`, `/key-drivers`, `/earnings-review`, and more.
- **Autosave Markdown editor** — Monaco-powered, `Ctrl+S` / `Ctrl+E` / `Esc`.
- **Local-first** — Your data is plain files; `git`-able, portable, never locked in.
- **MCP + multi-model** — Any MCP server; Copilot, OpenAI, Azure, Claude, Gemini, Cohere, Ollama.
- **Cross-platform** — Windows, macOS, Linux.

## Quick Start

**Prereqs**: Node.js ≥ 18, Python ≥ 3.10 (some MCP servers), a GitHub Copilot subscription.

```bash
git clone https://github.com/xinchao1230/investment-studio.git
cd investment-studio
npm install              # Auto-rebuilds native modules*
npm run build            # Production build
npm run electron         # Launch — or `npm run dev:full` for HMR
```

\* Windows: [VS Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) · macOS: `xcode-select --install` · Linux: `sudo apt install build-essential`.

## The Three-Pane Workstation

| Pane | What it holds |
|------|---------------|
| **Left — Portfolio** | Tracked companies (e.g. `600519.SS Kweichow Moutai`, `00700.HK Tencent`, or `Pre-IPO`). |
| **Center — Workbench** | Multi-tab preview/editor for Markdown, CSV, and Excel. |
| **Right — Stella** | Target-bound chat. Switch to **Ask Stella** for global / screening questions. |

Each target ships with a standard folder layout for fundamental research (Notes / Expert Calls / Company Calls / Research Reports / Models / Disclosures / Other — `纪要 · 专家交流 · 公司交流 · 研报 · 模型 · 公告 · 其它` by default for China-market workflows). Drag-and-drop files in, watch external edits via chokidar, and your portfolio root is just:

```
{userData}/investment-studio-app/portfolio/
  BABA_Alibaba/
    研报/Morgan-Stanley-deep-dive.pdf
    纪要/2025-Q3-earnings-call.md
    key-drivers.md
```

## Built-in Research Skills

Seven slash commands, invocable from any chat:

| Command | What it does |
|---------|--------------|
| `/stock-analyze <ticker\|name>` | 6-phase deep equity report, written into the target folder |
| `/key-drivers <ticker\|name>` | Investment framework (thesis, tracking variables, valuation, risks) |
| `/earnings-review <ticker> <period>` | Quarterly earnings review vs. consensus |
| `/earnings-forecast <ticker>` | Revenue/profit prediction model with editable assumptions |
| `/marginal-tracking <ticker>` | Marginal changes in key metrics vs. last snapshot |
| `/industry-comparison <industry\|tickers>` | Horizontal peer comparison |
| `/stock-screening <tickers\|criteria>` | Quick fundamental screen (PE / ROE / growth) |

All are regular skills — inspect, fork, or build your own with the built-in `skill-creator`.

## Architecture

Electron multi-process: a Node **main** process (auth, MCP runtime, chat engine, filesystem, memory) and a React 18 + TailwindCSS **renderer** (three-pane UI), connected by a type-safe IPC framework. For the subsystem map and build internals, see [CLAUDE.md](./CLAUDE.md).

## Development

```bash
# Develop
npm run dev:full         # HMR dev mode (Vite)

# Build
npm run build            # Production build (main + renderer)
npm run electron         # Launch the built app

# Quality
npm run typecheck        # TypeScript check
npm run lint             # ESLint (lint:fix to auto-fix)
npm test                 # Unit tests (Vitest)
npm run test:e2e         # E2E tests (Playwright)

# Package installers (uses `npm run build` internally)
npm run dist             # Current platform
npm run dist:win         # Windows (NSIS + ZIP)
npm run dist:mac         # macOS (DMG + ZIP)
npm run dist:linux       # Linux (AppImage)
```

Branch convention: `user/<alias>/<feature>`. PRs and issues welcome on [GitHub](https://github.com/xinchao1230/investment-studio).

## License & Credits

[MIT License](LICENSE). Built on top of the open-source **Kosmos** desktop AI agent platform (MIT, © Microsoft Corporation), which provides the agent engine, MCP runtime, multi-model integration, memory, and Electron shell. Investment Studio adds the research workstation, portfolio model, and built-in research skills. See [NOTICE](NOTICE) for third-party attributions.

## Contact

Open an issue on [GitHub](https://github.com/xinchao1230/investment-studio/issues).
