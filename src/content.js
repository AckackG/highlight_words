// 使用Set来存储单词，提高查找效率
let vocabularySet = new Set();
// 使用Set存储短语，提高查找效率
let phraseSet = new Set();
// 添加一个变量来存储边框模式
let borderMode = false;

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
  highlightWords();
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
  const nodeName = node.nodeName.toUpperCase();
  const parentNodeName = node.parentNode?.nodeName.toUpperCase();

  // 基础黑名单
  if (['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'].includes(nodeName)) {
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
      if (!parent || shouldSkipNode(parent)) {
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
    if (!parent || shouldSkipNode(parent)) {
      return;
    }
    if (
      parent.nodeName === "SPAN" &&
      parent.classList.contains("highlighted-word")
    ) {
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
  if (shouldSkipNode(rootNode)) {
    return;
  }
  // 使用TreeWalker API遍历指定根节点中的所有文本节点。
  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null, false);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    textNodes.push(node);
  }

  if (textNodes.length > 0) {
    processPhrases(textNodes);
    processWords(textNodes);
  }
}

/**
 * @function debounce
 * @description 防抖函数，延迟执行某个函数。
 * @param {Function} func - 需要防抖的函数。
 * @param {number} delay - 延迟毫秒数。
 * @returns {Function} - 包装后的防抖函数。
 */
function debounce(func, delay) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}


/**
 * @function handleMutations
 * @description MutationObserver的回调函数，处理DOM变化。
 * @param {MutationRecord[]} mutations - DOM变化记录数组。
 */
const handleMutations = debounce((mutations) => {
  try {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach((node) => {
          // 只处理元素节点，因为文本节点等无法作为遍历的根
          if (node.nodeType === Node.ELEMENT_NODE) {
            highlightWords(node);
          }
        });
      }
    });
  } catch (error) {
    console.error('Error handling mutations:', error);
  }
}, 300); // 300ms的防抖延迟


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
  applyHighlightStyle(span, word);
  span.textContent = word;
  span.classList.add("highlighted-word"); // 添加class以标记已被高亮
  return span;
}
