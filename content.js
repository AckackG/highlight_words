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
});

/**
 * @function shouldSkipNode
 * @description 判断给定的节点是否应该被跳过处理。
 * @param {Node} node - 要检查的DOM节点。
 * @returns {boolean} - 如果节点是SCRIPT或STYLE标签，则返回true，否则返回false。
 *
 * 目的：
 *  - 提高代码可读性和可维护性，将节点类型判断逻辑分离出来。
 *  - 避免在不应处理的节点（如脚本和样式）中进行文本高亮，提高性能。
 */
function shouldSkipNode(node) {
  return node.nodeName === "SCRIPT" || node.nodeName === "STYLE";
}

/**
 * @function processPhrases
 * @description 遍历文本节点并高亮显示生词本中的短语。
 * @param {Array<Node>} textNodes - 待处理的文本节点数组。
 *
 * 优化说明：
 *  - 使用正则表达式进行短语匹配，支持全局搜索和忽略大小写。
 *  - 利用DocumentFragment批量更新DOM，显著减少重绘次数，提升性能。
 *
 * 处理逻辑：
 *  - 遍历每个短语，然后在每个文本节点中查找该短语的出现。
 *  - 如果找到匹配项，则将文本节点分割，并将匹配的短语替换为高亮显示的元素。
 */
function processPhrases(textNodes) {
  phraseSet.forEach((phrase) => {
    const regex = new RegExp(`\\b${phrase}\\b`, "gi");
    textNodes.forEach((textNode) => {
      const parent = textNode.parentNode;
      if (parent && shouldSkipNode(parent)) {
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
      }
    });
  });
}

/**
 * @function processWords
 * @description 遍历文本节点并高亮显示生词本中的单词。
 * @param {Array<Node>} textNodes - 待处理的文本节点数组。
 *
 * 优化说明：
 *  - 使用正则表达式匹配单词边界，避免匹配到单词的一部分。
 *  - 在处理单词前，检查父节点是否已因短语高亮而被处理过，避免重复高亮。
 */
function processWords(textNodes) {
  const wordRegex = /\b[a-zA-Z'’-]+\b/g;
  textNodes.forEach((textNode) => {
    if (
      textNode.parentNode &&
      textNode.parentNode.nodeName === "SPAN" &&
      textNode.parentNode.classList.contains("highlighted-word")
    ) {
      return;
    }

    const parent = textNode.parentNode;
    if (parent && shouldSkipNode(parent)) {
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
      if (parent) {
        parent.replaceChild(container, textNode);
      }
    }
  });
}

/**
 * @function highlightWords
 * @description 遍历文档中的文本节点，并高亮显示生词本中的单词和短语。
 *
 * 优化说明：
 *  - 使用TreeWalker API进行高效的DOM遍历，相比传统的递归DOM遍历，TreeWalker性能更优，因为它避免了不必要的节点访问和函数调用栈的增长。
 *  - 先处理短语，确保当短语包含的单词也在生词本中时，短语高亮不会被单字高亮覆盖，提供更符合预期的视觉效果。
 *  - 代码结构优化，将短语和单词的处理逻辑拆分为独立的函数，提高代码的可读性和可维护性，符合单一职责原则。
 */
function highlightWords() {
  // 使用TreeWalker API遍历文档body中的所有文本节点。TreeWalker提供了一种高效的方式来遍历DOM树。
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
  const textNodes = [];
  let node;
  // 将遍历到的文本节点存储在数组中，以便后续分别进行短语和单词的处理。
  while ((node = walker.nextNode())) {
    textNodes.push(node);
  }

  // 先处理短语，确保短语高亮优先。
  processPhrases(textNodes);

  // 处理单个单词。
  processWords(textNodes);
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
