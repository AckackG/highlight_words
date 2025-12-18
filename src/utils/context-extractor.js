(function (global) {
  /**
   * 统一的语境提取工具
   * 完全基于 selection-ui.js 的 getContextSentence 逻辑
   */
  class ContextExtractor {
    constructor(options = {}) {
      this.maxLength = options.maxLength || 200;
      this.contextRadius = options.contextRadius || 60;

      // 块级标签白名单
      this.blockTags = new Set([
        "P",
        "DIV",
        "LI",
        "UL",
        "OL",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "TR",
        "TD",
        "TH",
        "TABLE",
        "TBODY",
        "THEAD",
        "ARTICLE",
        "SECTION",
        "MAIN",
        "HEADER",
        "FOOTER",
        "BLOCKQUOTE",
        "PRE",
        "FORM",
      ]);
    }

    /**
     * 从多种输入源提取语境
     * @param {Node|Selection} source - DOM节点或Selection对象
     * @param {string} targetWord - 目标词（用于定位）
     * @returns {string} 提取的语境文本
     */
    extract(source, targetWord) {
      let container;

      if (source instanceof Selection) {
        container = this._findContainerFromSelection(source);
      } else {
        // 从Node提取
        container = this._findContainerFromNode(source);
      }

      if (!container) return targetWord;

      const fullText = (container.innerText || container.textContent || "")
        .replace(/\s+/g, " ")
        .trim();

      const selectedText = targetWord.trim();

      return this._extractContextFromText(fullText, selectedText);
    }

    /**
     * 从Selection对象找到容器
     */
    _findContainerFromSelection(selection) {
      const anchorNode = selection.anchorNode;
      if (!anchorNode) return null;

      let container =
        anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode;

      // 向上查找循环
      while (container && container !== document.body) {
        const tagName = container.tagName.toUpperCase();

        // 1. 跳过高亮包裹层
        if (container.classList.contains("highlighted-word")) {
          container = container.parentElement;
          continue;
        }

        // 2. 遇到块级元素停止
        if (this.blockTags.has(tagName)) {
          break;
        }

        // 3. 检查内联元素是否有足够内容
        const currentText = container.textContent || "";
        const selectedText = selection.toString();

        if (currentText.length > selectedText.length + 10) {
          break;
        }

        // 继续向上
        if (container.parentElement) {
          container = container.parentElement;
        } else {
          break;
        }
      }

      return container;
    }

    /**
     * 从Node找到容器
     */
    _findContainerFromNode(node) {
      let container = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;

      while (container && container !== document.body) {
        const tagName = container.tagName?.toUpperCase();

        if (container.classList?.contains("highlighted-word")) {
          container = container.parentElement;
          continue;
        }

        if (tagName && this.blockTags.has(tagName)) {
          break;
        }

        container = container.parentElement;
      }

      return container;
    }

    /**
     * 从完整文本中提取上下文
     */
    _extractContextFromText(fullText, selectedText) {
      // 尝试使用 Intl.Segmenter 智能分句
      try {
        const segmenter = new Intl.Segmenter(navigator.language, {
          granularity: "sentence",
        });
        const segments = segmenter.segment(fullText);

        for (const segment of segments) {
          if (segment.segment.includes(selectedText)) {
            return segment.segment.trim();
          }
        }
      } catch (e) {
        console.warn("Intl.Segmenter not available, using fallback");
      }

      // 回退方案：截断处理
      if (fullText.length > this.maxLength) {
        const index = fullText.indexOf(selectedText);
        if (index !== -1) {
          const start = Math.max(0, index - this.contextRadius);
          const end = Math.min(fullText.length, index + selectedText.length + this.contextRadius);
          return "..." + fullText.substring(start, end) + "...";
        }
      }

      return fullText || selectedText;
    }
  }
  global.ContextExtractor = ContextExtractor;
})(globalThis);
