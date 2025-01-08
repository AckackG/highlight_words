// 使用Set来存储单词，提高查找效率
let vocabularySet = new Set();

// 初始化时从storage获取词表
chrome.storage.local.get(["vocabulary"], function (result) {
  if (result.vocabulary) {
    vocabularySet = new Set(result.vocabulary);
    highlightWords();
  }
});

// 监听storage变化
chrome.storage.onChanged.addListener((changes) => {
  if (changes.vocabulary) {
    vocabularySet = new Set(changes.vocabulary.newValue);
    highlightWords();
  }
});

function highlightWords() {
  // 使用TreeWalker遍历文本节点，性能优于递归
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);

  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    textNodes.push(node);
  }

  // 使用正则表达式一次性匹配所有单词
  const wordRegex = /\b[a-zA-Z]+\b/g;

  textNodes.forEach((textNode) => {
    const parent = textNode.parentNode;
    if (parent.nodeName === "SCRIPT" || parent.nodeName === "STYLE") {
      return;
    }

    const text = textNode.nodeValue;
    let lastIndex = 0;
    const fragments = [];
    let match;

    while ((match = wordRegex.exec(text)) !== null) {
      const word = match[0];
      if (vocabularySet.has(word.toLowerCase())) {
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
    }
  });
}

function createHighlightSpan(word) {
  const span = document.createElement("span");
  span.className = "vocabulary-highlight";
  span.textContent = word;
  return span;
}
