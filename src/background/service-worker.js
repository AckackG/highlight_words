import { generateUUID, debounce } from "../utils/helpers.js";
// ==========================================
// 1. Translation Strategies (Strategy Pattern)
// ==========================================

class GoogleTranslateStrategy {
  async translate(text) {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(
        text
      )}`;
      const response = await fetch(url);
      const data = await response.json();
      // Google API returns nested arrays. [[["你好","Hello",...]]]
      if (data && data[0] && data[0][0] && data[0][0][0]) {
        return data[0].map((item) => item[0]).join("");
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
  const cleanText = text.trim().toLowerCase();
  const { notebook } = await chrome.storage.local.get("notebook");

  // 1. Check Notebook (Cache Hit)
  const foundItem = notebook
    ? notebook.find((item) => item.text.toLowerCase() === cleanText)
    : null;

  if (foundItem) {
    return { status: "hit", data: foundItem };
  }

  // 2. Online Translation (Cache Miss)
  const translator = TranslatorFactory.getTranslator("google");
  const translation = await translator.translate(text);

  return {
    status: "miss",
    data: {
      text: text,
      translation: translation || "Translation failed",
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
