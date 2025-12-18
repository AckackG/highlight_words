let notebookItems = [];
let vocabularySet = new Set(); // 只存 text 的 Set，用于快速正则匹配
let borderMode = false;
let intersectionObserver;
let tooltipEl = null; // 全局悬浮框实例
let hideTimer = null;
let currentTriggerNode = null;

// --- 公开接口 ---
window.VocabularyTooltip = {
  show: (rect, data, mode = "hover", contextSentence = "", triggerNode = null) => {
    cancelHide();
    if (triggerNode) currentTriggerNode = triggerNode; // 记住是谁触发的
    renderTooltipContent(data, mode, contextSentence);
    positionTooltip(rect);
  },
  hide: () => {
    scheduleHide();
  },
};
function initCustomTooltip() {
  if (tooltipEl) return;
  tooltipEl = document.createElement("div");
  tooltipEl.className = "vh-custom-tooltip";
  document.body.appendChild(tooltipEl);

  tooltipEl.addEventListener("mouseenter", cancelHide);
  tooltipEl.addEventListener("mouseleave", scheduleHide);
}

// 初始化
chrome.storage.local.get(["notebook", "settings"], function (result) {
  updateVocabularyData(result.notebook || []);
  if (result.settings) {
    borderMode = result.settings.borderMode || false;
  }

  // 监听 Storage 变化 (例如从 Popup 添加了新词)
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "REFRESH_HIGHLIGHTS") {
      chrome.storage.local.get("notebook", (res) => {
        updateVocabularyData(res.notebook || []);

        // 【修复需求 3】热更新当前悬浮窗
        // 如果当前悬浮窗是可见的，且显示的单词刚刚被更新了（例如回写了翻译）
        if (
          tooltipEl &&
          tooltipEl.classList.contains("vh-tooltip-visible") &&
          tooltipEl.dataset.currentWord
        ) {
          const currentWord = tooltipEl.dataset.currentWord;
          const updatedItem = notebookItems.find(
            (i) => i.text.toLowerCase() === currentWord.toLowerCase()
          );

          if (updatedItem) {
            // 保持位置不变，仅更新内容
            renderTooltipContent(updatedItem, "hover");
          }
        }

        // 重新扫描页面 (简单暴力法，优化可做 diff)
        processedNodes = new WeakSet();
        highlightWords(document.body);
      });
    }
  });

  initIntersectionObserver();
  observeInitialNodes(document.body);
  initDynamicObserver();
  initCustomTooltip();
});

function updateVocabularyData(items) {
  notebookItems = items;
  vocabularySet = new Set(items.map((item) => item.text.toLowerCase()));
}

// 已处理节点记录
let processedNodes = new WeakSet();

function shouldSkipNode(node) {
  if (processedNodes.has(node)) return true;
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) return true;
  if (node.nodeType === Node.TEXT_NODE && !node.nodeValue.trim()) return true;

  // 【核心修复】：获取元素节点（如果是文本节点则取其父级）
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;

  // 1. 检查是否在悬浮窗内部 (防止递归高亮悬浮窗里的内容)
  // 使用 closest API 向上查找，如果祖先里有 .vh-custom-tooltip 则跳过
  if (element && element.closest(".vh-custom-tooltip")) {
    return true;
  }

  const nodeName = node.nodeName.toUpperCase();
  const parentNodeName = node.parentNode?.nodeName.toUpperCase();

  const blacklist = [
    "SCRIPT",
    "STYLE",
    "TEXTAREA",
    "INPUT",
    "HEAD",
    "META",
    "LINK",
    "NOSCRIPT",
    "CODE",
  ];
  if (blacklist.includes(nodeName) || blacklist.includes(parentNodeName)) return true;
  if (node.isContentEditable || node.parentNode?.isContentEditable) return true;
  // 自定义忽略
  if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute("data-no-vocab-highlight"))
    return true;

  return false;
}

function processTextNodes(textNodes) {
  // 1. 构建巨大的正则 (按长度排序，优先匹配长词/短语)
  if (vocabularySet.size === 0) return;

  const sortedPhrases = Array.from(vocabularySet).sort((a, b) => b.length - a.length);
  // 转义正则字符
  const escapedPhrases = sortedPhrases.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`\\b(${escapedPhrases.join("|")})\\b`, "gi");

  textNodes.forEach((textNode) => {
    const parent = textNode.parentNode;
    if (!parent || shouldSkipNode(parent) || parent.classList.contains("highlighted-word")) return;

    const text = textNode.nodeValue;
    if (!text) return;

    let match;
    let lastIndex = 0;
    const fragments = [];

    while ((match = regex.exec(text)) !== null) {
      const matchText = match[0];

      // 添加前面的纯文本
      fragments.push(document.createTextNode(text.slice(lastIndex, match.index)));

      // 创建高亮节点
      fragments.push(createHighlightSpan(matchText));

      lastIndex = match.index + matchText.length;
    }

    if (fragments.length > 0) {
      fragments.push(document.createTextNode(text.slice(lastIndex)));
      const container = document.createDocumentFragment();
      fragments.forEach((f) => container.appendChild(f));
      parent.replaceChild(container, textNode);
      processedNodes.add(parent);
    }
  });
}

