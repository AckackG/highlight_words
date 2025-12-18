import { NotebookAPI } from "../utils/notebook-api.js";

/**
 * 统一的Tooltip控制器（窗口A）
 * 单例模式，管理主悬浮窗的显示和交互
 */
export class TooltipController {
  constructor() {
    if (TooltipController.instance) {
      return TooltipController.instance;
    }

    this.element = null;
    this.hideTimer = null;
    this.currentItem = null; // 关键：记录当前显示的完整词条数据

    this._init();
    TooltipController.instance = this;
  }

  _init() {
    this.element = document.createElement("div");
    this.element.className = "vh-custom-tooltip";
    document.body.appendChild(this.element);

    this.element.addEventListener("mouseenter", () => this._cancelHide());
    this.element.addEventListener("mouseleave", () => this._scheduleHide());
  }

  /**
   * 显示Tooltip
   * @param {object} config
   * @param {DOMRect} config.rect - 定位参考
   * @param {object} config.data - 词条数据
   * @param {string} config.mode - 'hover' | 'selection'
   * @param {string} config.context - 当前语境
   */
  show(config) {
    this._cancelHide();

    // 保存当前显示的完整词条（包含历史语境）
    this.currentItem = config.data;

    this._render(config);
    this._position(config.rect);
    this.element.classList.add("vh-tooltip-visible");
  }

  hide() {
    this._scheduleHide();
  }

  _render(config) {
    const { data, mode, context } = config;
    const isSelectionMode = mode === "selection";
    const word = data.text;
    const translation = data.translation || "暂无释义";

    let html = "";

    // Header
    html += `<div class="vh-tooltip-header">
      <span>${this._escapeHtml(word)}</span>
      <button id="vh-header-action-btn" class="vh-add-btn">
        ${isSelectionMode ? "加入生词本" : "更新语境"}
      </button>
    </div>`;

    // Translation
    html += `<div class="vh-tooltip-trans">${this._escapeHtml(translation)}</div>`;

    // Note & Contexts (仅 Hover 模式)
    if (!isSelectionMode) {
      if (data.note) {
        html += `<div class="vh-tooltip-ctx-item" style="color:#198754; background:#e8f5e9; border-left: 3px solid #198754;">
          <b>笔记:</b> ${this._escapeHtml(data.note)}
        </div>`;
      }

      if (data.contexts && data.contexts.length > 0) {
        html += `<div class="vh-tooltip-ctx-label" style="margin-top:8px;">最新语境：</div>`;
        const recentContexts = data.contexts.slice(-3).reverse();

        recentContexts.forEach((ctx) => {
          let cleanSentence = this._escapeHtml(ctx.sentence.trim().replace(/\s+/g, " "));

          // 高亮目标词
          try {
            const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(`(${escapedWord})`, "gi");
            cleanSentence = cleanSentence.replace(
              regex,
              '<span class="vh-ctx-highlight">$1</span>'
            );
          } catch (e) {}

          let sourceTitle = ctx.title || "";
          if (sourceTitle.length > 65) {
            sourceTitle = sourceTitle.slice(0, 30) + "..." + sourceTitle.slice(-30);
          }

          html += `
            <div class="vh-tooltip-ctx-item">
              ${cleanSentence}
              ${sourceTitle ? `<span class="vh-tooltip-source">From: ${sourceTitle}</span>` : ""}
            </div>
          `;
        });
      }
    }

    this.element.innerHTML = html;
    this.element.dataset.currentWord = word;

    // 绑定按钮事件
    const actionBtn = this.element.querySelector("#vh-header-action-btn");
    if (actionBtn) {
      actionBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._handleAction(word, translation, context, isSelectionMode);
      });
    }
  }

  async _handleAction(word, translation, contextSentence, isAddMode) {
    const btn = this.element.querySelector("#vh-header-action-btn");
    btn.textContent = "保存中...";
    btn.disabled = true;

    const faviconUrl = document.head.querySelector('link[rel*="icon"]')?.href || "/favicon.ico";

    await NotebookAPI.addOrUpdateWord({
      text: word,
      translation: translation,
      context: {
        sentence: contextSentence || word,
        url: window.location.href,
        title: document.title,
        favicon: faviconUrl,
      },
    });

    btn.textContent = "已保存";
    btn.classList.add("added");

    setTimeout(() => this._scheduleHide(), 1500);
  }

  _position(rect) {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    let x = rect.left + scrollX;
    let y = rect.bottom + scrollY + 10;

    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;

    // 边界检测
    setTimeout(() => {
      const tooltipRect = this.element.getBoundingClientRect();
      if (tooltipRect.right > window.innerWidth) {
        this.element.style.left = `${window.innerWidth - tooltipRect.width - 20}px`;
      }
    }, 0);
  }

  _scheduleHide() {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.element.classList.remove("vh-tooltip-visible");
      this.currentItem = null; // 清空当前项
    }, 500);
  }

  _cancelHide() {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  _escapeHtml(text) {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
