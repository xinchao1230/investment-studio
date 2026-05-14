# Research Workspace — Target ↔ Chat 绑定设计

> Status: Draft (设计已确认，待实施)
> Brand: `investment-studio`
> Scope: Research 工作区（`src/renderer/components/research/`）+ Chat 子系统
> Owner: 待定
> 关联代码：`portfolioTools.ts`, `ChatView.tsx`, `TargetListSidebar.tsx`, `ResearchPage.tsx`, `AgentChat`, `ProfileCacheManager`

---

## 1. 背景与问题

当前 Research 工作区已具备：
- **Target 列表**：用户添加股票/标的（如「海底捞 603993」），后端用 `portfolio_init_target` 在 workspace 下创建 `<名称>_<代码>/` 目录及子分类（纪要/研报/模型 …）。
- **Chat**：使用全局唯一的 `compactChatSession`（`ensureCompactChatSession()`），所有 Target 共享同一个 chat 上下文，**切换 Target 不切换会话**。

**问题**：
1. 不同 Target 的研究讨论混在一个 chat 里，上下文污染严重。
2. 同一 Target 想同时进行多个独立讨论（"估值讨论"/"业绩复盘"）无法分开。
3. 未来希望支持「无主题闲聊」模式（基于整个知识库讨论），需要架构上提前留口子。

---

## 2. 目标

| # | 目标 | 优先级 |
|---|---|---|
| G1 | 一个 Target 可拥有多个独立 chat（multi-chat per target） | P0 |
| G2 | 切换 Target 时自动切换 chat，无需手动选择 | P0 |
| G3 | Chat 的工具作用域（cwd / 文件搜索根）跟随其绑定的 Target | P0 |
| G4 | 数据模型预留对「全局/无 Target chat」的支持，今天不实现 UI | P1 |
| G5 | 旧 compact chat 行为弃用，不做数据迁移 | P0 |

---

## 3. 关键设计决策

| Q | 选择 | 备注 |
|---|---|---|
| Q1 数据模型 | **B + 可空 targetCode** | `targetCode: string \| null`，`null` 留给未来全局闲聊 |
| Q2 存储位置 | **C（混合）** | 元数据走 `profile.json`，消息体走 `chatSessions/{sessionId}.json`（沿用现有架构） |
| Q3 UI 形态 | **A（树形展开）** | Chat 作为子节点嵌在 Target 节点下，不同图标区分 |
| Q4 选中行为 | **A（自动打开最近 chat）** | 没有则自动新建空白 chat |
| 标题生成 | 沿用 `ChatSessionTitleLlmSummarizer` | 首条用户消息发送后异步生成 |
| 旧 compact chat | **直接弃用** | 不迁移，老数据保留但 UI 不再访问 |

---

## 4. 数据模型

### 4.1 ChatSession schema 扩展

```ts
// src/main/lib/userDataADO/types.ts （或现有 chatSession 类型文件）
interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];

  // 🆕 Target 绑定
  targetCode: string | null;   // null = 全局/无 Target，今天不会被 UI 创建但 schema 留口
  targetDir?: string;          // 缓存：targetCode 解析出的目录名（如 "海底捞_603993"），便于离线渲染
}
```

### 4.2 Profile 索引扩展

```ts
// profile.json 顶层新增
interface ResearchProfileExtension {
  /** 每个 Target 最近活跃的 chatId，用于 Q4 自动跳转 */
  lastActiveChatByTarget: Record<string /* targetCode */, string /* sessionId */>;
}
```

> **注意**：`targetCode === null` 的"全局 chat"今天不创建，但若未来加入，可用 key `"__global__"` 存其 `lastActiveChat`，无需再改 schema。

### 4.3 存储布局（保持现状 + 新字段）

```
{userData}/profiles/{userAlias}/
├── profile.json
│   ├── chatSessions: ChatSessionMeta[]   // ← 加 targetCode 字段
│   └── lastActiveChatByTarget: {...}     // 🆕
└── chatSessions/
    └── {sessionId}.json                  // 消息体（无变化）
```

