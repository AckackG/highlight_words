(function (global) {
  // LLM 开关缓存：避免每次 hover 都读一次 storage 造成 AI 区块闪烁
  let llmEnabledCache = null;
  async function isLlmEnabled() {
    if (llmEnabledCache !== null) return llmEnabledCache;
    try {
      const { llm_settings } = await chrome.storage.local.get("llm_settings");
      llmEnabledCache = !!(llm_settings && llm_settings.enabled && llm_settings.api_key);
    } catch (e) {
      llmEnabledCache = false;
    }
    return llmEnabledCache;
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.llm_settings) llmEnabledCache = null;
    });
  } catch (e) {}

  const TOOLTIP_GAP = 10; // 窗口与选区之间的间距

  /**
   * 统一的Tooltip控制器（窗口A）
   * 单例模式，管理主悬浮窗的显示和交互
   */
  class TooltipController {
    constructor() {
      if (TooltipController.instance) {
        return TooltipController.instance;
      }

      this.element = null;
      this.hideTimer = null;
      this.currentItem = null; // 关键：记录当前显示的完整词条数据
      this.currentContext = ""; // 关键：记录当前实时语境，跨重渲染保持，避免退化为单词本身

      // LLM 语境释义状态：与机械词典并存，异步到达后局部刷新
      // status: idle | off | loading | ok | error
      this.llmState = { status: "idle", text: "", model: "" };
      this.llmToken = 0; // 请求令牌，防止旧请求覆盖新词条的结果

      // 定位锚点（页面坐标）：内容异步变高时据此重新贴合
      this.anchorTop = null;
      this.anchorBottom = null;
      this.placeAbove = true;

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
      // 记录本次真实语境，供“更新语境”按钮在后续重渲染后仍能读到
      this.currentContext = config.context || "";

      // 生词本里已存过 AI 释义就先直接显示，随后再按当前语境刷新
      const saved = config.data && config.data.llm;
      this.llmState = saved && saved.text
        ? { status: "ok", text: saved.text, model: saved.model || "" }
        : { status: "idle", text: "", model: "" };

      this._render(config);
      this._position(config.rect);
      this.element.classList.add("vh-tooltip-visible");

      this._requestLlm(config.data.text, this.currentContext);
    }

    hide() {
      this._scheduleHide();
    }

    /**
     * 【修复】原地更新数据，不改变窗口位置
     * 用于添加生词、更新语境后的热更新
     */
    updateData(newData) {
      if (!this.element.classList.contains("vh-tooltip-visible")) return;

      this.currentItem = newData;

      // 仅重新渲染内容，不调用 _position（不重新读取目标 rect，避免窗口逐次下移）
      this._render({
        data: newData,
        mode: "hover", // 更新通常发生在 hover 查看详情模式下
        context: "", // 上下文在 update 场景下通常由 data 内部携带
      });

      // 新增语境会把窗口撑高；锚点没变，只是重新贴合，不会产生漂移
      this._reflow();
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

      // Translation（机械词典）
      html += `<div class="vh-tooltip-trans">${this._escapeHtml(translation)}</div>`;

      // AI 语境释义（独立区块，不影响词典结果）
      html += `<div class="vh-llm-block">${this._llmInnerHtml()}</div>`;

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

            // 【修改】构建来源 HTML，如果有 URL 则生成链接
            let sourceHtml = "";
            if (sourceTitle) {
              if (ctx.url) {
                // 如果有 URL，显示为链接
                // 样式说明：继承 vh-tooltip-source 的右对齐，同时覆盖颜色为链接色
                sourceHtml = `<a href="${ctx.url}" target="_blank" class="vh-tooltip-source" style="color: #4285f4; text-decoration: underline; cursor: pointer;">From: ${sourceTitle}</a>`;
              } else {
                // 无 URL，保持原样
                sourceHtml = `<span class="vh-tooltip-source">From: ${sourceTitle}</span>`;
              }
            }

            html += `
            <div class="vh-tooltip-ctx-item">
              ${cleanSentence}
              ${sourceHtml}
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
          // 读取实例上的实时语境，而非闭包里的 context：
          // updateData 重渲染会传入空 context，若用闭包会退化成把单词当语境
          this._handleAction(word, translation, this.currentContext, isSelectionMode);
        });
      }
    }

    /**
     * AI 区块内部 HTML（不含外层容器，便于局部热替换）
     */
    _llmInnerHtml() {
      const { status, text, model } = this.llmState;

      if (status === "off" || status === "idle") return "";

      const modelTag = model
        ? `<span class="vh-llm-model" title="${this._escapeHtml(model)}">${this._escapeHtml(
            model.split("/").pop()
          )}</span>`
        : "";

      if (status === "loading") {
        return `<div class="vh-llm-label">AI 语境释义</div>
          <div class="vh-llm-body vh-llm-loading">生成中…</div>`;
      }

      if (status === "error") {
        return `<div class="vh-llm-label">AI 语境释义</div>
          <div class="vh-llm-body vh-llm-error">${this._escapeHtml(text || "获取失败")}</div>`;
      }

      const lines = (text || "")
        .split("\n")
        .map((line) => `<div class="vh-llm-line">${this._escapeHtml(line)}</div>`)
        .join("");

      return `<div class="vh-llm-label">AI 语境释义 ${modelTag}</div>
        <div class="vh-llm-body">${lines}</div>`;
    }

    /** 只替换 AI 区块，避免整窗重渲染导致按钮状态/位置抖动 */
    _paintLlmBlock() {
      const block = this.element?.querySelector(".vh-llm-block");
      if (!block) return;
      block.innerHTML = this._llmInnerHtml();
      this._reflow(); // AI 区块撑高了窗口，重新贴回选区上沿
    }

    /**
     * 异步请求 LLM 语境释义
     * 词典结果先行显示，AI 结果到达后原地补上
     */
    async _requestLlm(word, context) {
      const token = ++this.llmToken;

      // 轻量防抖：鼠标扫过一串高亮词时不要逐个发起请求
      await new Promise((r) => setTimeout(r, 300));
      if (token !== this.llmToken) return;

      if (!(await isLlmEnabled())) {
        if (token !== this.llmToken) return;
        this.llmState = { status: "off", text: "", model: "" };
        this._paintLlmBlock();
        return;
      }

      if (token !== this.llmToken) return;

      // 已有存档释义时保留旧内容，只有空白时才显示 loading
      if (this.llmState.status !== "ok") {
        this.llmState = { status: "loading", text: "", model: "" };
        this._paintLlmBlock();
      }

      try {
        const res = await chrome.runtime.sendMessage({
          action: "LLM_TRANSLATE",
          text: word,
          context: context || "",
        });

        if (token !== this.llmToken) return; // 已切换到别的词

        if (!res) {
          this.llmState = { status: "error", text: "无响应", model: "" };
        } else if (res.status === "ok") {
          this.llmState = { status: "ok", text: res.text, model: res.model || "" };
          this._persistLlm(word, this.llmState);
        } else if (res.status === "disabled") {
          this.llmState = { status: "off", text: "", model: "" };
        } else {
          this.llmState = { status: "error", text: res.error || "获取失败", model: "" };
        }
      } catch (err) {
        if (token !== this.llmToken) return;
        this.llmState = { status: "error", text: err.message || "获取失败", model: "" };
      }

      this._paintLlmBlock();
    }

    /**
     * 已在生词本里的词：首次拿到 AI 释义就静默存档，
     * 这样生词本列表的「释义」列能优先展示 AI 结果。
     */
    _persistLlm(word, llm) {
      const item = this.currentItem;
      // 只处理生词本已有条目（有 id），且尚未存过 AI 释义的
      if (!item || !item.id || (item.llm && item.llm.text)) return;

      item.llm = { text: llm.text, model: llm.model || "" }; // 同步更新内存缓存，避免重复写
      NotebookAPI.setLlmTranslation(word, llm).catch(() => {});
    }

    async _handleAction(word, translation, contextSentence, isAddMode) {
      const btn = this.element.querySelector("#vh-header-action-btn");
      btn.textContent = "保存中...";
      btn.disabled = true;

      const faviconUrl = document.head.querySelector('link[rel*="icon"]')?.href || "/favicon.ico";

      const sentence = (contextSentence || "").trim();
      const payload = { text: word, translation: translation };

      // 一并存档 AI 释义，下次 hover 可直接展示
      if (this.llmState.status === "ok" && this.llmState.text) {
        payload.llm = { text: this.llmState.text, model: this.llmState.model || "" };
      }

      // 仅在存在有效语境时写入 context，绝不用单词本身兜底当句子
      if (sentence) {
        payload.context = {
          sentence,
          url: window.location.href,
          title: document.title,
          favicon: faviconUrl,
        };
      }

      await NotebookAPI.addOrUpdateWord(payload);

      btn.textContent = "已保存";
      btn.classList.add("added");

      setTimeout(() => this._scheduleHide(), 1500);
    }

    /**
     * 定位：默认放在选区**上方**。
     * 按阅读顺序，上方是已经读过的内容，挡住无所谓；
     * 放下方会盖住还没读的正文，逼着用户去移开窗口。
     * 上方空间不够时（选区靠近视口顶部）才翻到下方。
     */
    _position(rect) {
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;

      // 记录锚点的页面坐标：内容变高后要据此重新贴合，且不受滚动影响
      this.anchorTop = rect.top + scrollY;
      this.anchorBottom = rect.bottom + scrollY;

      this._withMeasurable(() => {
        // 顺序不能反：绝对定位元素的收缩宽度取决于自身 left，
        // 所以先把 left 归零量出自然宽度、定好水平位置，最后才量高度，
        // 否则换行行数算错、放上方时高度就是错的。
        this.element.style.left = "0px";
        const width = this.element.offsetWidth;

        const x = rect.left + scrollX;
        const maxX = scrollX + document.documentElement.clientWidth - width - 20;
        this.element.style.left = `${Math.max(scrollX + 10, Math.min(x, maxX))}px`;

        const height = this.element.offsetHeight;
        this.placeAbove = rect.top >= height + TOOLTIP_GAP;
        this.element.style.top = `${this._topFor(height)}px`;
      });
    }

    _topFor(height) {
      return this.placeAbove
        ? this.anchorTop - height - TOOLTIP_GAP
        : this.anchorBottom + TOOLTIP_GAP;
    }

    /**
     * 在「可量尺寸」的状态下执行 fn。
     * 元素平时是 display:none 量不出尺寸，这里临时以 visibility:hidden 撑开；
     * 加和删在同一个同步块里完成，中间不会发生绘制，所以不会闪。
     */
    _withMeasurable(fn) {
      const visible = this.element.classList.contains("vh-tooltip-visible");
      if (!visible) {
        this.element.style.visibility = "hidden";
        this.element.classList.add("vh-tooltip-visible");
      }

      try {
        fn();
      } finally {
        if (!visible) {
          this.element.classList.remove("vh-tooltip-visible");
          this.element.style.visibility = "";
        }
      }
    }

    /**
     * 内容变高后重新贴合锚点。
     * 放在上方时窗口是靠 top 定位的，AI 释义异步补入会把窗口往下撑，
     * 不重新上移就会盖住刚划的那个词。
     * 复用已存的锚点坐标（不重新读取目标 rect），因此不会出现窗口逐次下移。
     */
    _reflow() {
      if (this.anchorTop == null) return;
      if (!this.element.classList.contains("vh-tooltip-visible")) return;

      const height = this.element.offsetHeight;

      // 长高之后上方装不下了，就翻到下方，别顶出页面外
      if (this.placeAbove && this.anchorTop - height - TOOLTIP_GAP < window.scrollY) {
        this.placeAbove = false;
      }

      this.element.style.top = `${this._topFor(height)}px`;
    }

    _scheduleHide() {
      if (this.hideTimer) clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => {
        this.element.classList.remove("vh-tooltip-visible");
        this.currentItem = null; // 清空当前项
        this.currentContext = "";
        this.llmToken++; // 作废挂起中的 AI 请求，避免回填到已关闭的窗口
        this.llmState = { status: "idle", text: "", model: "" };
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
  global.TooltipController = TooltipController;
})(globalThis);
