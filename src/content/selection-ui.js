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
    const selection = window.getSelection();
    const text = selection.toString().trim();

    // 【修改】调用外部验证器
    // 确保 validator 已加载 (防御性编程)
    if (window.VocabularyValidator && !window.VocabularyValidator.isValid(text, e.target)) {
      return;
    }
    // 如果 validator 未加载(极少情况)，回退到简单的长度检查
    if (!window.VocabularyValidator && (!text || text.length > 50)) return;

    // 获取位置
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Pre-calculate sentence for UI logic (checking if context exists)
    const currentSentence = this.getContextSentence(selection);

    // 查词
    const result = await chrome.runtime.sendMessage({
      action: "LOOKUP_WORD",
      text: text,
    });

    // Pass currentSentence to render logic
    this.renderPopup(rect, result, text, currentSentence);
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
    this.host.style.zIndex = "2147483647";
    this.host.style.top = "0";
    this.host.style.left = "0";
    document.body.appendChild(this.host);

    this.shadow = this.host.attachShadow({ mode: "open" });

    // 注入样式
    const style = document.createElement("style");
    style.textContent = `
      .vh-popup {
        background: #fff;
        border: 1px solid #ccc;
        box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        border-radius: 6px;
        padding: 10px;
        font-family: sans-serif;
        font-size: 14px;
        color: #333;
        width: 260px;
        text-align: left;
      }
      .vh-header { font-weight: bold; margin-bottom: 5px; color: #4285f4; display: flex; justify-content: space-between;}
      .vh-trans { margin-bottom: 8px; line-height: 1.4; }
      .vh-note { background: #f9f9f9; padding: 5px; border-left: 3px solid #4caf50; font-size: 12px; margin-bottom: 8px; color: #555; }
      .vh-btn {
        background: #4285f4; color: white; border: none; padding: 5px 10px;
        border-radius: 4px; cursor: pointer; width: 100%; font-size: 12px;
      }
      .vh-btn:hover { background: #3367d6; }
      .vh-btn.added { background: #ccc; cursor: default; }
      .vh-badge { background: #4caf50; color: white; padding: 1px 4px; border-radius: 3px; font-size: 10px; margin-left: 5px; }
    `;
    this.shadow.appendChild(style);
  }

  renderPopup(rect, result, originalText, currentSentence) {
    this.createShadowDOM();
    const top = rect.bottom + window.scrollY + 10;
    const left = Math.max(10, rect.left + window.scrollX);

    const container = document.createElement("div");
    container.className = "vh-popup";
    this.host.style.transform = `translate(${left}px, ${top}px)`;

    const isHit = result.status === "hit";
    const data = result.data;

    // Logic: Check if the specific context already exists
    let isContextKnown = false;
    if (isHit && data.contexts) {
      isContextKnown = data.contexts.some((c) => c.sentence.trim() === currentSentence.trim());
    }

    let html = `
      <div class="vh-header">
        <span>${data.text}</span>
        ${isHit ? '<span class="vh-badge">已收藏</span>' : ""}
      </div>
      <div class="vh-trans">${data.translation}</div>
    `;

    if (isHit && data.note) {
      html += `<div class="vh-note">笔记: ${data.note}</div>`;
    }

    // Button Logic
    if (!isHit) {
      // New Word
      html += `<button id="vh-add-btn" class="vh-btn">加入生词本</button>`;
    } else if (!isContextKnown) {
      // Existing Word, New Context
      html += `<button id="vh-add-btn" class="vh-btn">添加当前语境</button>`;
    } else {
      // Existing Word, Existing Context
      html += `<button class="vh-btn added">已在生词本中</button>`;
    }

    container.innerHTML = html;
    this.shadow.appendChild(container);

    // Bind event only if we have an active button
    if (!isHit || !isContextKnown) {
      const btn = this.shadow.getElementById("vh-add-btn");
      if (btn) {
        btn.addEventListener("click", () => {
          // Pass the pre-calculated sentence to avoid re-calculation
          this.addToNotebook(data.text, data.translation, currentSentence);

          if (isHit) {
            btn.textContent = "语境已更新";
          } else {
            btn.textContent = "已添加";
          }
          btn.classList.add("added");
        });
      }
    }
  }

  async addToNotebook(text, translation, preCalculatedSentence) {
    // Use pre-calculated sentence if available, otherwise get from selection
    let sentence = preCalculatedSentence;
    if (!sentence) {
      const selection = window.getSelection();
      sentence = this.getContextSentence(selection);
    }

    const faviconUrl = document.head.querySelector('link[rel*="icon"]')?.href || "/favicon.ico";

    await chrome.runtime.sendMessage({
      action: "ADD_WORD",
      data: {
        text: text,
        translation: translation,
        context: {
          sentence: sentence,
          url: window.location.href,
          title: document.title,
          favicon: faviconUrl,
        },
      },
    });
    // 显示 Toast 提示
    this.showToast(preCalculatedSentence ? "语境已更新" : "已添加到生词本");
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
