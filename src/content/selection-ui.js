class SelectionUI {
  constructor() {
    this.host = null;
    this.shadow = null;
    this.contextExtractor = new ContextExtractor();
    this.tooltipController = new TooltipController();
    this.init();
  }

  init() {
    document.addEventListener("mouseup", (e) => this.handleSelection(e));
    document.addEventListener("mousedown", (e) => {
      if (this.host && !this.host.contains(e.target)) {
        this.removeUI();
      }
    });
  }

  removeUI() {
    if (this.host) {
      this.host.remove();
      this.host = null;
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

      // 判断是否在窗口A内部
      const isInsideTooltipA = e.target.closest(".vh-custom-tooltip");

      // 提取语境（统一使用 ContextExtractor）
      // 【FIX 2】: 如果是在信息窗A内部划词，不应该提取当前页面的DOM语境，
      // 而是应该继承 触发信息窗A的那个单词 对应的语境。
      let currentSentence = "";
      if (isInsideTooltipA && this.tooltipController.currentItem) {
        // 从当前显示的 Item 中获取最新语境
        const contexts = this.tooltipController.currentItem.contexts;
        if (contexts && contexts.length > 0) {
          currentSentence = contexts[contexts.length - 1].sentence;
        } else {
          // Fallback if no context exists on item
          currentSentence = this.tooltipController.currentItem.text;
        }
      } else {
        // 正常页面划词，提取 DOM 语境
        currentSentence = this.contextExtractor.extract(selection, text);
      }

      // 查词
      const result = await chrome.runtime.sendMessage({
        action: "LOOKUP_WORD",
        text: text,
      });
      const data = result.data || { text: text, translation: "查询失败" };
      const isKnownWord = result.status === "hit"; // 检查是否已存在于生词本

      if (isInsideTooltipA) {
        // 场景：在窗口A内部划词 → 使用窗口B（ShadowDOM小窗口）
        this.renderPopupB(rect, data, text, currentSentence);
      } else {
        // 场景：在普通网页划词 → 使用窗口A（统一大窗口）

        // 【FIX 1】: 如果单词已经在生词本中 (isKnownWord)，显示 'hover' 模式（完整信息），
        // 否则显示 'selection' 模式（仅翻译+添加按钮）。这样保持了一致性。
        this.tooltipController.show({
          rect: rect,
          data: data,
          mode: isKnownWord ? "hover" : "selection",
          context: currentSentence,
        });
      }
    }, 10);
  }

  /**
   * 渲染窗口B（仅用于窗口A内部划词）
   */
  /**
   * 渲染窗口B（仅用于窗口A内部划词）
   */
  renderPopupB(rect, data, originalText, currentSentence) {
    // 【修改】获取主窗口(Tooltip A)的引用
    const tooltipElement = this.tooltipController.element;

    // 如果主窗口不存在（异常情况），回退到 body
    const targetParent = tooltipElement || document.body;

    // 创建 Shadow DOM，挂载到主窗口内
    this.createShadowDOM(targetParent);

    // 【修改】计算定位：相对于父容器 (Tooltip A) 的坐标
    let top, left;

    if (targetParent === tooltipElement) {
      // 相对定位模式：目标 Rect - 父容器 Rect
      const parentRect = tooltipElement.getBoundingClientRect();
      // 这里不需要加 scrollY，因为 parentRect 和 rect 都是视口坐标 (Viewport based)
      // 我们需要的是相对于 parent 左上角的位移
      top = rect.bottom - parentRect.top + 5;
      left = rect.left - parentRect.left;
    } else {
      // 绝对定位模式 (Fallback)：原始逻辑
      top = rect.bottom + window.scrollY + 5;
      left = rect.left + window.scrollX;
    }

    const container = document.createElement("div");
    container.className = "vh-popup";

    // 应用计算后的坐标
    this.host.style.transform = `translate(${left}px, ${top}px)`;

    let html = `
      <div class="vh-header">
        <span>${data.text}</span>
        <button class="vh-mini-add-btn" id="vh-mini-add" title="添加到生词本">+</button>
      </div>
      <div class="vh-trans">${data.translation}</div>
    `;
    container.innerHTML = html;
    this.shadow.appendChild(container);

    // 绑定添加按钮
    const addBtn = this.shadow.getElementById("vh-mini-add");
    if (addBtn) {
      addBtn.addEventListener("click", async (e) => {
        e.stopPropagation();

        // 关键：从 TooltipController.currentItem 获取历史来源
        await this.addToNotebookFromHistory(data.text, data.translation, currentSentence);

        addBtn.style.background = "#198754";
        addBtn.style.borderColor = "#198754";
        addBtn.style.color = "#fff";
        addBtn.textContent = "✓";

        setTimeout(() => this.removeUI(), 1000);
      });
    }
  }

  /**
   * 添加到生词本（使用历史来源）
   */
  async addToNotebookFromHistory(text, translation, sentence) {
    let ctxUrl = window.location.href;
    let ctxTitle = document.title;
    let ctxFavicon = document.head.querySelector('link[rel*="icon"]')?.href || "/favicon.ico";

    // 关键：检查是否有当前显示的历史词条
    if (this.tooltipController.currentItem) {
      const currentItem = this.tooltipController.currentItem;

      // 如果有历史语境，使用最新的那条作为来源
      if (currentItem.contexts && currentItem.contexts.length > 0) {
        const latestContext = currentItem.contexts[currentItem.contexts.length - 1];
        ctxUrl = latestContext.url || ctxUrl;
        ctxTitle = latestContext.title || ctxTitle;
        ctxFavicon = latestContext.favicon || ctxFavicon;
      }
    }

    await NotebookAPI.addOrUpdateWord({
      text: text,
      translation: translation,
      context: {
        sentence: sentence,
        url: ctxUrl,
        title: ctxTitle,
        favicon: ctxFavicon,
      },
    });

    this.showToast("已添加到生词本");
  }

  createShadowDOM(targetParent = document.body) {
    this.removeUI();
    this.host = document.createElement("div");
    this.host.style.position = "absolute";
    this.host.style.zIndex = "2147483647";
    this.host.style.top = "0";
    this.host.style.left = "0";

    // 【修改】挂载到指定的父容器 (即 Tooltip A)
    targetParent.appendChild(this.host);

    this.shadow = this.host.attachShadow({ mode: "open" });

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
        width: 220px;
        text-align: left;
      }
      /* ... (保持原有 CSS 不变) ... */
      .vh-header { 
        font-weight: bold;
        margin-bottom: 5px; 
        color: #4285f4;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
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
      .vh-trans { 
        margin-bottom: 0;
        line-height: 1.4; 
      }
    `;
    this.shadow.appendChild(style);
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

new SelectionUI();