---

## 5. 后端 API（IPC）

新增 IPC 命名空间 `researchChat:*`（与现有 `agentChat:*` 解耦，避免污染）：

| Channel | 入参 | 返回 | 说明 |
|---|---|---|---|
| `researchChat:listByTarget` | `targetCode: string \| null` | `ChatSessionMeta[]`（按 updatedAt desc） | 列出某 Target 的所有 chat |
| `researchChat:create` | `targetCode: string \| null, title?: string` | `sessionId` | 创建新 chat；title 缺省 = "未命名" |
| `researchChat:delete` | `sessionId: string` | `void` | 删除 chat（profile 索引 + 消息文件） |
| `researchChat:rename` | `sessionId: string, title: string` | `void` | 手动改名 |
| `researchChat:setLastActive` | `targetCode: string \| null, sessionId: string` | `void` | 更新 `lastActiveChatByTarget` |
| `researchChat:getLastActive` | `targetCode: string \| null` | `sessionId \| null` | 取最近活跃 |

> 现有 `agentChat:switchToChatSession` 复用即可，不另开 channel 切换。

---

## 6. 工具作用域注入

### 6.1 AgentChat 改造

```ts
class AgentChat {
  private currentTargetDir: string | null = null;

  setSession(session: ChatSession) {
    // ...existing...
    this.currentTargetDir = session.targetCode
      ? resolveTargetDir(session.targetCode)   // 从 portfolioTools 索引取
      : null;  // 全局模式 → workspace 根
  }

  getCwd(): string {
    return this.currentTargetDir
      ? path.join(workspaceRoot, this.currentTargetDir)
      : workspaceRoot;
  }
}
```

### 6.2 Builtin 文件工具改造

`fileOperations` / `fileSearch` / `executeCommand` 的"默认 cwd"参数改为从 `AgentChat.getCwd()` 取，而不是 hardcoded workspace 根。已显式传 cwd 的调用不受影响。

### 6.3 系统提示词占位符

新增模板变量（沿用现有 `{{KOSMOS_*}}` 替换机制）：

| 占位符 | Target-bound 时 | Global (null) 时 |
|---|---|---|
| `{{KOSMOS_TARGET_CODE}}` | `"603993"` | `""` |
| `{{KOSMOS_TARGET_NAME}}` | `"海底捞"` | `""` |
| `{{KOSMOS_TARGET_DIR}}` | `<workspace>/海底捞_603993/` | `<workspace>/` |
| `{{KOSMOS_SCOPE_DESCRIPTION}}` | `"你正在研究 海底捞(603993)，工作目录为 <dir>"` | `"你可访问整个研究知识库，根目录为 <workspace>"` |

Investment-studio brand 的全局 system prompt 模板预留这几个占位符即可。

---

## 7. 前端架构

### 7.1 组件树

```
ResearchPage
├── TargetListSidebar (width=240)
│   ├── 顶部 tabs (工作区 / Search / + / More)
│   ├── topSlot (AddTargetSearch，按需显示)
│   └── TargetTree
│       └── TargetNode  ← 每个 Target
│           ├── Row (chevron + 📁 icon + name + count badge)
│           └── ChatChildren (展开时)
│               ├── ChatRow × N (💬 icon + title + delete on hover)
│               └── "+ 新建 chat" 按钮
└── ResearchChatPane (主区)
    └── ChatView (sessionId from selection)
```

### 7.2 状态机（renderer）

```
selectedTargetCode (existing) 变化
  ↓
useEffect → researchChat:getLastActive(code)
  ├── 有 → switchToChatSession(sessionId)
  └── 无 → researchChat:create(code) → switchToChatSession(newId)
  ↓
researchChat:setLastActive(code, sessionId)
```

`selectedTargetCode === null` 的分支今天不会触发（无 UI 入口），但代码路径完备。

