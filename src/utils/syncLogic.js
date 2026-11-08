import { WebDAVClient } from "./WebDAVClient.js";

// 防止并发同步的简单锁
let isSyncing = false;

/**
 * 执行同步的主要逻辑
 * @param {boolean} force - 是否强制同步（即使用户未启用自动同步，用于"立即同步"按钮）
 */
export async function performSync(force = false) {
  if (isSyncing) {
    console.log("VocabularySync: 同步正在进行中，跳过本次请求");
    return;
  }

  isSyncing = true;
  const dataFileName = "notebook.json.gz";
  const metaFileName = "meta.json";

  try {
    // 1. 获取配置与本地数据
    const stored = await chrome.storage.local.get([
      "sync_settings",
      "notebook",
      "notebook_update_timestamp",
      "blocked_sites",
      "blocked_sites_update_timestamp",
    ]);
    const sync_settings = stored.sync_settings;

    // 检查开关 (强制同步模式下跳过此检查)
    if (!force && (!sync_settings || !sync_settings.enabled)) {
      isSyncing = false;
      return;
    }

    // 完整性校验
    if (!sync_settings) {
      throw new Error("未找到同步配置");
    }
    if (!sync_settings.server_url?.trim()) {
      throw new Error("服务器地址不能为空");
    }
    if (!sync_settings.username?.trim()) {
      throw new Error("用户名不能为空");
    }
    // allow empty password if user really wants to, but usually required
    if (sync_settings.password === undefined) { 
      throw new Error("密码未设置");
    }

    const client = new WebDAVClient(
      sync_settings.server_url,
      sync_settings.username,
      sync_settings.password
    );
    
    if (sync_settings.remote_dir) {
        // WebDAVClient hardcodes baseDir, but dev.md said configurable. 
        // For now, adhering to ref.txt adaptation where baseDir was fixed in class, 
        // but if we want it configurable we should pass it or set it.
        // Given WebDAVClient.js implementation, it uses hardcoded "EXThighlight_words/". 
        // We will stick to that for simplicity as per dev.md step 1 instructions "baseDir = EXThighlight_words/".
    }

    // 2. 本地数据与时间戳（生词本与屏蔽列表各自独立 LWW）
    let notebookData = stored.notebook || [];
    let localNotebookTs = stored.notebook_update_timestamp || 0;

    let blockedSites = Array.isArray(stored.blocked_sites) ? stored.blocked_sites : [];
    let localBlockedTs = stored.blocked_sites_update_timestamp || 0;

    // 兼容：早期版本存过屏蔽列表但没有时间戳，补一个，否则它永远不会被推送
    if (blockedSites.length > 0 && localBlockedTs === 0) {
      localBlockedTs = Date.now();
      await chrome.storage.local.set({
        blocked_sites_update_timestamp: localBlockedTs,
      });
    }

    // 3. 获取远程时间戳 - 优先检查 meta.json
    let remoteNotebookTs = 0;
    let remoteBlockedTs = 0;
    let metaData = null;

    try {
      metaData = await client.getFile(metaFileName);
    } catch (e) {
      console.warn("WebDAV: meta.json 读取失败，尝试读取完整数据以确认版本", e);
    }

    if (metaData && metaData.update_timestamp) {
      remoteNotebookTs = metaData.update_timestamp;
      remoteBlockedTs = metaData.blocked_sites_update_timestamp || 0;
    } else {
      // 如果 meta 不存在，兜底检查 notebook.json.gz
      const remoteDataFile = await client.getFile(dataFileName);
      if (remoteDataFile && remoteDataFile.update_timestamp) {
        remoteNotebookTs = remoteDataFile.update_timestamp;
        remoteBlockedTs = remoteDataFile.blocked_sites_update_timestamp || 0;
      }
    }

    console.log(
      `VocabularySync: Notebook Local=${localNotebookTs}, Remote=${remoteNotebookTs}; ` +
        `BlockedSites Local=${localBlockedTs}, Remote=${remoteBlockedTs}`
    );

    const needPullNotebook = remoteNotebookTs > localNotebookTs;
    const needPullBlocked = remoteBlockedTs > localBlockedTs;

    // 4. 拉取较新的远程数据（两份数据分别比较，互不覆盖）
    if (needPullNotebook || needPullBlocked) {
      const remoteDataWrapper = await client.getFile(dataFileName);
      if (!remoteDataWrapper) {
        throw new Error("检测到远程版本更新但无法下载有效数据文件");
      }

      if (needPullNotebook) {
        if (!remoteDataWrapper.notebook) {
          throw new Error("检测到新版本但无法下载有效数据文件");
        }

        // 4.1 备份本地数据
        if (stored.notebook) {
          await chrome.storage.local.set({ notebook_backup_pre_sync: stored.notebook });
        }

        // 4.2 写入新数据
        notebookData = remoteDataWrapper.notebook;
        localNotebookTs = remoteNotebookTs;

        await chrome.storage.local.set({
          notebook: notebookData,
          notebook_update_timestamp: localNotebookTs,
        });
      }

      if (needPullBlocked) {
        if (!Array.isArray(remoteDataWrapper.blocked_sites)) {
          throw new Error("检测到屏蔽列表版本更新但数据文件不完整");
        }

        if (Array.isArray(stored.blocked_sites)) {
          await chrome.storage.local.set({
            blocked_sites_backup_pre_sync: stored.blocked_sites,
          });
        }

        blockedSites = remoteDataWrapper.blocked_sites;
        localBlockedTs = remoteBlockedTs;

        await chrome.storage.local.set({
          blocked_sites: blockedSites,
          blocked_sites_update_timestamp: localBlockedTs,
        });
      }

      // 4.3 通知前端页面刷新
      notifyTabs(stored.notebook ? stored.notebook.length : 0, notebookData.length);
    }

    // 5. 本地较新则推送。任一份较新都上传完整数据，保持两份时间戳一致
    if (localNotebookTs > remoteNotebookTs || localBlockedTs > remoteBlockedTs) {
      console.log("VocabularySync: 本地较新，上传合并后的数据");
      await client.putFile(dataFileName, {
        update_timestamp: localNotebookTs,
        notebook: notebookData,
        blocked_sites: blockedSites,
        blocked_sites_update_timestamp: localBlockedTs,
      });
      await client.putFileJson(metaFileName, {
        update_timestamp: localNotebookTs,
        blocked_sites_update_timestamp: localBlockedTs,
      });
    } else if (!needPullNotebook && !needPullBlocked) {
      console.log("VocabularySync: 数据已是最新，跳过");
    }

    // 6. 更新同步状态
    const now = new Date().toISOString();
    await updateSyncStatus(sync_settings, now, "success");
  } catch (error) {
    console.error("VocabularySync Error:", error);
    // 更新错误状态
    const { sync_settings } = await chrome.storage.local.get(["sync_settings"]);
    if (sync_settings) {
      await updateSyncStatus(sync_settings, new Date().toISOString(), `error: ${error.message}`);
    }
  } finally {
    isSyncing = false;
  }
}

