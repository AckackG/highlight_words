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

    if (!text || text.length > 50) return; // 忽略太长的句子
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
    // 简单定位防溢出逻辑略...
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
    await chrome.runtime.sendMessage({
      action: "ADD_WORD",
      data: {
        text: text,
        translation: translation,
        context: {
          sentence: window.getSelection().toString(), // 存整句
          url: window.location.href,
          title: document.title,
          favicon: document.querySelector('link[rel="icon"]')?.href || "/favicon.ico",
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
