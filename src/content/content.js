let notebookItems = [];
let vocabularySet = new Set();
let borderMode = false;
let intersectionObserver;
let processedNodes = new WeakSet();

// 初始化统一工具
const contextExtractor = new ContextExtractor();
const tooltipController = new TooltipController();
const { debounce } = VH_Helpers; // 如果需要

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
            const rect = tooltipController.element.getBoundingClientRect();
            tooltipController.show({
              rect: rect,
              data: updatedItem,
              mode: "hover",
              context: "",
            });
          }
        }

        // 重新扫描页面
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
  ];
  if (blacklist.includes(nodeName) || blacklist.includes(parentNodeName)) return true;
  if (node.isContentEditable || node.parentNode?.isContentEditable) return true;
  if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute("data-no-vocab-highlight"))
    return true;

  return false;
}

function processTextNodes(textNodes) {
  if (vocabularySet.size === 0) return;

  const sortedPhrases = Array.from(vocabularySet).sort((a, b) => b.length - a.length);
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

  span.addEventListener("mouseenter", async (e) => {
    const target = e.target;

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

          if (tooltipController.element.dataset.currentWord === word) {
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
  });

  span.addEventListener("mouseleave", () => {
    tooltipController.hide();
  });

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