/**
 * 辅助：更新 storage 中的 sync_settings 状态
 */
async function updateSyncStatus(currentSettings, time, status) {
  const newSettings = {
    ...currentSettings,
    last_sync_time: time,
    last_sync_status: status,
  };
  await chrome.storage.local.set({ sync_settings: newSettings });
}

/**
 * 辅助：通知所有 Tab 刷新
 */
function notifyTabs(oldCount, newCount) {
  // 1. 发送 BROADCAST_REFRESH 给 Service Worker (如果我们在 Dashboard 中)
  // 或 直接执行刷新 (如果我们在 SW 中)
  
  // 简单起见，直接查询 Tabs 并发送 REFRESH_HIGHLIGHTS
  // 这是最通用的方法
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      // 过滤掉 chrome:// 协议的页面
      if (tab.url && tab.url.startsWith("http")) {
        chrome.tabs.sendMessage(tab.id, {
            action: "REFRESH_HIGHLIGHTS",
             // 可选：带上信息用于 Toast
            message: `同步完成！(${oldCount} -> ${newCount})` 
        }).catch(() => {
          // 忽略
        });
      }
    });
  });
  
  // 同时也发送消息给 runtime，以便 Dashboard (如果打开) 可以刷新表格
  // Dashboard 监听 'REFRESH_HIGHLIGHTS' ? Dashboard 通常是主动拉取，或者监听 onChanged。
  // Dashboard.js 中没有监听 message REFRESH_HIGHLIGHTS。
  // 但是，我们更新了 storage，Dashboard 如果实现了 onChanged 监听会自动刷新。
  // 目前 Dashboard 没有监听 onChanged，只在 loadData 时读取。
  // 所以我们需要通知 Dashboard 刷新。
  // 发送一个通用的 message
    chrome.runtime.sendMessage({ 
        action: "SYNC_COMPLETED", 
        stats: { oldCount, newCount } 
    }).catch(e => {
        // 如果没有 popup/dashboard 打开，这里会报错，忽略
    });
}
