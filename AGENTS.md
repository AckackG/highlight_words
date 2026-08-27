# PROJECT: Vocabulary Highlighter Chrome Extension

## 1. 项目概述

这是一个 Chrome 浏览器扩展，用于在网页上自动高亮显示用户生词本中的单词和短语。

- **核心功能**：
  - 遍历 DOM 文本节点，匹配生词库，包裹 `<span class="highlighted-word">` 并应用样式。
  - **动态内容感知**: 使用 `MutationObserver` 监听 DOM 变化，自动高亮后续动态加载的内容（如 AJAX、无限滚动）。
  - **性能优化**: 使用 `IntersectionObserver` 实现懒加载，只高亮进入浏览器视口内的元素，显著提升长页面的性能。
  - **多端同步 (New)**: 基于 WebDAV 协议实现多设备生词本同步，采用 LWW (Last Write Wins) 策略解决冲突。
  - **语境管理 (New)**: 支持单条语境删除、自动去重与裁剪（清理）功能。
  - **AI 语境释义 (New)**: 划词/悬停时，在 Google 机械词典结果**之外并列**显示一条由 LLM 生成的、结合当前句子的「简短词典式」释义。两者互不干扰：词典结果同步返回先行显示，AI 结果异步到达后原地补入。

## 2. 核心文件结构

### `manifest.json` (V3)

- **Permissions**: `storage`, `alarms`
- **Background**: `service-worker.js` (Module type)
- **Content Scripts**: `highlight-colors.js`, `content.js`, `styles.css` (运行在 `<all_urls>`)

### `content.js` (核心逻辑)

- **数据结构**: `vocabularySet` (单词 Set), `phraseSet` (短语 Set).
- **主要函数**:
  - `highlightWords(rootNode)`: 核心高亮函数，现在接受一个根节点参数，用于对特定 DOM 子树进行增量处理。通过 `element.closest('.highlighted-word')` 检查避免重复高亮。
  - `processPhrases(textNodes)`: 处理短语匹配。
  - `processWords(textNodes)`: 处理单词匹配。
  - `shouldSkipNode(node)`: 判断是否应跳过特定节点（如 SCRIPT, STYLE, 已处理节点等）。
  - `createHighlightSpan(word)`: 生成带有样式的 span 元素。
  - `initDynamicObserver()`: 初始化 `MutationObserver`，将其回调与 `IntersectionObserver` 连接，用于处理动态新增的节点。
  - `initIntersectionObserver()`: 初始化 `IntersectionObserver`，当被观察的元素进入视口时，调用 `highlightWords` 对其进行高亮。
  - `observeInitialNodes(root)`: 在页面加载时，将初始的文本内容块交给 `IntersectionObserver` 进行观察。

### `src/utils/` (工具模块)