function createHighlightSpan(word) {
  const span = document.createElement("span");
  window.applyHighlightStyle(span, word, borderMode);
  span.textContent = word;
  span.classList.add("highlighted-word");
  span.dataset.word = word;

  span.addEventListener("mouseenter", async (e) => {
    cancelHide();
    const target = e.target;
    currentTriggerNode = target; // 关键：记录当前节点

    // 1. 先找本地数据
    let item = notebookItems.find((i) => i.text.toLowerCase() === word.toLowerCase());

    // 2. 如果本地有 item，但没有翻译 (Fix: 对齐双击逻辑，强制查词)
    if (item && !item.translation) {
      // 先显示 loading 状态
      const rect = target.getBoundingClientRect();
      const tempItem = { ...item, translation: "正在获取释义..." };
      window.VocabularyTooltip.show(rect, tempItem, "hover", "", target);

      // 发送消息给 background (复用双击的 LOOKUP_WORD)
      try {
        const response = await chrome.runtime.sendMessage({
          action: "LOOKUP_WORD",
          text: word,
        });

        // 如果查到了，更新内存 item 并刷新显示
        if (response && response.data && response.data.translation) {
          item.translation = response.data.translation;
          // 只有当鼠标还在该元素上时才刷新，避免闪烁
          if (tooltipEl && tooltipEl.dataset.currentWord === word) {
            window.VocabularyTooltip.show(rect, item, "hover", "", target);
          }
        }
      } catch (err) {
        console.error("Hover lookup failed", err);
      }
    }
    // 3. 正常显示
    else if (item) {
      const rect = target.getBoundingClientRect();
      window.VocabularyTooltip.show(rect, item, "hover", "", target);
    }
  });

  span.addEventListener("mouseleave", scheduleHide);
  return span;
}

function getSentenceFromNode(node) {
  if (!node) return "";

  // 1. 向上回溯到块级元素
  const blockTags = new Set([
    "P",
    "DIV",
    "LI",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "TD",
    "SECTION",
    "BLOCKQUOTE",
    "ARTICLE",
  ]);
  let container = node.parentElement;

  while (container && container !== document.body) {
    if (blockTags.has(container.tagName.toUpperCase())) {
      break;
    }
    container = container.parentElement;
  }

  if (!container) return node.textContent; // 降级处理

  // 2. 获取文本
  const fullText = (container.innerText || container.textContent || "").replace(/\s+/g, " ").trim();
  const targetWord = node.textContent.trim();

  // 3. 简单提取 (如果太长，截取前后)
  if (fullText.length > 200) {
    const idx = fullText.indexOf(targetWord);
    if (idx !== -1) {
      const start = Math.max(0, idx - 60);
      const end = Math.min(fullText.length, idx + targetWord.length + 60);
      return "..." + fullText.substring(start, end) + "...";
    }
  }
  return fullText;
}

// --- 延迟控制逻辑 ---

function scheduleHide() {
  // 如果已经在倒计时，先清除旧的（避免重复）
  if (hideTimer) clearTimeout(hideTimer);
  // 500ms 后执行隐藏
  hideTimer = setTimeout(() => {
    if (tooltipEl) {
      tooltipEl.classList.remove("vh-tooltip-visible");
    }
  }, 500);
}

function cancelHide() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

