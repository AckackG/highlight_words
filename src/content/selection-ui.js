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

      // 提取语境（统一使用 ContextExtractor）
      const currentSentence = this.contextExtractor.extract(selection, text);

      // 查词
      const result = await chrome.runtime.sendMessage({
        action: "LOOKUP_WORD",
        text: text,
      });
      const data = result.data || { text: text, translation: "查询失败" };

      // 判断是否在窗口A内部
      const isInsideTooltipA = e.target.closest(".vh-custom-tooltip");

      if (isInsideTooltipA) {
        // 场景：在窗口A内部划词 → 使用窗口B（ShadowDOM小窗口）
        this.renderPopupB(rect, data, text, currentSentence);
      } else {
        // 场景：在普通网页划词 → 使用窗口A（统一大窗口）
        this.tooltipController.show({
          rect: rect,
          data: data,
          mode: "selection",
          context: currentSentence,
        });
      }
    }, 10);
  }

  /**
   * 渲染窗口B（仅用于窗口A内部划词）
   */
  renderPopupB(rect, data, originalText, currentSentence) {
    this.createShadowDOM();

    const top = rect.bottom + window.scrollY + 5;
    const left = rect.left + window.scrollX;

    const container = document.createElement("div");
    container.className = "vh-popup";
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

  createShadowDOM() {
    this.removeUI();
    this.host = document.createElement("div");
    this.host.style.position = "absolute";
    this.host.style.zIndex = "2147483647";
    this.host.style.top = "0";
    this.host.style.left = "0";
    document.body.appendChild(this.host);
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
