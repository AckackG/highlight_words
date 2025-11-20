## 一、功能概述

### 1.1 当前问题
现有扩展仅在页面初始加载时执行高亮，无法处理以下场景的动态内容：
- AJAX 加载的内容
- 无限滚动加载
- SPA 路由切换
- 实时更新的内容（评论、弹幕等）
- 懒加载元素

### 1.2 目标
实现对所有动态添加内容的实时高亮，确保用户在任何场景下都能看到词汇标记。

---

## 二、技术方案

### 2.1 核心解决方案：MutationObserver

#### 2.1.1 实现原理
使用浏览器原生 `MutationObserver` API 监听 DOM 树的变化，当检测到新节点添加时自动触发高亮处理。

#### 2.1.2 监听配置
```javascript
// 伪代码示例
const observerConfig = {
  childList: true,      // 监听子节点的添加/删除
  subtree: true,        // 监听所有后代节点
  characterData: false  // 不监听文本内容变化（避免循环触发）
};
```

#### 2.1.3 关键要点
- **监听目标**: `document.body`
- **触发时机**: 页面加载完成后立即启动
- **生命周期**: 扩展激活期间持续运行

---

### 2.2 架构改造

#### 2.2.1 函数重构
**现有函数**: `highlightWords()`
- 当前实现：遍历整个 `document.body`
- 问题：每次都处理全部 DOM，效率低下

**改造方案**:
```javascript
// 修改函数签名，支持部分 DOM 处理
function highlightWords(rootNode = document.body) {
  // rootNode: 可选参数，指定要处理的根节点
  // 默认值为 document.body（保持向后兼容）
}
```

#### 2.2.2 新增功能模块

| 模块名称 | 功能描述 | 优先级 |
|---------|---------|--------|
| `initDynamicObserver()` | 初始化 MutationObserver | 高 |
| `handleMutations()` | 处理 DOM 变化回调 | 高 |
| `debounceHighlight()` | 防抖处理函数 | 中 |
| `isNodeProcessed()` | 检查节点是否已处理 | 中 |
| `markNodeAsProcessed()` | 标记已处理节点 | 中 |

---

## 三、性能优化策略

### 3.1 防抖机制
**问题**: DOM 快速变化时会频繁触发高亮，造成性能问题

**解决方案**:
- 使用 `setTimeout` 延迟执行（建议 100-300ms）
- 使用 `requestAnimationFrame` 确保在浏览器重绘前执行
- 批量处理多个变化，避免逐个处理

### 3.2 增量处理
**问题**: 每次都处理整个 DOM 树效率低

**解决方案**:
- MutationObserver 回调中只处理新增的节点
- 使用 `mutation.addedNodes` 获取新增节点列表
- 过滤掉非元素节点（注释、文本节点片段等）

### 3.3 避免重复处理
**问题**: 已高亮的内容可能被重复处理

**解决方案**:
```javascript
// 标记策略
// 方案 1: 在父节点添加自定义属性
element.setAttribute('data-vocab-highlighted', 'true');

// 方案 2: 使用 WeakSet 存储已处理节点
const processedNodes = new WeakSet();
processedNodes.add(element);
```

### 3.4 可见性优化（可选）
**进阶方案**: 使用 `IntersectionObserver` 仅处理可见区域
- 适用场景：长页面、无限滚动
- 实现思路：延迟处理屏幕外内容，滚动到视口时再高亮
- 优先级：低（仅在性能瓶颈明显时实施）

---

## 四、特殊场景处理

### 4.1 SPA 应用支持
**问题**: 单页应用路由切换时 URL 变化但页面不刷新

**解决方案**:
```javascript
// 监听 URL 变化事件
window.addEventListener('popstate', handleRouteChange);
window.addEventListener('hashchange', handleRouteChange);

// 拦截 pushState 和 replaceState
const originalPushState = history.pushState;
history.pushState = function(...args) {
  originalPushState.apply(this, args);
  handleRouteChange();
};
```

### 4.2 iframe 内容
**问题**: iframe 内的内容需要单独处理

**解决方案**:
- 监听 iframe 的 `load` 事件
- 为每个 iframe 的 `contentDocument` 设置独立的 MutationObserver
- 注意跨域限制（只能处理同源 iframe）

### 4.3 Shadow DOM
**问题**: 某些现代网站使用 Shadow DOM 封装组件

**解决方案**:
- 递归检测所有 `shadowRoot`
- 为每个 Shadow Root 设置独立的观察器
- 性能考量：按需启用（可配置）

---

## 五、黑名单机制

### 5.1 节点类型黑名单
**目的**: 避免在不应处理的节点中进行高亮

**已有规则**:
- `<script>` 标签
- `<style>` 标签

**建议新增**:
- `<textarea>` 和 `<input>` 元素
- `contenteditable` 属性为 true 的元素
- `data-no-vocab-highlight` 自定义属性标记的元素

### 5.2 网站域名黑名单（可选）
**目的**: 排除频繁更新 DOM 的网站

**候选网站类型**:
- 在线视频播放器
- 实时聊天应用
- 股票行情网站
- 在线游戏

**实现方式**:
```javascript
const domainBlacklist = [
  'youtube.com',
  'twitch.tv',
  // 用户可在设置页面自定义
];
```

---

## 六、开发实施计划

### 6.1 阶段划分

#### 阶段一：基础实现（必需）
- [ ] 添加 MutationObserver 初始化代码
- [ ] 修改 `highlightWords()` 支持部分 DOM 处理
- [ ] 实现基础的节点去重检查
- [ ] 测试常见动态网站（微博、知乎、Twitter）

#### 阶段二：性能优化（重要）
- [ ] 实现防抖机制
- [ ] 添加节点处理标记
- [ ] 优化 TreeWalker 遍历逻辑
- [ ] 性能测试与调优

#### 阶段三：特殊场景（可选）
- [ ] SPA 路由变化监听
- [ ] iframe 支持
- [ ] Shadow DOM 支持
- [ ] IntersectionObserver 懒加载


### 6.2 文件修改清单

| 文件名 | 修改内容 | 优先级 |
|--------|---------|--------|
| `content.js` | 添加 MutationObserver 相关代码 | 高 |
| `content.js` | 重构 `highlightWords()` 函数 | 高 |
| `options.html` | 添加黑名单配置界面 | 低 |
| `options.js` | 添加黑名单保存逻辑 | 低 |
| `manifest.json` | 无需修改 | - |

---

## 九、代码规范

### 9.1 命名约定
- 观察器相关: `observer*`, `watch*`
- 回调函数: `handle*`, `on*`
- 工具函数: `is*`, `should*`, `get*`

### 9.2 注释要求
- 每个新增函数必须包含 JSDoc 注释
- 复杂逻辑需要行内注释说明
- 性能优化点必须标注原因

### 9.3 错误处理
- 所有 MutationObserver 回调必须包含 try-catch
- 异常情况记录到 console（开发模式）
- 不应因错误导致扩展整体失效