// --- 新增：悬浮框控制逻辑 ---
function renderTooltipContent(data, mode, contextSentence) {
  if (!tooltipEl) return;
  tooltipEl.dataset.currentWord = data.text;

  const isSelectionMode = mode === "selection";
  const word = data.text;
  const translation = data.translation || "暂无释义";

  let html = "";

  // Header
  html += `<div class="vh-tooltip-header">
    <span>${escapeHtml(word)}</span>
    ${
      isSelectionMode
        ? `<button id="vh-header-add-btn" class="vh-add-btn">加入生词本</button>`
        : `<button id="vh-header-update-btn" class="vh-add-btn" style="background:#f0f0f0; color:#333; border:1px solid #ddd;">更新语境</button>`
    }
  </div>`;

  // Translation
  html += `<div class="vh-tooltip-trans">${escapeHtml(translation)}</div>`;

  // Contexts List (Hover Mode Only)
  if (!isSelectionMode) {
    if (data.note) {
      html += `<div class="vh-tooltip-ctx-item" style="color:#198754; background:#e8f5e9; border-left: 3px solid #198754;"><b>笔记:</b> ${escapeHtml(
        data.note
      )}</div>`;
    }

    if (data.contexts && data.contexts.length > 0) {
      html += `<div class="vh-tooltip-ctx-label" style="margin-top:8px;">最新语境：</div>`;
      const recentContexts = data.contexts.slice(-3).reverse();

      recentContexts.forEach((ctx) => {
        // ... (高亮单词逻辑不变)
        let cleanSentence = ctx.sentence.trim().replace(/\s+/g, " ");
        cleanSentence = escapeHtml(cleanSentence);
        try {
          const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const regex = new RegExp(`(${escapedWord})`, "gi");
          cleanSentence = cleanSentence.replace(regex, '<span class="vh-ctx-highlight">$1</span>');
        } catch (e) {}

        let sourceTitle = ctx.title || "";
        if (sourceTitle.length > 65)
          sourceTitle = sourceTitle.slice(0, 30) + "..." + sourceTitle.slice(-30);

        // 【核心修复 3 - Step A】: 在 DOM 上埋入 data-origin-* 属性
        // 这样 SelectionUI 选中里面的字时，就能知道它来自哪个 URL，而不是当前页面
        const originUrl = ctx.url || "";
        const originTitle = ctx.title || "";

        html += `
          <div class="vh-tooltip-ctx-item" 
               data-origin-url="${escapeHtml(originUrl)}" 
               data-origin-title="${escapeHtml(originTitle)}">
            ${cleanSentence}
            ${sourceTitle ? `<span class="vh-tooltip-source">From: ${sourceTitle}</span>` : ""}
          </div>
        `;
      });
    }
  }

  tooltipEl.innerHTML = html;

  // 事件绑定
  if (isSelectionMode) {
    // (Selection 模式的 Add 逻辑保持不变)
    const btn = document.getElementById("vh-header-add-btn");
    if (btn) {
      const exists = notebookItems.some((i) => i.text.toLowerCase() === word.toLowerCase());
      if (exists) btn.textContent = "已存在 (更新)";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleAddToNotebook(btn, word, translation, contextSentence);
      });
    }
  } else {
    // 【核心修复 2 - Step B】Hover 模式下的更新语境逻辑
    const btn = document.getElementById("vh-header-update-btn");
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        // 使用 currentTriggerNode 动态获取当前页面的真实句子
        // 此时 currentTriggerNode 就是那个被高亮的 span
        let realSentence = "";
        if (currentTriggerNode && document.body.contains(currentTriggerNode)) {
          realSentence = getSentenceFromNode(currentTriggerNode);
        } else {
          // 兜底：如果节点丢了，尝试用正则或选择器找一个
          realSentence = document.title + " (Context mismatch)";
        }

        handleAddToNotebook(btn, word, translation, realSentence);
      });
    }
  }
}

async function handleAddToNotebook(btnElement, word, translation, contextSentence) {
  btnElement.textContent = "保存中...";
  const faviconUrl = document.head.querySelector('link[rel*="icon"]')?.href || "/favicon.ico";

  await chrome.runtime.sendMessage({
    action: "ADD_WORD",
    data: {
      text: word,
      translation: translation,
      context: {
        sentence: contextSentence || word,
        url: window.location.href,
        title: document.title,
        favicon: faviconUrl,
      },
    },
  });

  btnElement.textContent = "已更新";
  btnElement.classList.add("added");
  // 稍微延迟后关闭
  setTimeout(() => scheduleHide(), 1500);
}

function positionTooltip(rect) {
  if (!tooltipEl) return;

  // 使用 fixed 定位计算，需要考虑 scroll
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  const x = rect.left + scrollX; // 左对齐选区
  const y = rect.bottom + scrollY + 10; // 选区下方

  tooltipEl.style.left = `${x}px`;
  tooltipEl.style.top = `${y}px`;
  tooltipEl.classList.add("vh-tooltip-visible");

  // 简单的边界检测 (防止溢出屏幕右侧)
  const tooltipRect = tooltipEl.getBoundingClientRect();
  if (tooltipRect.right > window.innerWidth) {
    tooltipEl.style.left = `${window.innerWidth - tooltipRect.width - 20}px`;
  }
}

function hideTooltip() {
  if (tooltipEl) {
    tooltipEl.classList.remove("vh-tooltip-visible");
  }
}

// 简单的 HTML 转义工具
function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function highlightWords(rootNode = document.body) {
  if (rootNode.nodeType === Node.ELEMENT_NODE && rootNode.classList.contains("highlighted-word"))
    return;
  if (shouldSkipNode(rootNode)) return;

  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null, false);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (!shouldSkipNode(node.parentNode)) {
      textNodes.push(node);
    }
  }

  if (textNodes.length > 0) {
    processTextNodes(textNodes);
  }
  processedNodes.add(rootNode);
}

// Mutation & Intersection Observers (逻辑保持不变)
function handleMutations(mutations) {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE && !shouldSkipNode(node)) {
        intersectionObserver.observe(node);
      }
    }
  }
}

function initIntersectionObserver() {
  intersectionObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          highlightWords(entry.target);
          observer.unobserve(entry.target);
        }
      });
    },
    { root: null, rootMargin: "0px", threshold: 0.1 }
  );
}

function observeInitialNodes(root) {
  const selectors = "p, div, li, h1, h2, h3, h4, h5, h6, span, article, section, main";
  const nodes = root.querySelectorAll(selectors);
  nodes.forEach((node) => {
    if (!shouldSkipNode(node)) {
      intersectionObserver.observe(node);
    }
  });
}

function initDynamicObserver() {
  const observer = new MutationObserver(handleMutations);
  observer.observe(document.body, { childList: true, subtree: true });
}
