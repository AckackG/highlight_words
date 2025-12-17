let notebookItems = [];
let vocabularySet = new Set(); // 只存 text 的 Set，用于快速正则匹配
let borderMode = false;
let intersectionObserver;
let tooltipEl = null; // 全局悬浮框实例

// 初始化：在页面加载时创建唯一的悬浮框 DOM
function initCustomTooltip() {
  if (tooltipEl) return;
  tooltipEl = document.createElement("div");
  tooltipEl.className = "vh-custom-tooltip";
  document.body.appendChild(tooltipEl);
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

  // 存储原始单词，供悬浮查找使用
  span.dataset.word = word;

  // 绑定鼠标事件
  span.addEventListener("mouseenter", (e) => showTooltip(e, word));
  span.addEventListener("mouseleave", hideTooltip);

  return span;
}

// --- 新增：悬浮框控制逻辑 ---

function showTooltip(e, word) {
  if (!tooltipEl) return;

  const item = notebookItems.find((i) => i.text.toLowerCase() === word.toLowerCase());
  if (!item) return;

  // 1. 构建 HTML 内容
  let html = `
    <div class="vh-tooltip-header">${item.text}</div>
    <div class="vh-tooltip-trans">${item.translation || "暂无释义"}</div>
  `;

  if (item.contexts && item.contexts.length > 0) {
    html += `<div class="vh-tooltip-ctx-label">最新语境：</div>`;

    // 取最新的 3 条即可，太多会遮挡屏幕
    const recentContexts = item.contexts.slice(-3).reverse();

    recentContexts.forEach((ctx, index) => {
      let cleanSentence = ctx.sentence.trim().replace(/\s+/g, " ");

      // HTML 转义，防止 XSS (非常重要，因为我们要用 innerHTML)
      cleanSentence = escapeHtml(cleanSentence);

      // 正则高亮关键词 (加粗 + 变色)
      // 使用 CSS class: vh-ctx-highlight
      try {
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`(${escapedWord})`, "gi");
        cleanSentence = cleanSentence.replace(regex, '<span class="vh-ctx-highlight">$1</span>');
      } catch (err) {}

      // 标题截断
      let sourceTitle = ctx.title || "";
      if (sourceTitle.length > 20) {
        sourceTitle = sourceTitle.slice(0, 8) + "..." + sourceTitle.slice(-8);
      }

      html += `
        <div class="vh-tooltip-ctx-item">
          ${cleanSentence}
          ${sourceTitle ? `<span class="vh-tooltip-source">From: ${sourceTitle}</span>` : ""}
        </div>
      `;
    });
  } else if (item.note) {
    html += `<div class="vh-tooltip-ctx-item" style="color:#198754">笔记: ${escapeHtml(
      item.note
    )}</div>`;
  }

  tooltipEl.innerHTML = html;

  // 2. 计算位置 (简单定位：显示在鼠标右下方，防止超出屏幕)
  const x = e.pageX + 10;
  const y = e.pageY + 10;

  tooltipEl.style.left = `${x}px`;
  tooltipEl.style.top = `${y}px`;

  // 显示
  tooltipEl.classList.add("vh-tooltip-visible");

  // 边界检测（可选优化：防止超出右边界）
  const rect = tooltipEl.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    tooltipEl.style.left = `${e.pageX - rect.width - 10}px`;
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
