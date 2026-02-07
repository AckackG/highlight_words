import { WebDAVClient } from "../utils/WebDAVClient.js";
import { performSync } from "../utils/syncLogic.js";

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

  // 【新增】Context Manager Elements
  const contextManagerModalEl = document.getElementById("contextManagerModal");
  const contextManagerModal = new bootstrap.Modal(contextManagerModalEl);
  const contextManagerBody = document.getElementById("contextManagerBody");
  const btnDeleteSelectedContexts = document.getElementById("btnDeleteSelectedContexts");
  const checkAllContexts = document.getElementById("checkAllContexts");
  const contextManagerStatus = document.getElementById("contextManagerStatus");
  let currentManagingWordId = null;

  // 【新增】删除全部相关的 Elements
  const btnExecuteDeleteAll = document.getElementById("btnExecuteDeleteAll");
  const deleteConfirmInput = document.getElementById("deleteConfirmInput");
  const deleteAllModalEl = document.getElementById("deleteAllModal");
  const deleteAllModal = new bootstrap.Modal(deleteAllModalEl);
  
  // 【新增】Sync Elements
  const checkSyncEnabled = document.getElementById("checkSyncEnabled");
  const syncConfigArea = document.getElementById("syncConfigArea");
  const syncServerUrl = document.getElementById("syncServerUrl");
  const syncUsername = document.getElementById("syncUsername");
  const syncPassword = document.getElementById("syncPassword");
  const syncInterval = document.getElementById("syncInterval");
  const lastSyncTime = document.getElementById("lastSyncTime");
  const lastSyncStatus = document.getElementById("lastSyncStatus");

  // Load Data
  async function loadData() {
    const result = await chrome.storage.local.get(["notebook", "settings", "sync_settings"]);
    allWords = result.notebook || [];
    renderTable(allWords);
    updateStats(allWords);

    // Load Display Settings
    if (result.settings) {
      document.getElementById("checkBorderMode").checked = result.settings.borderMode || false;
      document.getElementById("checkAutoHighlight").checked =
        result.settings.highlightEnabled !== false;
    }
    
    // Load Sync Settings
    if (result.sync_settings) {
        const s = result.sync_settings;
        checkSyncEnabled.checked = s.enabled || false;
        if (s.enabled) syncConfigArea.style.display = "block";
        
        syncServerUrl.value = s.server_url || "";
        syncUsername.value = s.username || "";
        syncPassword.value = s.password || "";
        syncInterval.value = s.auto_sync_interval_min || "30";
        
        lastSyncTime.textContent = `上次同步: ${s.last_sync_time ? new Date(s.last_sync_time).toLocaleString() : "-"}`;
        lastSyncStatus.textContent = `状态: ${s.last_sync_status || "-"}`;
        if (s.last_sync_status && s.last_sync_status.startsWith("error")) {
            lastSyncStatus.classList.add("text-danger");
        } else {
            lastSyncStatus.classList.remove("text-danger");
        }
    }
  }

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
      // 策略：默认显示最新的一条，鼠标悬停(title)显示全部
      let contextsHtml = '<div class="text-muted" style="font-size:0.9em;">无语境</div>';

      if (item.contexts && item.contexts.length > 0) {
        // 1. 获取最新一条 (数组最后一个)
        const latestCtx = item.contexts[item.contexts.length - 1];

        const titleHtml = latestCtx.title 
          ? ` <span class="badge bg-light text-dark border" style="font-weight:normal; margin-left:4px;">${latestCtx.title}</span>` 
          : "";

        const countBadge = item.contexts.length > 1 
          ? ` <span class="badge rounded-pill bg-secondary" style="font-size:0.65em; opacity:0.7;" title="共 ${item.contexts.length} 条语境">+${item.contexts.length - 1}</span>` 
          : "";

        // 2. 构建 title 提示文本 (包含所有语境，按时间倒序)
        // 使用 simple text format，因为 title 属性不支持 HTML
        const allContextsText = item.contexts
          .slice()
          .reverse()
          .map((ctx) => {
            const title = ctx.title
              ? ` <span style="color:#999; font-size:0.85em;">(${ctx.title})</span>`
              : "";
            // 【新增】单个语境删除按钮 (表格内快捷删除)
            return `
            <li style="margin-bottom:4px; display:flex; justify-content:space-between; align-items:start;">
                <span style="margin-right:8px;">${ctx.sentence}${title}</span>
                <a href="#" class="text-danger btn-delete-context" style="text-decoration:none; font-size:0.8em;" 
                   title="删除此语境" data-word-id="${item.id}" data-ctx-id="${ctx.id || ''}">
                   <i class="bi bi-x-circle"></i>
                </a>
            </li>`;
          })
          .join("");

        contextsHtml = `
          <div title="${allContextsText.replace(
            /"/g,
            "&quot;"
          )}" style="cursor: help; font-size:0.9em; color:#555; max-height: 80px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">
            ${latestCtx.sentence}${titleHtml}${countBadge}
          </div>
        `;
      }

      // 【修改】在最后一列增加了 btn-metadata 按钮 和 btn-cleanup-item (现在是 Manage Contexts)
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
            <button class="btn btn-sm btn-outline-primary btn-edit" title="编辑笔记" data-id="${item.id}">
              <i class="bi bi-pencil"></i>
            </button>
            <button class="btn btn-sm btn-outline-warning btn-cleanup-item" title="管理语境 (手动选择删除)" data-id="${item.id}">
                <i class="bi bi-list-check"></i>
            </button>
            <button class="btn btn-sm btn-outline-info btn-metadata" title="查看元数据" data-id="${item.id}">
              <i class="bi bi-info-circle"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger btn-delete" title="删除单词" data-id="${item.id}">
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

    document.querySelectorAll(".btn-metadata").forEach((btn) => {
      btn.addEventListener("click", (e) => showMetadata(e.currentTarget.dataset.id));
    });

    // 【新增】单词语境管理事件 (打开 Modal)
    document.querySelectorAll(".btn-cleanup-item").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            const id = e.currentTarget.dataset.id;
            openContextManager(id);
        });
    });
    
    // 【新增】语境删除事件 (表格内)
    document.querySelectorAll(".btn-delete-context").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            e.preventDefault();
            const wordId = e.currentTarget.dataset.wordId;
            const ctxId = e.currentTarget.dataset.ctxId;
            if(!ctxId) {
                alert("此语境没有ID（可能是旧数据），请先同步或刷新以自动迁移数据。");
                return;
            }
            await NotebookAPI.deleteContext(wordId, ctxId);
            loadData();
        });
    });

    updateSortIcons();
  }
  
  // --- Context Manager Logic ---
  function openContextManager(wordId) {
      currentManagingWordId = wordId;
      const item = allWords.find(w => w.id === wordId);
      if (!item) return;

      contextManagerBody.innerHTML = "";
      contextManagerStatus.textContent = "";
      btnDeleteSelectedContexts.disabled = true;
      checkAllContexts.checked = false;

      if (!item.contexts || item.contexts.length === 0) {
          contextManagerBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">暂无语境</td></tr>';
      } else {
          // Sort by date desc
          const sortedContexts = [...item.contexts].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          
          sortedContexts.forEach(ctx => {
              const tr = document.createElement("tr");
              tr.innerHTML = `
                  <td><input type="checkbox" class="form-check-input ctx-check" value="${ctx.id}" /></td>
                  <td style="word-break: break-all;"><small>${ctx.sentence}</small></td>
                  <td><small class="text-muted">${ctx.title || '-'}</small></td>
                  <td><small class="text-muted">${ctx.timestamp ? new Date(ctx.timestamp).toLocaleDateString() : '-'}</small></td>
              `;
              contextManagerBody.appendChild(tr);
          });
      }
      
      // Bind checkbox events
      const checks = contextManagerBody.querySelectorAll(".ctx-check");
      checks.forEach(c => c.addEventListener("change", updateDeleteButtonState));
      
      contextManagerModal.show();
  }

  checkAllContexts.addEventListener("change", (e) => {
      const checks = contextManagerBody.querySelectorAll(".ctx-check");
      checks.forEach(c => c.checked = e.target.checked);
      updateDeleteButtonState();
  });

  function updateDeleteButtonState() {
      const checkedCount = contextManagerBody.querySelectorAll(".ctx-check:checked").length;
      btnDeleteSelectedContexts.disabled = checkedCount === 0;
      contextManagerStatus.textContent = checkedCount > 0 ? `已选择 ${checkedCount} 项` : "";
  }

  btnDeleteSelectedContexts.addEventListener("click", async () => {
      if (!currentManagingWordId) return;
      const checks = contextManagerBody.querySelectorAll(".ctx-check:checked");
      const idsToDelete = Array.from(checks).map(c => c.value);
      
      if (idsToDelete.length === 0) return;
      
      // Batch delete logic
      const itemIndex = allWords.findIndex(w => w.id === currentManagingWordId);
      if (itemIndex !== -1) {
              const item = allWords[itemIndex];
              const originalLen = item.contexts.length;
              
              // Filter out deleted
              item.contexts = item.contexts.filter(c => !idsToDelete.includes(c.id));
              
              if (item.contexts.length !== originalLen) {
                  item.stats.updatedAt = Date.now();
                  
                  // Save storage
                   await chrome.storage.local.set({ 
                      notebook: allWords,
                      notebook_update_timestamp: Date.now()
                  });
                  
                  // Refresh highlights
                  if (window.NotebookAPI) {
                      await window.NotebookAPI.refreshAllTabs();
                  }
                  
                  loadData(); // reload table
                  contextManagerModal.hide(); // close modal
              }
          }
  });

  // 【新增】显示元数据逻辑
  function showMetadata(id) {
    const item = allWords.find((w) => w.id === id);
    if (!item) return;

    // 创建一个用于显示的副本，添加易读的时间格式
    const displayItem = {
      ...item,
      // 插入人类可读的时间字符串，方便对照
      _readableStats_MetaInfoOnly: {
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
      // 【修改】使用 _saveNotebook 逻辑 (手动)
      await chrome.storage.local.set({ 
          notebook: allWords,
          notebook_update_timestamp: Date.now()
      });
      renderTable(allWords);
      editModal.hide();
    }
  });

  async function deleteWord(id) {
    if (confirm("确定要删除这个单词吗？")) {
      allWords = allWords.filter((w) => w.id !== id);
      await chrome.storage.local.set({ 
          notebook: allWords,
          notebook_update_timestamp: Date.now()
      });
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
      if (!sWord || !sWord.text) return;

      const cleanText = sWord.text.trim();
      if (!cleanText) return;

      const existing = currentNotebook.find(
        (w) => w.text.toLowerCase() === cleanText.toLowerCase()
      );

      let cleanTrans = "";

      if (existing) {
        existing.translation = cleanTrans || existing.translation; 
        if (sWord.note) existing.note = (existing.note + "\n" + sWord.note).trim();

        existing.contexts.push({
          id: generateUUID(),
          sentence: sWord.context || "",
          url: sWord.url || "",
          title: sWord.title || "Imported",
          favicon: sWord.favicon || "",
          timestamp: sWord.date || Date.now(),
        });
        existing.stats.updatedAt = Date.now();
        count++;
      } else {
        const newItem = {
          id: generateUUID(), 
          text: cleanText,
          originalText: sWord.text,
          translation: cleanTrans,
          note: sWord.note || "",
          tags: [],
          contexts: [
            {
              id: generateUUID(),
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

    await chrome.storage.local.set({ 
        notebook: currentNotebook,
        notebook_update_timestamp: Date.now()
    });
    return count;
  }

  // --- Export Logic ---

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

  if (deleteConfirmInput) {
    deleteConfirmInput.addEventListener("input", (e) => {
      if (e.target.value === "DELETE") {
        btnExecuteDeleteAll.removeAttribute("disabled");
      } else {
        btnExecuteDeleteAll.setAttribute("disabled", "true");
      }
    });
  }

  if (btnExecuteDeleteAll) {
    btnExecuteDeleteAll.addEventListener("click", async () => {
      if (deleteConfirmInput.value !== "DELETE") return;
      exportDataToFile();
      await new Promise((r) => setTimeout(r, 1000));
      await chrome.storage.local.set({ 
          notebook: [],
          notebook_update_timestamp: Date.now()
      });
      allWords = [];
      renderTable(allWords);
      updateStats(allWords);
      deleteAllModal.hide();
      deleteConfirmInput.value = "";
      btnExecuteDeleteAll.setAttribute("disabled", "true");
      alert("所有单词已清空，系统已为您自动下载了备份文件。");
    });
  }

  // --- Global Cleanup Contexts Logic (Auto) ---
  const btnCleanupContexts = document.getElementById("btnCleanupContexts");
  if (btnCleanupContexts) {
      btnCleanupContexts.addEventListener("click", async () => {
          if(confirm("确定要自动清理【所有单词】的语境吗？\n1. 去除重复句子\n2. 每个单词最多保留20条语境\n3. 清理前会自动备份")) {
              // Auto Export
              exportDataToFile();
              await new Promise(r => setTimeout(r, 1000));

              const { changed, details } = await NotebookAPI.cleanupContexts(null, { max: 20 });
              if (changed) {
                  console.log("=== Context Cleanup Report ===");
                  details.forEach(d => console.log(`- Word: ${d.text}, Removed: ${d.removed} contexts`));
                  console.log("==============================");
                  alert(`语境清理完成！详情已输出到控制台 (F12)。`);
                  loadData(); // reload table
              } else {
                  alert("暂无需要清理的语境。");
              }
          }
      });
  }

  // --- Sorting Event Listeners ---
  const thWord = document.getElementById("thSortWord");
  const thDate = document.getElementById("thSortDate");

  if (thWord) {
    thWord.addEventListener("click", () => handleSortClick("text"));
  }
  if (thDate) {
    thDate.addEventListener("click", () => handleSortClick("date"));
  }

  // --- Settings Logic (Updated for Sync) ---
  
  checkSyncEnabled.addEventListener('change', (e) => {
     syncConfigArea.style.display = e.target.checked ? "block" : "none"; 
  });
  
  document.getElementById("btnTestConnection").addEventListener("click", async () => {
     const url = syncServerUrl.value.trim();
     const user = syncUsername.value.trim();
     const pass = syncPassword.value;
     
     if (!url || !user || !pass) {
         alert("请先填写完整的服务器信息");
         return;
     }
     
     const btn = document.getElementById("btnTestConnection");
     const originalText = btn.textContent;
     btn.textContent = "连接中...";
     btn.disabled = true;
     
     const client = new WebDAVClient(url, user, pass);
     const success = await client.checkConnection();
     
     btn.textContent = originalText;
     btn.disabled = false;
     
     if (success) {
         alert("连接成功！");
     } else {
         alert("连接失败，请检查配置。");
     }
  });
  
  document.getElementById("btnSyncNow").addEventListener("click", async () => {
      // 保存设置先
      await saveSettings();
      
      const btn = document.getElementById("btnSyncNow");
      const originalText = btn.textContent;
      btn.textContent = "同步中...";
      btn.disabled = true;
      
      try {
          await performSync(true);
          await loadData(); // Reload stats and status
          alert("同步完成！");
      } catch (e) {
          alert("同步出错: " + e.message);
      } finally {
          btn.textContent = originalText;
          btn.disabled = false;
      }
  });

  async function saveSettings() {
    const borderMode = document.getElementById("checkBorderMode").checked;
    const highlightEnabled = document.getElementById("checkAutoHighlight").checked;
    
    // Sync Settings
    const syncEnabled = checkSyncEnabled.checked;
    const syncSettings = {
        enabled: syncEnabled,
        server_url: syncServerUrl.value.trim(),
        username: syncUsername.value.trim(),
        password: syncPassword.value, // allow empty if user wants? usually no.
        auto_sync_interval_min: syncInterval.value,
        last_sync_time: lastSyncTime.textContent.replace('上次同步: ', ''), // preserve old if not updated
        last_sync_status: lastSyncStatus.textContent.replace('状态: ', '')
    };
    
    // Preserve actual last sync info if we didn't run sync
    const old = await chrome.storage.local.get("sync_settings");
    if(old.sync_settings) {
        syncSettings.last_sync_time = old.sync_settings.last_sync_time;
        syncSettings.last_sync_status = old.sync_settings.last_sync_status;
    }

    await chrome.storage.local.set({
      settings: { borderMode, highlightEnabled },
      sync_settings: syncSettings
    });
    
    // Notify Background to update alarm
    chrome.runtime.sendMessage({ action: "UPDATE_ALARM" });
  }

  document.getElementById("btnSaveSettings").addEventListener("click", async () => {
    await saveSettings();
    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById("settingsModal"));
    modal.hide();
    // Refresh content
    loadData();
  });
  
  // Listen for sync completion from background
  chrome.runtime.onMessage.addListener((request) => {
     if (request.action === "SYNC_COMPLETED") {
         loadData();
         // Update status text if modal is open
         if (document.getElementById("settingsModal").classList.contains("show")) {
             // reload status text from storage
             chrome.storage.local.get("sync_settings").then(res => {
                if(res.sync_settings) {
                    lastSyncTime.textContent = `上次同步: ${res.sync_settings.last_sync_time ? new Date(res.sync_settings.last_sync_time).toLocaleString() : "-"}`;
                    lastSyncStatus.textContent = `状态: ${res.sync_settings.last_sync_status || "-"}`;
                }
             });
         }
     } 
  });

  // Initialize
  loadData();
});