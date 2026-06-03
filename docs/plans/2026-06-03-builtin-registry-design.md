# Built-in Registry Design (Option B)

**Date:** 2026-06-03
**Status:** Approved, agents stage in progress
**Scope:** Decouple built-in sub-agents and skills from per-user profile storage. Make them read-only assets shipped with the app, surfaced via in-memory registries.

---

## 1. Problem

Built-in sub-agents disappear after switching from skip-login to GitHub Copilot login.

**Root cause.** Built-ins are seeded *per user profile directory* (`profiles/<alias>/agents/...`) on every sign-in. The cache layer keys by alias. Two login modes ⇒ two distinct profile dirs ⇒ a cache lookup against the new alias finds an empty `agents/` directory until the seeder finishes, and chat-allowlist references (`chat.agent.sub_agents`) point at names that aren't registered in the new profile.

The real smell isn't the cache: it's that **immutable assets that ship inside the app binary are persisted into mutable per-user storage and then have to be re-seeded on every login.**

## 2. Decision

Built-ins live in two places only:

| Asset | Source path | Lifetime |
|---|---|---|
| Built-in agent | `<resources>/examples/agents/<name>/AGENT.md` | Bundled with app, read-only |
| Built-in skill | `<resources>/examples/skills/<name>/` and `<app>/skills/<name>/` | Bundled with app, read-only |
| User agent | `<userData>/profiles/<alias>/agents/<name>/AGENT.md` | User-owned, mutable |
| User skill | `<userData>/profiles/<alias>/skills/<name>/` | User-owned, mutable |

Two main-process singletons expose built-ins:

- `BuiltinAgentRegistry` — scans built-in agent dirs once, caches `SubAgentConfig[]`.
- `BuiltinSkillRegistry` — same shape for skills.

Both have `source: 'BUILTIN'` on every emitted record.

`profile.sub_agents` and `profile.skills` arrays become **user-only**. The seeders that copied built-ins into the profile and registered them there are deleted.

## 3. Read path

Every consumer that previously read user-only sub-agents/skills now reads a merged view: built-ins first, then user. On name collision, built-in wins (a user entry with a reserved name is rejected at the write boundary).

- `profileCacheManager.getSubAgents()` returns `[...builtinAgentRegistry.list(brand), ...userAgentsFromProfileDir]`.
- `SubAgentManager.spawnSubAgent` / `AgentChat.getSubAgentConfig` resolve `AGENT.md` from the built-in dir when the name is reserved, otherwise from `profiles/<alias>/agents/<name>/`.
- Skill resolution follows the same fallback: built-in dir first if the name is reserved, else `profiles/<alias>/skills/<name>/`.

Built-in agents and skills are **always available in every chat**, independent of `chat.agent.sub_agents` / `chat.agent.skills`. The per-chat allowlists continue to apply to user-created entries only. (Trade-off: users lose the ability to remove a built-in from a single chat. Acceptable — the previous behaviour did not let them remove the agent globally either.)

## 4. Write path

`subAgent:add`, `subAgent:update`, `subAgent:delete`, `subAgent:importFromFile`, and the equivalent skill IPCs all reject any request whose `name` is in the matching registry. The UI shows built-ins as non-editable (no edit/delete affordance). The reject is a defense-in-depth guard, not the primary UX.

## 5. Deletions

- `src/main/lib/subAgent/builtinAgentSeeder.ts` — delete.
- `src/main/lib/skill/builtinSkillSeeder.ts` — delete.
- `runPostLoginSeeders` in `src/main/investmentStudio/index.ts` — delete steps 2 (`seedBuiltinSkills`) and 3 (`seedBuiltinAgents`). Keep step 1 (`seedResearchMcpIfMissing`), step 4 (portfolio dirs), step 5 (research-mcp venv).
- `src/main/startup/ipc/auth.ts` — delete the two inline `seedBuiltinSkills` invocations (lines ~123 and ~335).
- `registerBuiltinSkillsIpc` and the `builtinSkills:seed` IPC handler in `investmentStudio/index.ts` — delete.
- Per-user `chat.agent.skills` / `chat.agent.sub_agents` auto-attach logic inside the seeders — gone with the seeders.

## 6. Migration

None. User data on disk (`profile.skills`, `profile.sub_agents`, the physical `profiles/<alias>/agents/` and `profiles/<alias>/skills/` directories) is left as-is. Built-in entries that were previously seeded into the profile are now duplicates of the registry view; `getSubAgents()` and the skill reader prefer the registry copy, so the on-disk duplicates are simply ignored. A future commit may garbage-collect them; not required for correctness.

User instruction: a clean userdata wipe is acceptable for this rollout, so no in-place migration is needed.

## 7. Stages

- **Stage A (this work):** Agents-side B. Adds `BuiltinAgentRegistry`, merges into `getSubAgents`, adds resolver fallback in `SubAgentManager` and `AgentChat`, deletes `builtinAgentSeeder.ts` and its call sites, adds write guards.
- **Stage B (follow-up):** Same pattern for skills. Adds `BuiltinSkillRegistry`, merges into `profile:getProfile`, adds skill file resolver fallback, deletes `builtinSkillSeeder.ts` and call sites.

Stages are independent. Stage A alone fixes the reported bug; Stage B closes the architecture-consistency gap.

## 8. Validation

- Unit tests: registry returns expected count for `investment-studio` brand; write guards reject reserved names; merged `getSubAgents` deduplicates correctly.
- Manual (user, after clean userdata wipe):
  1. Launch in skip-login → built-in agents listed.
  2. Sign into Copilot → built-in agents still listed.
  3. Create a user agent under Copilot.
  4. Sign back out to skip-login → user agent still listed (this validates Stage-A only fixes built-ins; user-agent cross-mode visibility is a separate, deferred concern).
  5. Sign back into Copilot → user agent still listed.

Step 4 may fail; that failure is **out of scope** for this design and tracked separately.
