// 使用Set来存储单词，提高查找效率
let vocabularySet = new Set();
// 使用Set存储短语，提高查找效率
let phraseSet = new Set();
// 添加一个变量来存储边框模式
let borderMode = false;
// IntersectionObserver for lazy highlighting
let intersectionObserver;

// 初始化时从storage获取词表和边框模式
chrome.storage.local.get(["vocabulary", "borderMode"], function (result) {
  if (result.vocabulary) {
    // 区分单词和短语
    result.vocabulary.forEach((item) => {
      if (item.includes(" ")) {
        phraseSet.add(item.toLowerCase());
      } else {
        vocabularySet.add(item.toLowerCase());
      }
    });
  }
  borderMode = result.borderMode || false; // 初始化边框模式
  
  // 使用IntersectionObserver进行懒加载高亮
  initIntersectionObserver();
  observeInitialNodes(document.body);
  initDynamicObserver(); // 启动MutationObserver
});

// 用于存储已处理过的节点，避免重复高亮
const processedNodes = new WeakSet();

/**
 * @function shouldSkipNode
 * @description 判断给定的节点是否应该被跳过处理。
 * @param {Node} node - 要检查的DOM节点。
 * @returns {boolean} - 如果节点应该被跳过，则返回true。
 */
function shouldSkipNode(node) {
  if (processedNodes.has(node)) {
    return true;
  }
  // Only process element nodes and non-empty text nodes
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) {
    return true;
  }
  if (node.nodeType === Node.TEXT_NODE && !node.nodeValue.trim()) {
    return true;
  }

  const nodeName = node.nodeName.toUpperCase();
  const parentNodeName = node.parentNode?.nodeName.toUpperCase();

  // 基础黑名单
  if (['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'HEAD', 'META', 'LINK'].includes(nodeName)) {
    return true;
  }
  if (['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'].includes(parentNodeName)) {
    return true;
  }
  // contenteditable 元素
  if (node.isContentEditable || node.parentNode?.isContentEditable) {
    return true;
  }
  // 自定义禁止属性
  if (node.closest && node.closest('[data-no-vocab-highlight]')) {
    return true;
  }

  return false;
}

/**
 * @function processPhrases
 * @description 遍历文本节点并高亮显示生词本中的短语。
 * @param {Array<Node>} textNodes - 待处理的文本节点数组。
 */
function processPhrases(textNodes) {
  phraseSet.forEach((phrase) => {
    const regex = new RegExp(`\\b${phrase}\\b`, "gi");
    textNodes.forEach((textNode) => {
      const parent = textNode.parentNode;
      // 关键修复：使用.closest()检查父元素是否已被高亮，更可靠
      if (!parent || shouldSkipNode(parent) || parent.closest('.highlighted-word')) {
        return;
      }

      const text = textNode.nodeValue;
      if (!text) return;

      let match;
      let lastIndex = 0;
      const fragments = [];

      while ((match = regex.exec(text)) !== null) {
        fragments.push(
          document.createTextNode(text.slice(lastIndex, match.index)),
          createHighlightSpan(match[0])
        );
        lastIndex = match.index + match[0].length;
      }

      if (fragments.length > 0) {
        fragments.push(document.createTextNode(text.slice(lastIndex)));
        const container = document.createDocumentFragment();
        fragments.forEach((fragment) => container.appendChild(fragment));
        parent.replaceChild(container, textNode);
        processedNodes.add(parent); // 标记父节点为已处理
      }
    });
  });
}

/**
 * @function processWords
 * @description 遍历文本节点并高亮显示生词本中的单词。
 * @param {Array<Node>} textNodes - 待处理的文本节点数组。
 */
