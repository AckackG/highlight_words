(function (global) {
  /**
   * 生词本数据访问层
   * 统一封装所有 chrome.storage 操作
   */
  class NotebookAPI {
    /**
     * 获取完整生词本
     */
    static async getNotebook() {
      return new Promise((resolve) => {
        chrome.storage.local.get("notebook", (result) => {
          resolve(result.notebook || []);
        });
      });
    }

    /**
     * 添加或更新单词
     */
    static async addOrUpdateWord(wordData) {
      const { text, translation, context, note } = wordData;
      const notebook = await this.getNotebook();

      let item = notebook.find((i) => i.text.toLowerCase() === text.trim().toLowerCase());

      if (item) {
        // 更新现有词条
        const contextExists = item.contexts.some(
          (c) => c.sentence.trim() === context.sentence.trim()
        );

        if (!contextExists) {
          item.contexts.push(context);
        }

        if (note) {
          item.note = note;
        }

        item.stats.updatedAt = Date.now();
      } else {
        // 创建新词条
        item = this._createNotebookItem(text, translation, context);
        if (note) item.note = note;
        notebook.push(item);
      }

      await chrome.storage.local.set({ notebook });
      await this.refreshAllTabs();

      return { success: true, item };
    }

    /**
     * 删除单词
     */
    static async deleteWord(id) {
      const notebook = await this.getNotebook();
      const filtered = notebook.filter((w) => w.id !== id);
      await chrome.storage.local.set({ notebook: filtered });
      await this.refreshAllTabs();
    }

    /**
     * 通知所有标签页刷新
     * 【Fix】区分环境：Background/Dashboard 可以直接操作 tabs，
     * Content Script 需要发送消息给 Background 代理操作。
     */
    static async refreshAllTabs() {
      if (typeof chrome.tabs !== "undefined" && chrome.tabs.query) {
        // 环境：Background, Popup, Dashboard
        const tabs = await chrome.tabs.query({});
        tabs.forEach((tab) => {
          chrome.tabs.sendMessage(tab.id, { action: "REFRESH_HIGHLIGHTS" }).catch(() => {});
        });
      } else {
        // 环境：Content Script
        try {
          chrome.runtime.sendMessage({ action: "BROADCAST_REFRESH" });
        } catch (e) {
          console.warn("Failed to send broadcast request:", e);
        }
      }
    }

    /**
     * 创建标准词条结构
     */
    static _createNotebookItem(text, translation = "", context = null) {
      const item = {
        id: this._generateUUID(),
        text: text.trim(),
        originalText: text.trim(),
        translation: translation,
        contexts: [],
        note: "",
        tags: [],
        stats: {
          createdAt: Date.now(),
          updatedAt: Date.now(),
          reviewCount: 0,
        },
      };

      if (context) {
        item.contexts.push({
          sentence: context.sentence || "",
          url: context.url || "",
          title: context.title || "",
          favicon: context.favicon || "",
          timestamp: Date.now(),
        });
      }

      return item;
    }

    /**
     * 生成UUID
     */
    static _generateUUID() {
      return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
      );
    }
  }
  global.NotebookAPI = NotebookAPI;
})(globalThis);
