import "../utils/helpers.js";
import "../utils/notebook-api.js";
import { performSync } from "../utils/syncLogic.js";
import { LLMClient, LLM_DEFAULT_SETTINGS } from "../utils/llm-client.js";

const { generateUUID, debounce } = self.VH_Helpers;

// ==========================================
// 1. Translation Strategies (Strategy Pattern)
// ==========================================

class GoogleTranslateStrategy {
  async translate(text) {
    try {
      const cleanText = text.trim();
      const isSentence = cleanText.length > 50 || (cleanText.match(/\s/g) || []).length > 2;
      let url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN`;
      if (isSentence) {
        url += `&dt=t&q=${encodeURIComponent(cleanText)}`;
      } else {
        url += `&dt=bd&dt=t&q=${encodeURIComponent(cleanText)}`;
      }

      const response = await fetch(url);
      const data = await response.json();

      if (!isSentence && data && data[1] && data[1].length > 0) {
        const dictResult = data[1]
          .map((item) => {
            const partOfSpeech = item[0]; 
            const meanings = item[1].slice(0, 5).join(", "); 
            return `${partOfSpeech}: ${meanings}`;
          })
          .join("; ");

        if (dictResult) return dictResult;
      }

      if (data && data[0] && data[0].length > 0) {
        return data[0]
          .map((item) => item[0])
          .join("")
          .trim();
      }

      return null;
    } catch (error) {
      console.error("Google Translate Error:", error);
      return null;
    }
  }
}

class TranslatorFactory {
  static getTranslator(type = "google") {
    switch (type) {
      case "google":
        return new GoogleTranslateStrategy();
      default:
        return new GoogleTranslateStrategy();
    }
  }
}

// ==========================================
// 1.5 LLM 语境释义（与机械词典并行，互不影响）
// ==========================================

const LLM_CACHE_KEY = "llm_cache";
const LLM_CACHE_MAX = 300;
const LLM_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 天

// 同一个词条在多处同时触发（hover + 划词）时只发一次真实请求
const llmInflight = new Map();

async function getLlmSettings() {
  const { llm_settings } = await chrome.storage.local.get("llm_settings");
  return { ...LLM_DEFAULT_SETTINGS, ...(llm_settings || {}) };
}

/** 缓存键：语境不同 → 释义不同，所以语境必须参与 key */
function buildLlmCacheKey(text, context) {
  const term = text.trim().toLowerCase();
  const ctx = (context || "").trim().replace(/\s+/g, " ").slice(0, 120).toLowerCase();
  return `${term}||${ctx}`;
}

async function readLlmCache(key) {
  const store = (await chrome.storage.local.get(LLM_CACHE_KEY))[LLM_CACHE_KEY] || {};
  const hit = store[key];
  if (!hit) return null;
  if (Date.now() - (hit.ts || 0) > LLM_CACHE_TTL) return null;
  return hit;
}

async function writeLlmCache(key, value) {
  const store = (await chrome.storage.local.get(LLM_CACHE_KEY))[LLM_CACHE_KEY] || {};
  store[key] = { ...value, ts: Date.now() };

  const keys = Object.keys(store);
  if (keys.length > LLM_CACHE_MAX) {
    // 按写入时间淘汰最旧的
    keys
      .sort((a, b) => (store[a].ts || 0) - (store[b].ts || 0))
      .slice(0, keys.length - LLM_CACHE_MAX)
      .forEach((k) => delete store[k]);
  }

  await chrome.storage.local.set({ [LLM_CACHE_KEY]: store });
}

/**
 * 清掉单个词条的缓存。同一个词在不同语境下有多条 key（`词条||语境`），
 * 所以必须按前缀全清，只删一条会留下漏网之鱼。
 * @returns {Promise<number>} 实际删除的条数
 */
async function clearLlmCacheForTerm(term) {
  const store = (await chrome.storage.local.get(LLM_CACHE_KEY))[LLM_CACHE_KEY] || {};
  const prefix = `${term.trim().toLowerCase()}||`;
  const hits = Object.keys(store).filter((k) => k.startsWith(prefix));
  if (!hits.length) return 0;

  hits.forEach((k) => delete store[k]);
  await chrome.storage.local.set({ [LLM_CACHE_KEY]: store });
  return hits.length;
}

/**
 * @returns {Promise<{status:'ok'|'disabled'|'error', text?:string, model?:string, cached?:boolean, error?:string}>}
 */
async function handleLlmTranslate(text, context) {
  const cleanText = (text || "").trim();
  if (!cleanText) return { status: "error", error: "空文本" };

  const settings = await getLlmSettings();
  if (!settings.enabled) return { status: "disabled" };

  const client = new LLMClient(settings);
  if (!client.isConfigured()) {
    return { status: "error", error: "未填写 API Key 或接口地址" };
  }

  const cacheKey = buildLlmCacheKey(cleanText, context);
  const cached = await readLlmCache(cacheKey);
  if (cached) {
    return { status: "ok", text: cached.text, model: cached.model, cached: true };
  }

  if (llmInflight.has(cacheKey)) {
    return llmInflight.get(cacheKey);
  }

  const task = (async () => {
    try {
      const { text: result, model } = await client.translate(cleanText, context);
      await writeLlmCache(cacheKey, { text: result, model });
      return { status: "ok", text: result, model, cached: false };
    } catch (err) {
      console.warn("[LLM] translate failed:", err);
      return { status: "error", error: err.message || String(err) };
    } finally {
      llmInflight.delete(cacheKey);
    }
  })();

  llmInflight.set(cacheKey, task);
  return task;
}

// ==========================================
// 2. Data Migration & Initialization
// ==========================================

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install" || details.reason === "update") {
    // 确保默认设置
    const result = await chrome.storage.local.get(["settings", "sync_settings", "llm_settings"]);
    if (!result.settings) {
      await chrome.storage.local.set({
        settings: { borderMode: false, highlightEnabled: true },
      });
    }

    if (!result.llm_settings) {
      await chrome.storage.local.set({ llm_settings: { ...LLM_DEFAULT_SETTINGS } });
    }

    // 设置/更新自动同步 Alarm
    setupAutoSyncAlarm();
  }
});

// Setup Alarm based on settings
async function setupAutoSyncAlarm() {
  const { sync_settings } = await chrome.storage.local.get("sync_settings");
  chrome.alarms.clear("vocabulary_auto_sync");
  
  if (sync_settings && sync_settings.enabled && sync_settings.auto_sync_interval_min) {
    chrome.alarms.create("vocabulary_auto_sync", {
      periodInMinutes: parseInt(sync_settings.auto_sync_interval_min)
    });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "vocabulary_auto_sync") {
    console.log("Alarm triggered: vocabulary_auto_sync");
    performSync(false);
  }
});

// ==========================================
// 3. Message Handling
// ==========================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "LOOKUP_WORD") {
    handleLookup(request.text).then(sendResponse);
    return true; 
  }

  if (request.action === "LLM_TRANSLATE") {
    handleLlmTranslate(request.text, request.context).then(sendResponse);
    return true;
  }

  if (request.action === "LLM_TEST") {
    (async () => {
      try {
        const client = new LLMClient(request.settings || (await getLlmSettings()));
        const { content, model } = await client.test();
        sendResponse({ success: true, content, model });
      } catch (err) {
        sendResponse({ success: false, error: err.message || String(err) });
      }
    })();
    return true;
  }

  if (request.action === "LLM_CLEAR_CACHE") {
    // 带 text 只清该词条（单词级），不带则清空整个缓存（设置页的全局按钮）
    const term = (request.text || "").trim();
    if (term) {
      clearLlmCacheForTerm(term).then((removed) =>
        sendResponse({ success: true, removed })
      );
    } else {
      chrome.storage.local.remove(LLM_CACHE_KEY, () => sendResponse({ success: true }));
    }
    return true;
  }

  if (request.action === "ADD_WORD") {
    // 使用 NotebookAPI (已通过 import "../utils/notebook-api.js" 挂载到 self)
    // 注意：request.data 包含 { text, translation, context, note }
    self.NotebookAPI.addOrUpdateWord(request.data).then(sendResponse);
    return true;
  }

  if (request.action === "GET_NOTEBOOK") {
    chrome.storage.local.get("notebook", (res) => {
      sendResponse(res.notebook || []);
    });
    return true;
  }

  if (request.action === "BROADCAST_REFRESH") {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
          // 只发给 http/https 页面
        if (tab.url && tab.url.startsWith('http')) {
            chrome.tabs.sendMessage(tab.id, { action: "REFRESH_HIGHLIGHTS" }).catch(() => {});
        }
      });
    });
    return true;
  }

  // Sync Messages
  if (request.action === "SYNC_NOW") {
    performSync(true).then(() => {
        sendResponse({ success: true });
    }).catch(err => {
        sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (request.action === "UPDATE_ALARM") {
    setupAutoSyncAlarm();
    sendResponse({ success: true });
  }
  
  // 新增：接收来自 NotebookAPI 的延迟同步请求 (避免直接循环引用)
  if (request.action === "REQUEST_DEBOUNCED_SYNC") {
      debouncedSyncTrigger();
  }
});

async function handleLookup(text) {
  const cleanText = text.trim();
  const lowerText = cleanText.toLowerCase();

  const { notebook = [] } = await chrome.storage.local.get("notebook");
  const foundItem = notebook.find((item) => item.text.toLowerCase() === lowerText);

  if (foundItem && foundItem.translation) {
    return { status: "hit", data: foundItem };
  }

  const translator = TranslatorFactory.getTranslator("google");
  const translation = await translator.translate(cleanText);
  const finalTranslation = translation || "";

  if (foundItem) {
    if (finalTranslation) {
      foundItem.translation = finalTranslation;
      foundItem.stats.updatedAt = Date.now();

      // 更新存储并加上时间戳
      await chrome.storage.local.set({ 
          notebook,
          notebook_update_timestamp: Date.now() 
      });
      console.log(`[Lookup] Write-back translation for: ${cleanText}`);

      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "REFRESH_HIGHLIGHTS" });
      }
    }
    return { status: "hit", data: foundItem };
  }

  return {
    status: "miss",
    data: {
      text: cleanText,
      translation: finalTranslation || "Translation failed",
    },
  };
}

chrome.action.onClicked.addListener((tab) => {
  chrome.runtime.openOptionsPage();
});

// ==========================================
// 4. Auto Sync on Change (Debounced)
// ==========================================

let syncTimer = null;
function debouncedSyncTrigger() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        console.log("Triggering debounced sync after changes...");
        performSync(false);
    }, 10000); // 10 seconds delay
}

// 监听 storage 变化
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.notebook) {
        // 只有当 notebook 改变时触发
        // 如何区分是 Sync 写入的 还是 用户写入的？
        // 如果是 Sync 写入的，syncLogic.js 会更新 notebook_update_timestamp
        // 如果是 用户写入的，NotebookAPI 也会更新 notebook_update_timestamp
        // 但是 syncLogic.js 中 performSync 会设置 isSyncing = true
        // 我们可以简单地调用 debouncedSyncTrigger，因为 performSync 内部有 isSyncing 检查
        // 如果此刻正在 sync，isSyncing=true，performSync 会跳过
        // 但如果 sync 刚结束，change 事件触发，我们延迟 10s 后再 sync，这时候 isSyncing=false
        // 这会导致 sync 完后又 sync 一次（Noop），是可以接受的
        debouncedSyncTrigger();
    }
});