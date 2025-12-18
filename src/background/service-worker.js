importScripts("../utils/helpers.js");
const { generateUUID, debounce } = self.VH_Helpers;
// ==========================================
// 1. Translation Strategies (Strategy Pattern)
// ==========================================

class GoogleTranslateStrategy {
  async translate(text) {
    try {
      const cleanText = text.trim();
      // 简单判断是否为句子：长度超过 50 或包含 3 个以上空格
      const isSentence = cleanText.length > 50 || (cleanText.match(/\s/g) || []).length > 2;

      // 构建 URL 参数
      // dt=bd: 词典 (Dictionary)
      // dt=t:  普通翻译 (Translation)
      let url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN`;
      if (isSentence) {
        url += `&dt=t&q=${encodeURIComponent(cleanText)}`;
      } else {
        url += `&dt=bd&dt=t&q=${encodeURIComponent(cleanText)}`;
      }

      const response = await fetch(url);
      const data = await response.json();

      // 解析逻辑
      // 1. 优先尝试提取词典数据 (index 1) - 仅针对非句子请求且有数据的情况
      if (!isSentence && data && data[1] && data[1].length > 0) {
        // data[1] 结构示例: [["noun", ["释义1", "释义2"], ...], ["verb", ...]]
        const dictResult = data[1]
          .map((item) => {
            const partOfSpeech = item[0]; // 词性
            const meanings = item[1].slice(0, 5).join(", "); // 取前5个释义
            return `${partOfSpeech}: ${meanings}`;
          })
          .join("; ");

        if (dictResult) return dictResult;
      }

      // 2. 回退到普通翻译 (index 0)
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
      // Future: case 'deepl': return new DeepLStrategy();
      default:
        return new GoogleTranslateStrategy();
    }
  }
}

// ==========================================
// 2. Data Migration & Initialization
// ==========================================

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install" || details.reason === "update") {
    const result = await chrome.storage.local.get([
      "vocabulary",
      "notebook",
      "userVocabulary",
      "saladictVocabulary",
    ]);

    // 初始化生词本
    let notebook = result.notebook || [];

    // 迁移旧数据 (vocabulary array -> notebook objects)
    const oldVocab = result.vocabulary || [];
    const oldUser = result.userVocabulary || [];
    const oldSaladict = result.saladictVocabulary || [];

    // 合并所有旧源
    const allOldWords = new Set([...oldVocab, ...oldUser, ...oldSaladict]);

    if (allOldWords.size > 0) {
      const existingTexts = new Set(notebook.map((item) => item.text.toLowerCase()));
      let addedCount = 0;

      for (const word of allOldWords) {
        if (!existingTexts.has(word.toLowerCase())) {
          notebook.push(createNotebookItem(word));
          addedCount++;
        }
      }

      if (addedCount > 0) {
        await chrome.storage.local.set({ notebook });
        console.log(`Migrated ${addedCount} words from legacy storage.`);
      }
    }

    // 确保有默认设置
    const settings = await chrome.storage.local.get("settings");
    if (!settings.settings) {
      await chrome.storage.local.set({
        settings: { borderMode: false, highlightEnabled: true },
      });
    }
  }
});

// Helper: Create new Notebook Item Structure
function createNotebookItem(text, translation = "", context = null) {
  const item = {
    id: generateUUID(),
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

// ==========================================
// 3. Message Handling
// ==========================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "LOOKUP_WORD") {
    handleLookup(request.text).then(sendResponse);
    return true; // Async response
  }

  if (request.action === "ADD_WORD") {
    handleAddWord(request.data).then(sendResponse);
    return true;
  }

  if (request.action === "GET_NOTEBOOK") {
    chrome.storage.local.get("notebook", (res) => {
      sendResponse(res.notebook || []);
    });
    return true;
  }
});

async function handleLookup(text) {
  const cleanText = text.trim();
  const lowerText = cleanText.toLowerCase();

  const { notebook = [] } = await chrome.storage.local.get("notebook");

  // 查找本地记录
  const foundItem = notebook.find((item) => item.text.toLowerCase() === lowerText);

  // -------------------------------------------------
  // 分支 A: 本地存在 且 释义有效 -> 直接返回 (Cache Hit)
  // -------------------------------------------------
  if (foundItem && foundItem.translation) {
    return { status: "hit", data: foundItem };
  }

  // -------------------------------------------------
  // 进入 API 请求流程 (需要联网)
  // -------------------------------------------------
  const translator = TranslatorFactory.getTranslator("google");
  const translation = await translator.translate(cleanText);
  const finalTranslation = translation || "";

  // -------------------------------------------------
  // 分支 B-2: 本地存在 但 释义为空 -> 回写更新 (Write-back)
  // -------------------------------------------------
  if (foundItem) {
    // 只有当 API 返回了有效释义才更新，避免覆盖成空
    if (finalTranslation) {
      foundItem.translation = finalTranslation;
      foundItem.stats.updatedAt = Date.now();

      // 1. 保存回 storage
      await chrome.storage.local.set({ notebook });
      console.log(`[Lookup] Write-back translation for: ${cleanText}`);

      // 2. 【新增】通知前端刷新缓存 (同步数据)
      // 必须这样做，否则 content.js 里的 tooltip 仍然显示旧的空数据
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "REFRESH_HIGHLIGHTS" });
      }
    }
    // 无论是否更新成功，都返回 hit，因为单词本身已在生词本中
    // 注意：这里返回 foundItem，它已经在上面被修改了(引用类型)，所以包含了最新的 translation
    return { status: "hit", data: foundItem };
  }

  // -------------------------------------------------
  // 分支 B-1: 本地不存在 -> 返回 API 结果 (Cache Miss)
  // -------------------------------------------------
  return {
    status: "miss",
    data: {
      text: cleanText,
      translation: finalTranslation || "Translation failed",
    },
  };
}

async function handleAddWord(data) {
  const { text, translation, context, note } = data;
  const { notebook = [] } = await chrome.storage.local.get("notebook");

  // Check if exists
  let item = notebook.find((i) => i.text.toLowerCase() === text.trim().toLowerCase());

  if (item) {
    // Update existing
    // Logic: Deduplicate context based on sentence
    const contextExists = item.contexts.some((c) => c.sentence.trim() === context.sentence.trim());

    if (!contextExists) {
      item.contexts.push(context);
    }

    if (note) {
      // Append note if it's different (optional, but good for UX) or overwrite
      // Current logic per user request: just update if provided
      item.note = note;
    }

    item.stats.updatedAt = Date.now();
  } else {
    // Create new
    item = createNotebookItem(text, translation, context);
    if (note) item.note = note;
    notebook.push(item);
  }

  await chrome.storage.local.set({ notebook });

  // Notify content scripts to refresh highlights
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    chrome.tabs.sendMessage(tabs[0].id, { action: "REFRESH_HIGHLIGHTS" });
  }

  return { success: true };
}

chrome.action.onClicked.addListener((tab) => {
  chrome.runtime.openOptionsPage();
});
