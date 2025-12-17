import { generateUUID, debounce } from "../utils/helpers.js";

document.addEventListener("DOMContentLoaded", async () => {
  let allWords = [];
  const tableBody = document.getElementById("tableBody");
  const searchInput = document.getElementById("searchInput");

  // Elements
  const totalWordsEl = document.getElementById("totalWords");
  const todayWordsEl = document.getElementById("todayWords");

  // Modal Elements
  const editModalEl = document.getElementById("editModal");
  const editModal = new bootstrap.Modal(editModalEl);
  const editIdInput = document.getElementById("editId");
  const editWordInput = document.getElementById("editWord");
  const editNoteInput = document.getElementById("editNote");

  // Load Data
  async function loadData() {
    const result = await chrome.storage.local.get(["notebook", "settings"]);
    allWords = result.notebook || [];
    renderTable(allWords);
    updateStats(allWords);

    // Load Settings
    if (result.settings) {
      document.getElementById("checkBorderMode").checked = result.settings.borderMode || false;
      document.getElementById("checkAutoHighlight").checked =
        result.settings.highlightEnabled !== false;
    }
  }

  // Render Table
  function renderTable(data) {
    tableBody.innerHTML = "";
    // Sort by updated time desc
    const sortedData = [...data].sort((a, b) => b.stats.updatedAt - a.stats.updatedAt);

    if (sortedData.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">暂无数据，快去阅读文章积累生词吧！</td></tr>`;
      return;
    }

    sortedData.forEach((item) => {
      const tr = document.createElement("tr");

      const lastContext =
        item.contexts && item.contexts.length > 0 ? item.contexts[item.contexts.length - 1] : null;

      const dateStr = new Date(item.stats.createdAt).toLocaleDateString();

      tr.innerHTML = `
        <td class="word-cell">${item.text}</td>
        <td>${item.translation || "-"}</td>
        <td class="context-cell" title="${lastContext ? lastContext.sentence : ""}">
          ${lastContext ? lastContext.sentence : "-"}
          ${
            lastContext && lastContext.title
              ? `<div style="font-size:0.8em; color:#999">Source: ${lastContext.title}</div>`
              : ""
          }
        </td>
        <td class="note-cell">${item.note || "-"}</td>
        <td>${dateStr}</td>
        <td>
          <button class="btn btn-sm btn-outline-primary btn-edit" data-id="${
            item.id
          }"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-danger btn-delete" data-id="${
            item.id
          }"><i class="bi bi-trash"></i></button>
        </td>
      `;
      tableBody.appendChild(tr);
    });

    // Bind events
    document.querySelectorAll(".btn-edit").forEach((btn) => {
      btn.addEventListener("click", (e) => openEditModal(e.currentTarget.dataset.id));
    });
    document.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => deleteWord(e.currentTarget.dataset.id));
    });
  }

  // Update Stats
  function updateStats(data) {
    totalWordsEl.textContent = data.length;
    const today = new Date().setHours(0, 0, 0, 0);
    const todayCount = data.filter((item) => item.stats.createdAt >= today).length;
    todayWordsEl.textContent = todayCount;
  }

  // Filter
  searchInput.addEventListener(
    "input",
    debounce((e) => {
      const term = e.target.value.toLowerCase();
      const filtered = allWords.filter(
        (item) =>
          item.text.toLowerCase().includes(term) ||
          item.translation.toLowerCase().includes(term) ||
          item.note.toLowerCase().includes(term)
      );
      renderTable(filtered);
    }, 300)
  );

  // --- CRUD Operations ---

  function openEditModal(id) {
    const item = allWords.find((w) => w.id === id);
    if (!item) return;
    editIdInput.value = item.id;
    editWordInput.value = item.text;
    editNoteInput.value = item.note || "";
    editModal.show();
  }

  document.getElementById("btnSaveEdit").addEventListener("click", async () => {
    const id = editIdInput.value;
    const newNote = editNoteInput.value;

    const index = allWords.findIndex((w) => w.id === id);
    if (index !== -1) {
      allWords[index].note = newNote;
      allWords[index].stats.updatedAt = Date.now();
      await chrome.storage.local.set({ notebook: allWords });
      renderTable(allWords);
      editModal.hide();
    }
  });

  async function deleteWord(id) {
    if (confirm("确定要删除这个单词吗？")) {
      allWords = allWords.filter((w) => w.id !== id);
      await chrome.storage.local.set({ notebook: allWords });
      renderTable(allWords);
      updateStats(allWords);
    }
  }

  // --- Import Logic (Saladict) ---

  document.getElementById("btnExecuteImport").addEventListener("click", () => {
    const fileInput = document.getElementById("importFile");
    const file = fileInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target.result);
        const importedCount = await processSaladictImport(json);
        alert(`导入成功! 新增/更新了 ${importedCount} 个单词。`);
        location.reload();
      } catch (err) {
        console.error(err);
        alert("导入失败，JSON 格式可能不正确。");
      }
    };
    reader.readAsText(file);
  });

  async function processSaladictImport(json) {
    if (!json || !Array.isArray(json.words)) return 0;

    let count = 0;
    const currentNotebook = allWords; // use current in-memory

    json.words.forEach((sWord) => {
      // FIX: 增加防御性检查，如果 sWord 无效或没有 text 字段，直接跳过
      if (!sWord || !sWord.text) return;

      const cleanText = sWord.text.trim();
      // 如果 trim 后为空字符串，也跳过
      if (!cleanText) return;

      const existing = currentNotebook.find(
        (w) => w.text.toLowerCase() === cleanText.toLowerCase()
      );

      let cleanTrans = "";

      if (existing) {
        // Merge
        existing.translation = cleanTrans || existing.translation; // Prefer latest trans
        if (sWord.note) existing.note = (existing.note + "\n" + sWord.note).trim();

        existing.contexts.push({
          sentence: sWord.context || "",
          url: sWord.url || "",
          title: sWord.title || "Imported",
          favicon: sWord.favicon || "",
          timestamp: sWord.date || Date.now(),
        });
        existing.stats.updatedAt = Date.now();
        count++;
      } else {
        // Create New
        const newItem = {
          id: generateUUID(), // 注意：这里使用了 import 的 generateUUID，确保不需要 window.
          text: cleanText,
          originalText: sWord.text,
          translation: cleanTrans,
          note: sWord.note || "",
          tags: [],
          contexts: [
            {
              sentence: sWord.context || "",
              url: sWord.url || "",
              title: sWord.title || "Imported",
              favicon: sWord.favicon || "",
              timestamp: sWord.date || Date.now(),
            },
          ],
          stats: {
            createdAt: sWord.date || Date.now(),
            updatedAt: Date.now(),
            reviewCount: 0,
          },
        };
        currentNotebook.push(newItem);
        count++;
      }
    });

    await chrome.storage.local.set({ notebook: currentNotebook });
    return count;
  }

  // --- Export Logic ---
  document.getElementById("btnExport").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(allWords, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vocabulary_notebook_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  });

  // --- Settings Logic ---
  document.getElementById("btnSaveSettings").addEventListener("click", async () => {
    const borderMode = document.getElementById("checkBorderMode").checked;
    const highlightEnabled = document.getElementById("checkAutoHighlight").checked;

    await chrome.storage.local.set({
      settings: { borderMode, highlightEnabled },
    });

    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById("settingsModal"));
    modal.hide();

    // Refresh content
    location.reload();
  });

  // Initialize
  loadData();
});
