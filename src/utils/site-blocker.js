(function (global) {
  /**
   * 站点屏蔽工具
   * 按域名匹配（忽略 path / 端口 / 协议），并覆盖子域名。
   * 存储：blocked_sites = ["example.com", ...]，不参与 WebDAV 同步。
   */
  const STORAGE_KEY = "blocked_sites";

  let cachedSites = null;

  function normalizeDomain(input) {
    if (!input) return "";
    let host = String(input).trim().toLowerCase();
    host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
    host = host.split(/[/?#]/)[0];
    host = host.replace(/:\d+$/, "");
    if (host.startsWith("www.")) host = host.slice(4);
    return host;
  }

  function matches(hostname, sites) {
    const host = normalizeDomain(hostname);
    if (!host) return false;
    return sites.some((site) => {
      const domain = normalizeDomain(site);
      return domain && (host === domain || host.endsWith("." + domain));
    });
  }

  class SiteBlocker {
    static normalizeDomain(input) {
      return normalizeDomain(input);
    }

    static isBlockedByList(hostname, sites) {
      return matches(hostname, Array.isArray(sites) ? sites : []);
    }

    static async getBlockedSites() {
      if (cachedSites !== null) return cachedSites;
      try {
        const res = await chrome.storage.local.get(STORAGE_KEY);
        cachedSites = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
      } catch (e) {
        cachedSites = [];
      }
      return cachedSites;
    }

    static async isBlocked(hostname) {
      return matches(hostname, await this.getBlockedSites());
    }

    static async isCurrentSiteBlocked() {
      return this.isBlocked(global.location.hostname);
    }

    static async addSite(input) {
      const domain = normalizeDomain(input);
      if (!domain || !domain.includes(".")) {
        return { success: false, error: "域名无效" };
      }

      const sites = await this.getBlockedSites();
      if (!matches(domain, sites)) {
        sites.push(domain);
        await this._save(sites);
      }
      return { success: true, domain, sites };
    }

    static async removeSite(input) {
      const domain = normalizeDomain(input);
      const sites = (await this.getBlockedSites()).filter(
        (site) => normalizeDomain(site) !== domain
      );
      await this._save(sites);
      return sites;
    }

    static async _save(sites) {
      cachedSites = sites;
      await chrome.storage.local.set({
        [STORAGE_KEY]: sites,
        // 独立版本号，供 WebDAV 同步按 LWW 与 notebook 分开比较
        blocked_sites_update_timestamp: Date.now(),
      });
    }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[STORAGE_KEY]) {
        cachedSites = Array.isArray(changes[STORAGE_KEY].newValue)
          ? changes[STORAGE_KEY].newValue
          : [];
      }
    });
  } catch (e) {}

  global.SiteBlocker = SiteBlocker;
})(globalThis);
