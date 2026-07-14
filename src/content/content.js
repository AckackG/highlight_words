let notebookItems = [];
let vocabularySet = new Set();
let highlightRegex = null;
let borderMode = false;
let intersectionObserver;
let dynamicObserver = null;
let processedNodes = new WeakSet();
let observedShadowRoots = new WeakSet();

// 初始化统一工具
const contextExtractor = new ContextExtractor();
const tooltipController = new TooltipController();

// 初始化
chrome.storage.local.get(["notebook", "settings"], function (result) {
  updateVocabularyData(result.notebook || []);
  if (result.settings) {
    borderMode = result.settings.borderMode || false;
  }

  // 监听 Storage 变化
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "REFRESH_HIGHLIGHTS") {
      chrome.storage.local.get("notebook", (res) => {
        updateVocabularyData(res.notebook || []);

        // 热更新悬浮窗
        if (
          tooltipController.element &&
          tooltipController.element.classList.contains("vh-tooltip-visible") &&
          tooltipController.element.dataset.currentWord
        ) {
          const currentWord = tooltipController.element.dataset.currentWord;
          const updatedItem = notebookItems.find(
            (i) => i.text.toLowerCase() === currentWord.toLowerCase()
          );

          if (updatedItem) {
            // 【修复】不再重新计算 Rect 和调用 show，而是直接原地更新数据
            // 解决了点击按钮后窗口不断向下移动的问题
            tooltipController.updateData(updatedItem);
          }
        }

        // 先清理旧高亮（词表可能已删词），再全量重扫（含 Shadow DOM）
        unhighlightAll(document.body);
        processedNodes = new WeakSet();
        highlightWords(document.body, true);
      });
    }
  });

  initIntersectionObserver();
  initDynamicObserver();
  attachHoverDelegation(document);
  observeInitialNodes(document.body);
  registerShadowRoots(document.body);
});

function updateVocabularyData(items) {
  notebookItems = items;
  vocabularySet = new Set(items.map((item) => item.text.toLowerCase()));
  buildHighlightRegex();
}

// 词表变化时才重建正则，避免每个文本节点/每次滚动都重复构建
function buildHighlightRegex() {
  if (vocabularySet.size === 0) {
    highlightRegex = null;
    return;
  }
  const sortedPhrases = Array.from(vocabularySet).sort((a, b) => b.length - a.length);
  const escapedPhrases = sortedPhrases.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  highlightRegex = new RegExp(`\\b(${escapedPhrases.join("|")})\\b`, "gi");
}

function shouldSkipNode(node) {
  if (processedNodes.has(node)) return true;
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) return true;
  if (node.nodeType === Node.TEXT_NODE && !node.nodeValue.trim()) return true;

  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;

  // 防止递归高亮悬浮窗内容
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
    "PRE",
    "KBD",
    "SAMP",
    "VAR",
    "SVG",
  ];
  if (blacklist.includes(nodeName) || blacklist.includes(parentNodeName)) return true;
  if (node.isContentEditable || node.parentNode?.isContentEditable) return true;
  if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute("data-no-vocab-highlight"))
    return true;

  return false;
}