- **`WebDAVClient.js`**: WebDAV 客户端封装，支持 Gzip 压缩/解压，处理文件上传下载。
- **`syncLogic.js`**: 核心同步逻辑，实现 Push/Pull/Noop 决策，处理 `notebook.json.gz` 与 `meta.json`。
- **`notebook-api.js`**: 生词本数据访问层，负责 CRUD、`notebook_update_timestamp` 维护、语境 ID 迁移与清理。
- **`llm-client.js`**: LLM 客户端（OpenAI Chat Completions 协议）。两种 provider：
  - **`openai`（默认）**：任意 OpenAI 兼容接口（OpenAI / DeepSeek / Groq / OpenRouter / Ollama / 自建 vLLM）。请求体**只带协议内字段** `{ model, messages, max_tokens }`——官方接口见到未知字段会直接 400，所以 `reasoning` / `chat_template_kwargs` / `mode` / `max_retries` 这些私有扩展**绝不能**发到这里。必须显式填 `model`。若上游用 400 报 `max_completion_tokens`（gpt-5 / o 系列），`chat()` 自动换字段重发一次。
  - **`cfworker`（特殊接口）**：作者自建的 Cloudflare Worker 代理，模型由 Worker 侧路由（所以不填 `model`），额外接受 `{ mode, max_retries }` 与两个关思考的字段，并从 `X-Proxy-Model` 响应头回读实际模型。
  - `normalizeLlmSettings(raw)`: 唯一的设置入口（service-worker 与 dashboard 都走它）。补默认值、按 provider 取预设兜底（**不能**用全局默认的 openai endpoint 兜 cfworker），并迁移老配置——v1 存的 `llm_settings` 没有 `provider` 字段，凡是填过 endpoint/api_key 的一律判为 `cfworker`。
  - `buildMessages(text, context)`: 按输入长度自动切换「词典模式」(≤4 词) 与「整句翻译模式」的 Prompt，强制输出 ≤3 行纯文本。
  - **瞬时故障重试**：`chat()` 对 429/500/502/503/504 退避重发（`RETRY_BACKOFF_MS = [700, 2000]`，共 3 次机会）；其余 4xx（key 无效、模型名写错）重试没意义，直接抛。cfworker 的 advanced 模式已在服务端换模型重试，客户端不再叠加（`maxAttempts = 1`）。`describeHttpError()` 会区分「带 overload message 的 5xx」（模型服务过载，等等就好）和「空 body 的 5xx」（多半是代理/网关吐的，等也没用）——这条区分是排查代理问题的主要线索。
  - `LLMClient.chat/translate/test()`: `buildBody()` 按 provider 分叉组装请求体（见上）。cfworker 分支的两个关思考字段是 `reasoning:{enabled:false,exclude:true}`（OpenRouter 统一开关）和 `chat_template_kwargs:{thinking:false}`（Nemotron / Qwen3 这类靠 chat template 切换的模型）。不支持 stream。
  - **思维链防护**：上游可能是推理模型（Worker 会路由过去，用户也可能自己填一个），思维链可能内联在 `content` 里。`stripReasoning()` 处理成对/缺开/缺闭三种 `<think>` 形态；`looksLikeReasoning()` 按「中文字符占比 < 20% 或含英文元讨论措辞」判定，`normalizeOutput()` 据此丢掉开头的自言自语行。`translate()` 校验不过就重试一次，仍失败则**抛错**——绝不能返回垃圾，否则会被写进 `llm_cache`（30 天）和 `item.llm`。`max_tokens` 必须留足思考预算（词典 600 / 整句 800），给小了只会吐出半截思维链。
  - 网络请求只在 service-worker 中发起（content script 通过 `LLM_TRANSLATE` 消息代理），以绕开页面 CORS。

### `highlight-colors.js` (辅助)

- 提供 `applyHighlightStyle(element, word)` 方法，用于给 span 上色。

## 3. 数据存储 (Storage)

- **`notebook`**: 生词本数组。
- **`notebook_update_timestamp`**: (Number) 全局版本号，每次修改 `notebook` 时更新，用于 LWW 同步比较。
- **`sync_settings`**: (Object) 同步配置 (server_url, username, password, enabled, etc.)。
- **`llm_settings`**: (Object) AI 翻译配置 `{ enabled, provider, endpoint, api_key, model, mode, max_retries }`。`provider` = `openai`（默认）| `cfworker`；`model` 只对 openai 生效，`mode`/`max_retries` 只对 cfworker 生效。读取一律经 `normalizeLlmSettings()`。**不参与 WebDAV 同步**（密钥仅存本地）。
- **`llm_cache`**: (Object) AI 释义缓存，key 为 `词条||语境前120字`（语境不同则释义不同），LRU 上限 300 条、TTL 30 天。
  - 清除入口：`LLM_CLEAR_CACHE` 消息。带 `text` 走 `clearLlmCacheForTerm()` 只清该词条（同一个词有多条语境 key，**按 `词条||` 前缀全清**）；不带 `text` 则清空整个缓存（设置页全局按钮）。
  - 单词级清除必须**同时调 `NotebookAPI.clearLlmTranslation()` 删掉 `item.llm`**，否则悬浮窗会立刻从词条存档里把旧结果读回来。
  - UI 入口：两个悬浮卡片的「AI 语境释义」标签行右端各有一个 `↻` 按钮（`.vh-llm-refresh`）——窗口A 在 `TooltipController._regenerateLlm()`（事件委托绑定，因为 AI 区块会被整块替换），窗口B 在 `SelectionUI.fillMiniLlm()` 里逐次绑定。只在出结果/出错后显示，生成中不显示。
- **`notebook_backup_*`**: 同步或清理操作前的自动备份。

生词条目新增可选字段 **`item.llm`** = `{ text, model, updatedAt }`，随 notebook 同步。

- 写入时机：① 加入生词本/更新语境时一并存档；② hover 已有词条首次拿到 AI 结果时，由 `NotebookAPI.setLlmTranslation()` **静默补写**（不广播 `REFRESH_HIGHLIGHTS`，否则每次 hover 都会触发整页重新高亮）。已有值不覆盖。
- 读取时机：生词本列表「释义」列 **优先显示 `item.llm` 的第一行**，回退到 `item.translation`；悬浮窗则两者并列展示。

## 
