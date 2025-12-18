const { generateUUID, debounce } = VH_Helpers;

document.addEventListener("DOMContentLoaded", async () => {
  let allWords = [];
  // 【新增】排序状态管理
  let currentSort = { field: "date", direction: "desc" }; // 默认按日期降序

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

  // 【新增】Metadata Modal 实例
  const metadataModalEl = document.getElementById("metadataModal");
  const metadataModal = new bootstrap.Modal(metadataModalEl);
  const metadataContent = document.getElementById("metadataContent");

  // 【新增】删除全部相关的 Elements
  const btnExecuteDeleteAll = document.getElementById("btnExecuteDeleteAll");
  const deleteConfirmInput = document.getElementById("deleteConfirmInput");
  const deleteAllModalEl = document.getElementById("deleteAllModal");
  const deleteAllModal = new bootstrap.Modal(deleteAllModalEl);

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
  // Render Table
  function renderTable(data) {
    tableBody.innerHTML = "";

    // 使用排序逻辑
    const sortedData = sortData(data);

    if (sortedData.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">暂无数据，快去阅读文章积累生词吧！</td></tr>`;
      return;
    }

    sortedData.forEach((item) => {
      const tr = document.createElement("tr");

      const dateStr = new Date(item.stats.createdAt).toLocaleDateString();

      // 构建语境列表 HTML
      let contextsHtml = '<div class="text-muted" style="font-size:0.9em;">无语境</div>';
      if (item.contexts && item.contexts.length > 0) {
        const listItems = item.contexts
          .slice()
          .reverse()
          .map((ctx) => {
            const title = ctx.title
              ? ` <span style="color:#999; font-size:0.85em;">(${ctx.title})</span>`
              : "";
            return `<li style="margin-bottom:4px;">${ctx.sentence}${title}</li>`;
          })
          .join("");

        contextsHtml = `
          <ul style="margin:0; padding-left:1.2em; max-height:100px; overflow-y:auto; font-size:0.9em; color:#555;">
            ${listItems}
          </ul>
        `;
      }

      // 【修改】在最后一列增加了 btn-metadata 按钮
      tr.innerHTML = `
        <td class="word-cell">${item.text}</td>
        <td>${item.translation || "-"}</td>
        <td class="context-cell" style="min-width: 250px;">
           ${contextsHtml}
        </td>
        <td class="note-cell">${item.note || "-"}</td>
        <td>${dateStr}</td>
        <td>
          <div class="btn-group" role="group">
            <button class="btn btn-sm btn-outline-primary btn-edit" title="编辑笔记" data-id="${
              item.id
            }">
              <i class="bi bi-pencil"></i>
            </button>
            <button class="btn btn-sm btn-outline-info btn-metadata" title="查看元数据" data-id="${
              item.id
            }">
              <i class="bi bi-info-circle"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger btn-delete" title="删除单词" data-id="${
              item.id
            }">
              <i class="bi bi-trash"></i>
            </button>
          </div>
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

    // 【新增】绑定 Info 按钮事件
    document.querySelectorAll(".btn-metadata").forEach((btn) => {
      btn.addEventListener("click", (e) => showMetadata(e.currentTarget.dataset.id));
    });

    updateSortIcons();
  }

  // 【新增】显示元数据逻辑
  function showMetadata(id) {
    const item = allWords.find((w) => w.id === id);
    if (!item) return;

    // 创建一个用于显示的副本，添加易读的时间格式
    const displayItem = {
      ...item,
      // 插入人类可读的时间字符串，方便对照
      _readableStats: {
        createdAt: new Date(item.stats.createdAt).toLocaleString(),
        updatedAt: new Date(item.stats.updatedAt).toLocaleString(),
      },
      contexts: item.contexts.map((ctx) => ({
        ...ctx,
        _timestamp: ctx.timestamp ? new Date(ctx.timestamp).toLocaleString() : "N/A",
      })),
    };

    // 格式化 JSON，缩进 2 个空格
    metadataContent.textContent = JSON.stringify(displayItem, null, 2);

    metadataModal.show();
  }

  // 【新增】排序核心逻辑
  function sortData(data) {
    return [...data].sort((a, b) => {
      let valA, valB;

      if (currentSort.field === "text") {
        valA = a.text.toLowerCase();
        valB = b.text.toLowerCase();
        return currentSort.direction === "asc"
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      } else {
        // 默认为 date (createdAt)
        valA = a.stats.createdAt;
        valB = b.stats.createdAt;
        return currentSort.direction === "asc" ? valA - valB : valB - valA;
      }
    });
  }

  // 【新增】点击表头处理
  function handleSortClick(field) {
    if (currentSort.field === field) {
      // 切换方向
      currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
    } else {
      // 切换字段，默认顺序
      currentSort.field = field;
      currentSort.direction = field === "text" ? "asc" : "desc";
    }
    renderTable(allWords); // 重新渲染（包含过滤后的数据逻辑可能需要适配，但此处保持简单重绘）
  }

  // 【新增】更新表头图标 UI
  function updateSortIcons() {
    const icons = document.querySelectorAll("thead th i");
    icons.forEach((i) => {
      i.className = "bi bi-arrow-down-up"; // 重置为默认双向箭头
      i.style.opacity = "0.3";
    });

    let activeThId = "";
    if (currentSort.field === "text") activeThId = "thSortWord";
    if (currentSort.field === "date") activeThId = "thSortDate";

    if (activeThId) {
      const th = document.getElementById(activeThId);
      if (th) {
        const icon = th.querySelector("i");
        if (icon) {
          icon.className = currentSort.direction === "asc" ? "bi bi-arrow-up" : "bi bi-arrow-down";
          icon.style.opacity = "1";
        }
      }
    }
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

  // 【修改】提取导出逻辑为函数，供“导出按钮”和“删除全部备份”共用
  function exportDataToFile() {
    const blob = new Blob([JSON.stringify(allWords, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vocabulary_notebook_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }

  document.getElementById("btnExport").addEventListener("click", exportDataToFile);

  // --- Delete All Logic (New) ---

  // 输入校验：只有输入 DELETE 才启用按钮
  if (deleteConfirmInput) {
    deleteConfirmInput.addEventListener("input", (e) => {
      if (e.target.value === "DELETE") {
        btnExecuteDeleteAll.removeAttribute("disabled");
      } else {
        btnExecuteDeleteAll.setAttribute("disabled", "true");
      }
    });
  }

  // 执行删除全部
  if (btnExecuteDeleteAll) {
    btnExecuteDeleteAll.addEventListener("click", async () => {
      if (deleteConfirmInput.value !== "DELETE") return;

      // 1. 自动备份
      exportDataToFile();

      // 2. 稍微等待一下确保下载触发（简单的用户体验优化）
      await new Promise((r) => setTimeout(r, 1000));

      // 3. 清空存储
      await chrome.storage.local.set({ notebook: [] });

      // 4. 重置 UI
      allWords = [];
      renderTable(allWords);
      updateStats(allWords);

      // 关闭 Modal
      deleteAllModal.hide();
      deleteConfirmInput.value = "";
      btnExecuteDeleteAll.setAttribute("disabled", "true");

      alert("所有单词已清空，系统已为您自动下载了备份文件。");
    });
  }

  // --- Sorting Event Listeners (New) ---
  const thWord = document.getElementById("thSortWord");
  const thDate = document.getElementById("thSortDate");

  if (thWord) {
    thWord.addEventListener("click", () => handleSortClick("text"));
  }
  if (thDate) {
    thDate.addEventListener("click", () => handleSortClick("date"));
  }

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
