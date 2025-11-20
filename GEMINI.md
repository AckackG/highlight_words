# PROJECT: Vocabulary Highlighter Chrome Extension

## 1. 项目概述
这是一个 Chrome 浏览器扩展，用于在网页上自动高亮显示用户生词本中的单词和短语。
- **核心功能**：遍历 DOM 文本节点，匹配生词库，包裹 `<span class="highlighted-word">` 并应用样式。

## 2. 核心文件结构

### `manifest.json` (V3)
- **Permissions**: `storage`
- **Content Scripts**: `highlight-colors.js`, `content.js`, `styles.css` (运行在 `<all_urls>`)

### `content.js` (核心逻辑 - 需要修改)
- **数据结构**: `vocabularySet` (单词 Set), `phraseSet` (短语 Set).
- **主要函数**:
  - `highlightWords()`: 入口函数，使用 `TreeWalker` 遍历 `document.body`。
  - `processPhrases(textNodes)`: 优先处理短语匹配。
  - `processWords(textNodes)`: 处理单词匹配。
  - `shouldSkipNode(node)`: 跳过 `SCRIPT`, `STYLE`。
  - `createHighlightSpan(word)`: 生成带有样式的 span 元素。

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
You should update this file after each new feature update accordingly!