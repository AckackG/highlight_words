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
    // 1. 获取配置
    const { sync_settings, notebook, notebook_update_timestamp } = await chrome.storage.local.get([
      "sync_settings",
      "notebook",
      "notebook_update_timestamp",
    ]);

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

    // 2. 获取本地时间戳 (T_local)
    const localTs = notebook_update_timestamp || 0;
    const localData = {
        update_timestamp: localTs,
        notebook: notebook || []
    };

    // 3. 获取远程时间戳 (T_remote) - 优先检查 meta.json
    let remoteTs = 0;
    let metaData = null;

    try {
      metaData = await client.getFile(metaFileName);
    } catch (e) {
      console.warn("WebDAV: meta.json 读取失败，尝试读取完整数据以确认版本", e);
    }

    if (metaData && metaData.update_timestamp) {
      remoteTs = metaData.update_timestamp;
    } else {
      // 如果 meta 不存在，兜底检查 notebook.json.gz
      const remoteDataFile = await client.getFile(dataFileName);
      if (remoteDataFile && remoteDataFile.update_timestamp) {
        remoteTs = remoteDataFile.update_timestamp;
      }
    }

    console.log(`VocabularySync: Local TS=${localTs}, Remote TS=${remoteTs}`);

    // 4. 比较决策
    if (remoteTs === 0 && localTs > 0) {
      // 情况 A: 远程不存在 (或为空) -> 上传 (Push)
      console.log("VocabularySync: 初始化远程文件");
      await client.putFile(dataFileName, localData);
      await client.putFileJson(metaFileName, { update_timestamp: localTs });
    } else if (localTs > remoteTs) {
      // 情况 B: 本地较新 -> 上传 (Push)
      console.log("VocabularySync: 本地较新，覆盖远程");
      await client.putFile(dataFileName, localData);
      await client.putFileJson(metaFileName, { update_timestamp: localTs });
    } else if (localTs < remoteTs) {
      // 情况 C: 远程较新 -> 下载应用 (Pull)
      console.log("VocabularySync: 远程较新，覆盖本地");

      // 必须下载完整数据文件
      const remoteDataWrapper = await client.getFile(dataFileName);
      if (!remoteDataWrapper || !remoteDataWrapper.notebook) {
        throw new Error("检测到新版本但无法下载有效数据文件");
      }

      // 4.1 备份本地数据
      if (notebook) {
        await chrome.storage.local.set({ notebook_backup_pre_sync: notebook });
      }

      // 4.2 写入新数据
      await chrome.storage.local.set({ 
          notebook: remoteDataWrapper.notebook,
          notebook_update_timestamp: remoteDataWrapper.update_timestamp
      });

      // 4.3 通知前端页面刷新
      notifyTabs(notebook ? notebook.length : 0, remoteDataWrapper.notebook.length);
    } else {
      console.log("VocabularySync: 数据已是最新，跳过");
    }

    // 5. 更新同步状态
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
