# Investment Studio — Unified Data Management Model

**Date:** 2026-05-16
**Status:** Approved
**Brand:** investment-studio

## Problem

Today's investment-studio data layout grew organically. Targets, chats, knowledge bases, agent config, AI-generated outputs, and user-attached inputs all live in different places with inconsistent conventions:

- Target directories have ad-hoc subdirs (`研报/`, `financials/`, `research/stock-analyze/`)
- AI drops scripts and `.venv/` into target roots
- User-attached files (PDFs, notes) stay in their original location — lost when user reinstalls or switches machine
- Chats get generic timestamp names ("Chat 21:26"), hard to recognize
- No place for cross-target shared resources (methodology, macro data, templates)

## Decision

Adopt a **three-tier knowledge model** with **soft conventions** (recommend structure via system prompt, don't enforce):

```
profile.json
└── chats[].agent: Stella
    └── knowledgeBase = @KOSMOS_PORTFOLIO_DIR

portfolio/                                  ← Agent KB (cross-target)
├── _shared/                                ← cross-target resources
│   ├── methodology/
│   ├── macro/
│   └── templates/
├── 阿里巴巴-W_09988.HK/                    ← Target KB
│   ├── profile.yaml | key-drivers.md
│   ├── notes.md | tracking.md
│   ├── inputs/                             ← user attachments (NEW)
│   ├── earnings/                           ← financial CSVs
│   ├── research/                           ← AI reports
│   └── models/                             ← scripts / models
└── ...

chatSessions/{sessionId}.json
├── targetCode + targetDir → binds to target
└── chat_history[] / context_history[]
```

### Binding Rules

- **Target ↔ ChatSession**: One target has N chat sessions. Each session binds via `targetCode`.
- **Files**: Belong to the target, not to any chat session. No per-chat subdirectory.
- **Auto-restore**: Selecting a target opens the last-active chat session for it (existing `lastActiveChatByTarget`).

## Changes

### 1. Target directory template

`portfolio_init_target` creates additionally:
- `inputs/` — user-attached files
- `research/` — AI-generated reports

Existing template files (`profile.yaml`, `key-drivers.md`, `notes.md`, `tracking.md`, `earnings/`, `models/`) unchanged.

### 2. `_shared/` initialization

On first launch under investment-studio brand, ensure `portfolio/_shared/{methodology,macro,templates}/` exists. Empty directories OK — gives users a place to drop cross-target notes.

### 3. System prompt enrichment

When chat has target binding, append directory conventions section:
- List recommended subdirs and their purpose
- Naming guidelines (`{date}-{topic}.md`, `fetch_*.py` / `analyze_*.py`)
- "Reuse existing structure; create new directories only when none fit"

Soft constraint — AI may deviate but defaults to convention.

### 4. Attachment auto-archive

New IPC `researchChat:archiveAttachment(filePaths[], targetDir) → archivedPaths[]`.

When user attaches files in a research-bound chat:
1. Renderer detects research workspace context (chat has `targetCode`)
2. Calls IPC to copy each file into `{targetDir}/inputs/{filename}` (collision: append `_2`, `_3`)
3. Message references the archived path, not the original
4. System prompt tells AI: "User attachments are in `inputs/`. Use `read_file` to load."

Non-research chats: unchanged behavior (path reference only).

### 5. Auto-title

Verify `ChatSessionTitleLlmSummarizer` runs for investment-studio brand. If gated off, enable it. Triggers on first user message; replaces "New Chat" with LLM-summarized topic.

## Not Changed

- No hard enforcement of directory structure (AI can still create custom dirs)
- No per-chat-session output isolation (files belong to target)
- No file references rewriting in chat history (archive only on new attachments)
- `portfolio_init_target` keeps same idempotency rules
- Existing target dirs not migrated (no retroactive `inputs/` creation)

## Files to Modify

| # | File | Change |
|---|------|--------|
| 1 | `src/main/lib/mcpRuntime/builtinTools/portfolioTools.ts` | Add `inputs/`, `research/` to init template; ensure `_shared/` on brand init |
| 2 | `src/main/lib/chat/agentChat.ts` | Append target directory conventions to system prompt |
| 3 | `src/main/investmentStudio/index.ts` | New IPC `researchChat:archiveAttachment` |
| 4 | `src/main/preload.ts` | Expose `archiveAttachment` to renderer |
| 5 | `src/renderer/components/chat/ChatInput.tsx` | Call archive IPC when adding files in research chat |
| 6 | `src/main/lib/userDataADO/types/profile.ts` | Update Stella system prompt with directory conventions |
| 7 | `src/main/lib/chat/...` (auto-title) | Verify/enable `ChatSessionTitleLlmSummarizer` for brand |

## Open Questions

- Should `_shared/` initialization run on every app start, or once via FRE? → Use idempotent `mkdirSync(recursive)`; cheap to run every start.
- Should AI be able to write to `_shared/`? → Yes, no restriction. AI dropping methodology notes there is desirable.