function processWords(textNodes) {
  const wordRegex = /\b[a-zA-Z'’-]+\b/g;
  textNodes.forEach((textNode) => {
    const parent = textNode.parentNode;
    // 关键修复：使用.closest()检查父元素是否已被高亮，更可靠
    if (!parent || shouldSkipNode(parent) || parent.closest('.highlighted-word')) {
      return;
    }

    const text = textNode.nodeValue;
    if (!text) return;

    let lastIndex = 0;
    const fragments = [];
    let match;

    while ((match = wordRegex.exec(text)) !== null) {
      const word = match[0];
      const lowerCaseWord = word.toLowerCase();
      const shouldHighlight = vocabularySet.has(lowerCaseWord);

      if (shouldHighlight) {
        fragments.push(
          document.createTextNode(text.slice(lastIndex, match.index)),
          createHighlightSpan(word)
        );
        lastIndex = match.index + word.length;
      }
    }

    if (fragments.length > 0) {
      fragments.push(document.createTextNode(text.slice(lastIndex)));
      const container = document.createDocumentFragment();
      fragments.forEach((fragment) => container.appendChild(fragment));
      parent.replaceChild(container, textNode);
      processedNodes.add(parent); // 标记父节点为已处理
    }
  });
}

/**
 * @function highlightWords
 * @description 遍历指定根节点中的文本节点，并高亮单词和短语。
 * @param {Node} [rootNode=document.body] - 开始遍历的根节点。
 */
function highlightWords(rootNode = document.body) {
  // 关键修复：如果节点本身或其祖先已被高亮，则直接跳过，防止无限循环。
  if (rootNode.nodeType === Node.ELEMENT_NODE && rootNode.closest('.highlighted-word')) {
    return;
  }
  if (shouldSkipNode(rootNode) || processedNodes.has(rootNode)) {
    return;
  }
  // 使用TreeWalker API遍历指定根节点中的所有文本节点。
  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null, false);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (!shouldSkipNode(node.parentNode)) {
        textNodes.push(node);
    }
  }

  if (textNodes.length > 0) {
    processPhrases(textNodes);
    processWords(textNodes);
  }
  processedNodes.add(rootNode);
}

/**
 * @function handleMutations
 * @description MutationObserver的回调函数，处理DOM变化。新增的节点将被IntersectionObserver观察。
 * @param {MutationRecord[]} mutations - DOM变化记录数组。
 */
function handleMutations(mutations) {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE && !shouldSkipNode(node)) {
        intersectionObserver.observe(node);
      }
    }
  }
}

/**
 * @function initIntersectionObserver
 * @description 初始化IntersectionObserver，用于懒加载高亮。
 */
function initIntersectionObserver() {
    intersectionObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const target = entry.target;
                highlightWords(target);
                // 处理完后立即停止观察，避免重复触发
                observer.unobserve(target);
            }
        });
    }, {
        root: null, // 视口
        rootMargin: '0px',
        threshold: 0.1 // 10%可见时触发
    });
}

/**
 * @function observeInitialNodes
 * @description 观察页面初次加载时的节点，将其加入IntersectionObserver。
 * @param {Element} root - 开始观察的根元素。
 */
function observeInitialNodes(root) {
    // 选择一些常见的包含文本内容的标签
    const selectors = 'p, div, li, h1, h2, h3, h4, h5, h6, span, article, section, main';
    const nodes = root.querySelectorAll(selectors);
    nodes.forEach(node => {
        if (!shouldSkipNode(node)) {
            intersectionObserver.observe(node);
        }
    });
}


/**
 * @function initDynamicObserver
 * @description 初始化并启动MutationObserver来监听DOM变化。
 */
function initDynamicObserver() {
  const observerConfig = {
    childList: true,
    subtree: true,
  };

  const observer = new MutationObserver(handleMutations);
  observer.observe(document.body, observerConfig);
}

/**
 * @function createHighlightSpan
 * @description 创建用于高亮显示单词或短语的<span>元素。
 * @param {string} word - 需要高亮显示的文本。
 * @returns {HTMLSpanElement} - 创建的高亮显示元素的<span>。
 */
function createHighlightSpan(word) {
  const span = document.createElement("span");
  applyHighlightStyle(span, word, borderMode);
  span.textContent = word;
  span.classList.add("highlighted-word"); // 添加class以标记已被高亮
  return span;
}