function processTextNodes(textNodes) {
  if (!highlightRegex) return;

  textNodes.forEach((textNode) => {
    const parent = textNode.parentNode;
    if (!parent || shouldSkipNode(parent) || parent.classList.contains("highlighted-word")) return;

    const text = textNode.nodeValue;
    if (!text) return;

    // 复用全局正则，逐节点前必须重置 lastIndex
    highlightRegex.lastIndex = 0;

    let match;
    let lastIndex = 0;
    const fragments = [];

    while ((match = highlightRegex.exec(text)) !== null) {
      const matchText = match[0];

      fragments.push(document.createTextNode(text.slice(lastIndex, match.index)));
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
  // hover 交互统一走事件委托（attachHoverDelegation），不再逐 span 绑定监听器
  return span;
}

// ==========================================
// Hover 事件委托（含 Shadow DOM）
// ==========================================

function attachHoverDelegation(root) {
  root.addEventListener("mouseover", handleDelegatedMouseOver);
  root.addEventListener("mouseout", handleDelegatedMouseOut);
}

function handleDelegatedMouseOver(e) {
  const span = e.target?.closest ? e.target.closest(".highlighted-word") : null;
  if (!span) return;
  handleWordHover(span);
}

function handleDelegatedMouseOut(e) {
  const span = e.target?.closest ? e.target.closest(".highlighted-word") : null;
  if (!span) return;
  tooltipController.hide();
}

async function handleWordHover(target) {
  const word = target.dataset.word;
  if (!word) return;

  // 查找本地数据
  let item = notebookItems.find((i) => i.text.toLowerCase() === word.toLowerCase());

  // 如果本地有但没翻译，强制查词
  if (item && !item.translation) {
    const rect = target.getBoundingClientRect();
    const tempItem = { ...item, translation: "正在获取释义..." };
    tooltipController.show({
      rect: rect,
      data: tempItem,
      mode: "hover",
      context: "",
    });

    try {
      const response = await chrome.runtime.sendMessage({
        action: "LOOKUP_WORD",
        text: word,
      });

      if (response && response.data && response.data.translation) {
        item.translation = response.data.translation;

        if (tooltipController.element?.dataset.currentWord === word) {
          tooltipController.show({
            rect: rect,
            data: item,
            mode: "hover",
            context: "",
          });
        }
      }
    } catch (err) {
      console.error("Hover lookup failed", err);
    }
  } else if (item) {
    // 正常显示
    const rect = target.getBoundingClientRect();
    const context = contextExtractor.extract(target, word);

    tooltipController.show({
      rect: rect,
      data: item,
      mode: "hover",
      context: context,
    });
  }
}

// ==========================================
// 高亮扫描
// ==========================================

function highlightWords(rootNode = document.body, deep = false) {
  const isElement = rootNode.nodeType === Node.ELEMENT_NODE;
  if (isElement && rootNode.classList.contains("highlighted-word")) return;
  if (isElement && shouldSkipNode(rootNode)) return;

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

  // 穿透 Shadow DOM。日常懒加载由 IntersectionObserver 覆盖，
  // 仅在深度扫描（首次/刷新）时递归进入 shadow root。
  if (deep && rootNode.querySelectorAll) {
    rootNode.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) highlightWords(el.shadowRoot, true);
    });
  }

  processedNodes.add(rootNode);
}

// 还原所有高亮（用于刷新前清理，避免删词后残留或重复包裹）
function unhighlightAll(root = document.body) {
  if (!root.querySelectorAll) return;

  root.querySelectorAll(".highlighted-word").forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(span.textContent), span);
    parent.normalize(); // 合并相邻文本节点，保证后续能重新匹配
  });

  root.querySelectorAll("*").forEach((el) => {
    if (el.shadowRoot) unhighlightAll(el.shadowRoot);
  });
}

function handleMutations(mutations) {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      // 跳过自己生成的高亮节点，避免无意义的重复观察
      if (node.classList?.contains("highlighted-word")) continue;
      if (shouldSkipNode(node)) continue;

      intersectionObserver.observe(node);
      registerShadowRoots(node);
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
  if (!root.querySelectorAll) return;
  const nodes = root.querySelectorAll(selectors);
  nodes.forEach((node) => {
    if (!shouldSkipNode(node)) {
      intersectionObserver.observe(node);
    }
  });
}

// 发现并接管所有 Shadow DOM：内部懒加载观察 + 事件委托 + 动态变化观察
function registerShadowRoots(root) {
  if (!root.querySelectorAll) return;

  const process = (el) => {
    if (!el.shadowRoot || observedShadowRoots.has(el.shadowRoot)) return;
    observedShadowRoots.add(el.shadowRoot);
    attachHoverDelegation(el.shadowRoot);
    observeInitialNodes(el.shadowRoot);
    registerShadowRoots(el.shadowRoot); // 嵌套 shadow root
    if (dynamicObserver) {
      dynamicObserver.observe(el.shadowRoot, { childList: true, subtree: true });
    }
  };

  if (root.nodeType === Node.ELEMENT_NODE) process(root);
  root.querySelectorAll("*").forEach(process);
}

function initDynamicObserver() {
  dynamicObserver = new MutationObserver(handleMutations);
  dynamicObserver.observe(document.body, { childList: true, subtree: true });
}
