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
     */
    static async refreshAllTabs() {
      const tabs = await chrome.tabs.query({});
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { action: "REFRESH_HIGHLIGHTS" }).catch(() => {}); // 忽略无法通信的标签页
      });
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
