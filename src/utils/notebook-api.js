(function (global) {
  /**
   * 生词本数据访问层
   * 统一封装所有 chrome.storage 操作
   */
  class NotebookAPI {
    /**
     * 获取完整生词本
     * 【新增】包含自动迁移逻辑：为缺失 ID 的语境补充 ID
     */
    static async getNotebook() {
      return new Promise((resolve) => {
        chrome.storage.local.get("notebook", async (result) => {
          let notebook = result.notebook || [];
          let needsSave = false;

          // 迁移逻辑：为旧语境补全 ID
          notebook.forEach(item => {
            if (item.contexts) {
              item.contexts.forEach(ctx => {
                if (!ctx.id) {
                  ctx.id = this._generateUUID();
                  needsSave = true;
                }
              });
            }
          });

          if (needsSave) {
            console.log("NotebookAPI: Migrated contexts with IDs");
            await this._saveNotebook(notebook);
          }

          resolve(notebook);
        });
      });
    }

    /**
     * 【核心】统一保存入口
     * 同时更新 notebook_update_timestamp 以支持 LWW 同步
     */
    static async _saveNotebook(notebook) {
      await chrome.storage.local.set({
        notebook: notebook,
        notebook_update_timestamp: Date.now()
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
            // 确保新语境有 ID
            if (!context.id) context.id = this._generateUUID();
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

      await this._saveNotebook(notebook);
      await this.refreshAllTabs();

      return { success: true, item };
    }

    /**
     * 删除单词
     */
    static async deleteWord(id) {
      const notebook = await this.getNotebook();
      const filtered = notebook.filter((w) => w.id !== id);
      await this._saveNotebook(filtered);
      await this.refreshAllTabs();
    }

    /**
     * 【新增】删除指定语境
     */
    static async deleteContext(wordId, contextId) {
        const notebook = await this.getNotebook();
        const item = notebook.find(w => w.id === wordId);
        if (item && item.contexts) {
            const initialLen = item.contexts.length;
            item.contexts = item.contexts.filter(c => c.id !== contextId);
            
            if (item.contexts.length !== initialLen) {
                item.stats.updatedAt = Date.now();
                await this._saveNotebook(notebook);
                await this.refreshAllTabs();
                return true;
            }
        }
        return false;
    }

    /**
     * 【新增】清理语境 (去重 + 裁剪)
     * @param {string|null} wordId - 指定单词ID，若为null则清理所有
     * @param {object} options - { max: 20 }
     * @returns {Promise<{changed: boolean, details: Array<{text: string, removed: number}>}>}
     */
    static async cleanupContexts(wordId = null, options = { max: 20 }) {
        const notebook = await this.getNotebook();
        let changed = false;
        const details = []; // 记录清理详情

        const processItem = (item) => {
            if (!item.contexts || item.contexts.length === 0) return;

            const originalCount = item.contexts.length;

            // 1. 去重 (Key: sentence.trim().toLowerCase())
            // 保留 timestamp 最新的
            const uniqueMap = new Map();
            item.contexts.forEach(ctx => {
                const key = ctx.sentence.trim().toLowerCase();
                if (!uniqueMap.has(key)) {
                    uniqueMap.set(key, ctx);
                } else {
                    const existing = uniqueMap.get(key);
                    if ((ctx.timestamp || 0) > (existing.timestamp || 0)) {
                        uniqueMap.set(key, ctx);
                    }
                }
            });
            let newContexts = Array.from(uniqueMap.values());

            // 2. 排序 (最新的在前)
            newContexts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            // 3. 裁剪
            if (newContexts.length > options.max) {
                newContexts = newContexts.slice(0, options.max);
            }

            // 检查是否有变化
            if (newContexts.length !== originalCount) {
                item.contexts = newContexts;
                item.stats.updatedAt = Date.now();
                changed = true;
                details.push({
                    text: item.text,
                    removed: originalCount - newContexts.length
                });
            }
        };

        if (wordId) {
            const item = notebook.find(w => w.id === wordId);
            if (item) processItem(item);
        } else {
            // 全局清理前备份
            await chrome.storage.local.set({ notebook_backup_pre_cleanup: JSON.parse(JSON.stringify(notebook)) });
            notebook.forEach(processItem);
        }

        if (changed) {
            await this._saveNotebook(notebook);
            await this.refreshAllTabs();
        }
        return { changed, details };
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
          // 只发给 http/https 页面，避免报错
          if (tab.url && tab.url.startsWith('http')) {
            chrome.tabs.sendMessage(tab.id, { action: "REFRESH_HIGHLIGHTS" }).catch(() => {});
          }
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
          id: this._generateUUID(), // 【新增】
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