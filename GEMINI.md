# PROJECT: Vocabulary Highlighter Chrome Extension

## 1. 项目概述
这是一个 Chrome 浏览器扩展，用于在网页上自动高亮显示用户生词本中的单词和短语。
- **核心功能**：
  - 遍历 DOM 文本节点，匹配生词库，包裹 `<span class="highlighted-word">` 并应用样式。
  - **动态内容感知**: 使用 `MutationObserver` 监听 DOM 变化，自动高亮后续动态加载的内容（如 AJAX、无限滚动）。
  - **性能优化**: 使用 `IntersectionObserver` 实现懒加载，只高亮进入浏览器视口内的元素，显著提升长页面的性能。

## 2. 核心文件结构

### `manifest.json` (V3)
- **Permissions**: `storage`
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

### `highlight-colors.js` (辅助)
- 提供 `applyHighlightStyle(element, word)` 方法，用于给 span 上色。

## 代码规范

### 命名约定
- 观察器相关: `observer*`, `watch*`
- 回调函数: `handle*`, `on*`
- 工具函数: `is*`, `should*`, `get*`

###  注释要求
- 每个新增函数必须包含 JSDoc 注释
- 复杂逻辑需要行内注释说明
- 性能优化点必须标注原因

###  错误处理
- 异常情况记录到 console（开发模式）
- 不应因错误导致扩展整体失效

# FOR LLM 
You should update GEMINI.md after each new feature update accordingly!