let notebookItems = [];
let vocabularySet = new Set(); // 只存 text 的 Set，用于快速正则匹配
let borderMode = false;
let intersectionObserver;

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
  window.applyHighlightStyle(span, word, borderMode); // 调用 utils 中的函数
  span.textContent = word;
  span.classList.add("highlighted-word");

  // V3 新增: 悬浮提示 (简单 title 属性，或者后续可升级为 tooltip)
  // 查找对应的 notebookItem
  const item = notebookItems.find((i) => i.text.toLowerCase() === word.toLowerCase());
  if (item) {
    span.title = `${item.translation}\n${item.note ? "笔记: " + item.note : ""}`;
  }

  return span;
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
