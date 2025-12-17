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

    if (!text || text.length > 50) return; // 忽略太长的选择
    // 忽略在输入框内的选择
    if (
      e.target.tagName === "INPUT" ||
      e.target.tagName === "TEXTAREA" ||
      e.target.isContentEditable
    )
      return;

    // 获取位置
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // 查词
    const result = await chrome.runtime.sendMessage({
      action: "LOOKUP_WORD",
      text: text,
    });

    this.renderPopup(rect, result, text);
  }

  /**
   * 核心修改：获取完整的语境句子
   */
  getContextSentence(selection) {
    // 1. 获取选区所在的文本节点
    const anchorNode = selection.anchorNode;
    if (!anchorNode) return selection.toString();

    // 2. 获取包含该文本的块级父元素 (通常是 p, div, li, span)
    // 向上寻找最近的块级元素，或者直接取 parentElement
    let container = anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode;

    // 获取整段纯文本
    const fullText = container.innerText || container.textContent;

    // 清理一下空白字符，避免换行符干扰
    const cleanFullText = fullText.replace(/\s+/g, " ").trim();
    const selectedText = selection.toString().trim();

    try {
      // 3. 使用 Chrome 原生的 Intl.Segmenter 进行智能分句 (现代浏览器支持)
      // 这比简单的 split('.') 要强大得多，能识别 "Mr. Smith" 中的点不是句号
      const segmenter = new Intl.Segmenter(navigator.language, { granularity: "sentence" });
      const segments = segmenter.segment(cleanFullText);

      // 找到包含我们选中单词的那个句子
      for (const segment of segments) {
        if (segment.segment.includes(selectedText)) {
          return segment.segment.trim();
        }
      }
    } catch (e) {
      console.warn("Intl.Segmenter not supported or error, fallback to regex/full text");
    }

    // 4. 降级方案：如果分句失败，或者找不到匹配，返回包含该词的整段文本(截取适中长度)
    // 这里的逻辑是：如果整段太长（超过200字符），就截取前后一部分
    if (cleanFullText.length > 200) {
      const index = cleanFullText.indexOf(selectedText);
      const start = Math.max(0, index - 50);
      const end = Math.min(cleanFullText.length, index + selectedText.length + 50);
      return "..." + cleanFullText.substring(start, end) + "...";
    }

    return cleanFullText;
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

  renderPopup(rect, result, originalText) {
    this.createShadowDOM();

    const top = rect.bottom + window.scrollY + 10;
    const left = Math.max(10, rect.left + window.scrollX);

    const container = document.createElement("div");
    container.className = "vh-popup";
    this.host.style.transform = `translate(${left}px, ${top}px)`;

    const isHit = result.status === "hit";
    const data = result.data;

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

    if (!isHit) {
      html += `<button id="vh-add-btn" class="vh-btn">加入生词本</button>`;
    } else {
      html += `<button class="vh-btn added">已在生词本中</button>`;
    }

    container.innerHTML = html;
    this.shadow.appendChild(container);

    if (!isHit) {
      const btn = this.shadow.getElementById("vh-add-btn");
      btn.addEventListener("click", () => {
        this.addToNotebook(data.text, data.translation);
        btn.textContent = "已添加";
        btn.classList.add("added");
      });
    }
  }

  async addToNotebook(text, translation) {
    // 获取当前选区，用于提取句子
    const selection = window.getSelection();

    // 【修改点】调用新写的 getContextSentence 获取真正包含上下文的句子
    const sentence = this.getContextSentence(selection);

    // 这能覆盖: rel="icon", rel="shortcut icon", rel="apple-touch-icon" 等
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
          favicon: faviconUrl, // 使用获取到的 favicon
        },
      },
    });
    // 显示 Toast 提示
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
