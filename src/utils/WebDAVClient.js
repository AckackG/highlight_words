/**
 * WebDAV 客户端封装
 * 用于处理与 WebDAV 服务器的底层通信
 * 集成 Gzip 压缩/解压功能
 */
export class WebDAVClient {
  /**
   * @param {string} url - 服务器地址 (e.g. https://dav.jianguoyun.com/dav/)
   * @param {string} username
   * @param {string} password
   */
  constructor(url, username, password) {
    this.baseUrl = url.endsWith("/") ? url : url + "/";
    this.username = username;
    this.password = password;
    this.baseDir = "EXThighlight_words/";
  }

  get headers() {
    // 提示：如果用户名密码含中文，此处可能需要 encodeURIComponent 或其他处理
    const token = btoa(`${this.username}:${this.password}`);
    return {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json",
    };
  }

  async checkConnection() {
    try {
      const response = await fetch(this.baseUrl, {
        method: "PROPFIND",
        headers: { ...this.headers, Depth: "0" },
      });
      return response.status < 400;
    } catch (error) {
      console.error("WebDAV 连接检查失败:", error);
      return false;
    }
  }

  async ensureDirectory() {
    const dirUrl = this.baseUrl + this.baseDir;
    const checkRes = await fetch(dirUrl, {
      method: "PROPFIND",
      headers: { ...this.headers, Depth: "0" },
    });

    if (checkRes.status === 404) {
      const createRes = await fetch(dirUrl, {
        method: "MKCOL",
        headers: this.headers,
      });
      if (!createRes.ok && createRes.status !== 405) {
        throw new Error(`无法创建目录: ${createRes.statusText}`);
      }
    } else if (!checkRes.ok) {
      throw new Error(`无法访问目录: ${checkRes.statusText}`);
    }
  }

  /**
   * 下载文件 (支持自动识别 Gzip 压缩)
   */
  async getFile(filename) {
    await this.ensureDirectory();
    const url = this.baseUrl + this.baseDir + filename;

    const response = await fetch(url, {
      method: "GET",
      headers: this.headers,
    });

    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`下载失败: ${response.status}`);

    const blob = await response.blob();
    if (blob.size === 0) return null;

    // 检查 Gzip Magic Number (1F 8B)
    // 这样既能兼容旧的 .json 文件，也能处理新的 .gz 文件
    const arr = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    const isGzip = arr.length >= 2 && arr[0] === 0x1f && arr[1] === 0x8b;

    if (isGzip) {
      try {
        // 使用原生 API 解压
        const ds = new DecompressionStream("gzip");
        const stream = blob.stream().pipeThrough(ds);
        const decompressedResponse = new Response(stream);
        return await decompressedResponse.json();
      } catch (e) {
        console.error("Gzip 解压失败，尝试作为普通文本解析", e);
        const text = await blob.text();
        return JSON.parse(text);
      }
    } else {
      // 普通文本
      const text = await blob.text();
      return JSON.parse(text);
    }
  }

  /**
   * 上传文件 (强制使用 Gzip 压缩)
   */
  async putFile(filename, data) {
    await this.ensureDirectory();
    const url = this.baseUrl + this.baseDir + filename;

    // 1. 转换为 JSON 字符串
    const jsonString = JSON.stringify(data);

    // 2. 创建 Gzip 压缩流
    const sourceBlob = new Blob([jsonString], { type: "application/json" });
    const cs = new CompressionStream("gzip");
    const compressedStream = sourceBlob.stream().pipeThrough(cs);

    // 3. 将流转回 Blob (这一步是必要的，因为 fetch body 直接传 stream 在某些环境下可能有兼容性问题，Blob 最稳)
    const compressedResponse = new Response(compressedStream);
    const compressedBlob = await compressedResponse.blob();

    // 4. 上传
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        ...this.headers,
        "Content-Type": "application/gzip", // 明确告诉服务器这是压缩文件
      },
      body: compressedBlob,
    });

    if (!response.ok && response.status !== 201 && response.status !== 204) {
      throw new Error(`上传失败: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * 上传普通 JSON 文件 (不压缩)
   * 用于 meta.json 等小文件
   */
  async putFileJson(filename, data) {
    await this.ensureDirectory();
    const url = this.baseUrl + this.baseDir + filename;

    const jsonString = JSON.stringify(data);

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        ...this.headers,
        "Content-Type": "application/json",
      },
      body: jsonString,
    });

    if (!response.ok && response.status !== 201 && response.status !== 204) {
      throw new Error(`上传失败: ${response.status} ${response.statusText}`);
    }
  }
}
