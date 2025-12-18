class SelectionUI {
  constructor() {
    this.host = null;
    this.shadow = null;
    this.popup = null;
    this.init();
  }

  init() {
    document.addEventListener("mouseup", (e) => this.handleSelection(e));
    document.addEventListener("mousedown", (e) => {
      // 点击非 UI 区域关闭弹窗
      if (this.host && !this.host.contains(e.target)) {
        this.removeUI();
      }
    });
  }

  removeUI() {
    if (this.host) {
      this.host.remove();
      this.host = null;
      this.popup = null;
    }
  }

  async handleSelection(e) {
    setTimeout(async () => {
      const selection = window.getSelection();
      const text = selection.toString().trim();

      // 校验逻辑
      if (window.VocabularyValidator && !window.VocabularyValidator.isValid(text, e.target)) {
        return;
      }
      if (!window.VocabularyValidator && (!text || text.length > 50)) return;

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // 默认句子获取逻辑
      let currentSentence = this.getContextSentence(selection);

      // 查词
      const result = await chrome.runtime.sendMessage({
        action: "LOOKUP_WORD",
        text: text,
      });
      const data = result.data || { text: text, translation: "查询失败" };

      // 检测是否在 Tooltip 内部
      const tooltipWrapper = e.target.closest(".vh-custom-tooltip");
      const shadowWrapper = e.target.closest(".vh-popup"); // Window A

      if (tooltipWrapper || shadowWrapper) {
        // 【核心修复 3 - Step B】: 检查是否在带有历史来源信息的 Context Item 内部
        // 如果是，劫持数据来源
        const contextItem = e.target.closest("[data-origin-url]");
        if (contextItem) {
          const originUrl = contextItem.dataset.originUrl;
          const originTitle = contextItem.dataset.originTitle;

          // 这里我们扩展 data 对象，或者更直接地——修改 handleAddToNotebook 的调用方式

          // 方案：把 origin 信息挂载到 data 上，传给 UI
          data._forceContext = {
            url: originUrl,
            title: originTitle,
            // sentence 依然使用选区所在的句子 (即 currentSentence)
            sentence: currentSentence,
          };
        }
      }

      // 分流显示
      if (tooltipWrapper) {
        // 在 Tooltip 内部划词，使用 ShadowDOM (Window A) 显示小窗
        this.renderPopup(rect, result, text, currentSentence);
      } else {
        // 普通网页划词，使用 Window B
        if (window.VocabularyTooltip) {
          window.VocabularyTooltip.show(rect, data, "selection", currentSentence);
        }
      }
    }, 10);
  }

  /**
   * 修复版：获取语境句子
   * 策略：
   * 1. 从当前节点向上回溯。
   * 2. 遇到 `highlighted-word` (插件生成的) -> 跳过，继续向上。
   * 3. 遇到 块级标签 (Block Level) -> 停止 (这是语义边界)。
   * 4. 遇到 内联标签 (Inline) -> 如果包含额外文本则停止，否则继续(视为样式包裹)。
   */
  getContextSentence(selection) {
    const anchorNode = selection.anchorNode;
    if (!anchorNode) return selection.toString();

    let container = anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode;

    // 定义块级元素白名单 (遇到这些标签必须停止，防止回溯到 body)
    const blockTags = new Set([
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

    // 向上查找循环
    while (container && container !== document.body) {
      const tagName = container.tagName.toUpperCase();

      // 1. 如果是我们的高亮包裹层，必须无条件跳过
      if (container.classList.contains("highlighted-word")) {
        container = container.parentElement;
        continue;
      }

      // 2. 如果遇到了块级元素 (Block)，这通常是句子的最大容器，停止回溯
      if (blockTags.has(tagName)) {
        break;
      }

      // 3. 如果是内联元素 (Inline: span, b, i, a, strong...)
      // 检查里面是否有足够多的内容（防止只是一个单纯的加粗 <b>Word</b>）
      const currentText = container.textContent || "";
      const selectedText = selection.toString();

      // 如果容器文本明显长于选中词（比如长出 10 个字符），说明这个 inline 标签本身就是语境容器
      // (例如 <span class="comment">This is a long comment.</span>)
      if (currentText.length > selectedText.length + 10) {
        break;
      }

      // 否则，继续向上找
      if (container.parentElement) {
        container = container.parentElement;
      } else {
        break;
      }
    }

    // --- 下面的逻辑保持不变：从找到的容器中提取句子 ---

    // 获取纯文本
    const fullText = (container.innerText || container.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    const selectedText = selection.toString().trim();

    try {
      const segmenter = new Intl.Segmenter(navigator.language, { granularity: "sentence" });
      const segments = segmenter.segment(fullText);

      for (const segment of segments) {
        if (segment.segment.includes(selectedText)) {
          return segment.segment.trim();
        }
      }
    } catch (e) {
      console.warn("Intl.Segmenter error, fallback to container text");
    }

    if (fullText.length > 200) {
      const index = fullText.indexOf(selectedText);
      const start = Math.max(0, index - 50);
      const end = Math.min(fullText.length, index + selectedText.length + 50);
      return "..." + fullText.substring(start, end) + "...";
    }

    return fullText || selectedText;
  }

  createShadowDOM() {
    this.removeUI();
    this.host = document.createElement("div");
    this.host.style.position = "absolute";
    // 确保比 Window B (2147483600) 更高
    this.host.style.zIndex = "2147483647";
    this.host.style.top = "0";
    this.host.style.left = "0";
    document.body.appendChild(this.host);
    this.shadow = this.host.attachShadow({ mode: "open" });

    // ... (保留原有样式注入，不做大的改动) ...
    const style = document.createElement("style");
    style.textContent = `
      .vh-popup {
        background: #fff;
        border: 1px solid #ccc;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        border-radius: 6px;
        padding: 10px;
        font-family: sans-serif;
        font-size: 14px;
        color: #333;
        width: 220px; /* 稍微改小一点，因为只是辅助查词 */
        text-align: left;
      }
      .vh-header { 
        font-weight: bold; 
        margin-bottom: 5px; 
        color: #4285f4;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      /* 【需求 2】新增按钮样式 */
      .vh-mini-add-btn {
        background: none;
        border: 1px solid #4285f4;
        color: #4285f4;
        border-radius: 4px;
        width: 20px;
        height: 20px;
        font-size: 16px;
        line-height: 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }
      .vh-mini-add-btn:hover {
        background: #4285f4;
        color: #fff;
      }
      .vh-trans { margin-bottom: 0; line-height: 1.4; }
    `;
    this.shadow.appendChild(style);
  }

  renderPopup(rect, result, originalText, currentSentence) {
    this.createShadowDOM();
    const top = rect.bottom + window.scrollY + 5;
    const left = rect.left + window.scrollX;

    const container = document.createElement("div");
    container.className = "vh-popup";
    this.host.style.transform = `translate(${left}px, ${top}px)`;

    const data = result.data;

    // UI 渲染
    let html = `
      <div class="vh-header">
        <span>${data.text}</span>
        <button class="vh-mini-add-btn" id="vh-mini-add" title="添加到生词本">+</button>
      </div>
      <div class="vh-trans">${data.translation}</div>
    `;
    container.innerHTML = html;
    this.shadow.appendChild(container);

    // 绑定事件
    const addBtn = this.shadow.getElementById("vh-mini-add");
    if (addBtn) {
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();

        // 【核心修复 3 - Step C】: 检查是否有强制指定的来源 (来自 Tooltip 历史语境)
        let overrideContext = null;
        if (data._forceContext) {
          overrideContext = data._forceContext;
        }

        this.addToNotebook(data.text, data.translation, currentSentence, overrideContext);

        // Feedback
        addBtn.style.background = "#198754";
        addBtn.style.borderColor = "#198754";
        addBtn.style.color = "#fff";
        addBtn.textContent = "✓";
        setTimeout(() => this.removeUI(), 1000);
      });
    }
  }

  async addToNotebook(text, translation, preCalculatedSentence, overrideContext = null) {
    let sentence = preCalculatedSentence;
    if (!sentence) {
      const selection = window.getSelection();
      sentence = this.getContextSentence(selection);
    }

    // 默认来源：当前页面
    let ctxUrl = window.location.href;
    let ctxTitle = document.title;
    let ctxFavicon = document.head.querySelector('link[rel*="icon"]')?.href || "/favicon.ico";

    // 【核心修复 3 - Step D】: 如果有 overrideContext，使用历史来源
    if (overrideContext) {
      ctxUrl = overrideContext.url || ctxUrl;
      ctxTitle = overrideContext.title || ctxTitle;
      // Favicon 比较难获取历史的，暂且保留当前的或置空，或者后端自己处理
    }

    await chrome.runtime.sendMessage({
      action: "ADD_WORD",
      data: {
        text: text,
        translation: translation,
        context: {
          sentence: sentence,
          url: ctxUrl,
          title: ctxTitle,
          favicon: ctxFavicon,
        },
      },
    });
    this.showToast("已添加到生词本");
  }

  showToast(msg) {
    const toast = document.createElement("div");
    toast.textContent = msg;
    toast.style.cssText = `
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      background: #333; color: #fff; padding: 8px 16px; border-radius: 4px;
      z-index: 2147483647; font-size: 13px; opacity: 0; transition: opacity 0.3s;
    `;
    document.body.appendChild(toast);
    setTimeout(() => (toast.style.opacity = "1"), 10);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }
}

// 初始化
new SelectionUI();