### 7.3 新增/修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `research/TargetListSidebar.tsx` | 修改 | 加 chat 子节点渲染 + 展开/折叠状态 |
| `research/ChatChildren.tsx` | 新建 | Chat 列表子组件 |
| `research/researchChatIpc.ts` | 新建 | 封装 6 个 IPC 调用 |
| `research/useTargetChats.ts` | 新建 | hook：listByTarget + lastActive + create |
| `research/ResearchPage.tsx` | 修改 | 接 selectedTargetCode → ChatView sessionId |
| `chat/ChatView.tsx` | 修改 | 支持外部传入 sessionId（取代 ensureCompactChatSession） |
| `main/lib/chat/agentChat.ts` | 修改 | `setSession` 解析 targetCode → currentTargetDir |
| `main/lib/userDataADO/profileCacheManager.ts` | 修改 | 加 `lastActiveChatByTarget` getter/setter |
| `main/lib/userDataADO/chatSessionFileOps.ts` | 修改 | ChatSession 类型加 `targetCode` |
| `main/main.ts` | 修改 | 注册 6 个 `researchChat:*` IPC handler |
| `shared/ipc/*` | 修改 | 类型声明 |

---

## 8. 实施顺序（5 步，可独立验证）

### Step 1 — 数据层（main）
- ChatSession schema 加 `targetCode`
- ProfileCacheManager 加 `lastActiveChatByTarget`
- 6 个 `researchChat:*` IPC handler
- ✅ 验证：DevTools console 直接调 IPC 走通

### Step 2 — Sidebar UI
- TargetNode 加展开状态（默认折叠）
- ChatChildren 子组件 + 新建按钮
- 删除 hover 按钮
- ✅ 验证：手动点 + 能创建 chat，能列出，能删除

### Step 3 — 选中联动
- ResearchPage 接 selectedTargetCode → load/create chat → 通知 ChatView
- ChatView 接受 sessionId prop（保留旧 compact 路径但不再触发）
- ✅ 验证：切 Target → chat 自动切；多个 chat 之间手动切换正常

### Step 4 — 作用域注入
- AgentChat.currentTargetDir + getCwd
- Builtin 文件工具默认 cwd 改用 getCwd
- 系统提示词占位符替换
- ✅ 验证：在「海底捞」chat 里调 file_search 默认搜该目录；prompt 含正确 dir

### Step 5 — 清理
- 移除/隔离 `ensureCompactChatSession` 的调用入口（保留函数防止旧测试失败）
- 文档更新（CLAUDE.md 的 Chat Engine 段落）
- ✅ 验证：lint + 手测全流程

---

## 9. 风险与决策记录

| 风险 | 缓解 |
|---|---|
| 老用户已有 compact chat 数据 | 不迁移、不删除，UI 不暴露入口；老数据安全休眠 |
| Target 删除时 chats 处理 | 同步删除该 Target 名下所有 chats（在 `portfolio_remove_target` 里调 `researchChat:listByTarget` + delete）。**待二次确认** |
| Target 改名/换 code | 暂不支持改 code（targetCode 是不可变 ID）；改显示名不影响绑定 |
| 大量 chat 导致 sidebar 过长 | Step 2 默认折叠每个 Target；后续可加"按月分组" |
| 同一 chat 的 targetCode 想改 | 不支持 — 跨 Target 移动语义混乱，强制新建即可 |

---

## 10. 未来扩展（不在本次实施）

- **全局 chat UI**：sidebar 顶部加「💬 全局闲聊」分组，targetCode = null
- **跨 Target RAG**：global chat 模式下注入 `{{KOSMOS_AVAILABLE_TARGETS}}` 列表
- **chat 标签/搜索**：profile 加 `tags?: string[]`
- **chat 移动**：拖拽改 targetCode（需先解决上下文一致性）

---

## 11. Out of scope

- 旧 compact chat 数据迁移
- Chat 导出/导入
- 多用户协作
- Chat 模板预设
