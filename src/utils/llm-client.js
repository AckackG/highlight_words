/**
 * LLM 翻译客户端（OpenAI 兼容协议）
 *
 * 默认对接 Cloudflare Worker 代理：
 *   POST https://xxx/v1/chat/completions
 *   Header: Authorization: Bearer <key>
 *   Body:   { mode, max_retries, messages }
 *   成功响应头：X-Proxy-Mode / X-Proxy-Model / X-Proxy-Attempts
 *
 * 该模块同时被 service-worker（module）与 dashboard（module）引用，
 * 因此保持纯 ES Module，不依赖任何 chrome API。
 */

export const LLM_DEFAULT_ENDPOINT =
  "https://freeopenrouter.turfia.ggff.net/v1/chat/completions";

export const LLM_DEFAULT_SETTINGS = {
  enabled: false,
  endpoint: LLM_DEFAULT_ENDPOINT,
  api_key: "",
  mode: "advanced", // simple | advanced
  max_retries: 3,
};

/** 判断输入应走「词典模式」还是「整句翻译模式」 */
function isLexicalUnit(text) {
  const words = text.split(/\s+/).filter(Boolean);
  return words.length <= 4 && text.length <= 40;
}

/**
 * 构造 messages。核心目标：给出**符合当前语境**的简短词典释义，
 * 而不是长篇解释——它要和机械词典并排显示，必须短。
 */
export function buildMessages(text, context) {
  const term = text.trim();
  const ctx = (context || "").trim().replace(/\s+/g, " ").slice(0, 300);
  const maxTokens = isLexicalUnit(term) ? 120 : 220;

  if (isLexicalUnit(term)) {
    const system = [
      "你是一部英汉学习词典。用户给出一个词/短语以及它所在的句子，",
      "你只输出【符合该语境】的简短词典式释义。",
      "输出规则：",
      "1. 纯文本，禁止 Markdown、禁止引号、禁止任何客套话或解释性开场白。",
      "2. 严格使用下面的行格式，最多 3 行：",
      "词性. 语境释义（中文，1-3 个近义词，用；分隔）",
      "本句：该词在这句话里的具体意思，不超过 20 字",
      "另义：其他高频义项，最多 2 条，用；分隔（没有就整行省略）",
      "3. 若句子缺失或与词条无关，按最常用义输出，并省略「本句」行。",
      "4. 词性用英文缩写：n. v. adj. adv. prep. phr. 等。",
    ].join("\n");

    const user = `词条：${term}\n句子：${ctx || "（无）"}`;
    return {
      maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
  }

  const system = [
    "你是一名专业中英译者。用户给出一段文本及其上下文，请输出简洁准确的中文翻译。",
    "输出规则：纯文本，禁止 Markdown，禁止客套话。最多 3 行：",
    "译文：自然流畅的中文翻译",
    "要点：其中的难词或固定搭配，最多 2 条，格式「词=释义」，用；分隔（没有就整行省略）",
  ].join("\n");

  const user = `文本：${term}\n上下文：${ctx || "（无）"}`;
  return {
    maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
}

export class LLMClient {
  constructor(settings = {}) {
    const merged = { ...LLM_DEFAULT_SETTINGS, ...settings };
    this.endpoint = (merged.endpoint || LLM_DEFAULT_ENDPOINT).trim();
    this.apiKey = (merged.api_key || "").trim();
    this.mode = merged.mode === "simple" ? "simple" : "advanced";
    this.maxRetries = Math.max(1, parseInt(merged.max_retries, 10) || 3);
  }

  isConfigured() {
    return !!(this.endpoint && this.apiKey);
  }

  /**
   * 发送一次 chat/completions 请求
   * @returns {Promise<{content: string, model: string, attempts: string}>}
   */
  async chat(messages, { timeoutMs = 45000, maxTokens = 0 } = {}) {
    if (!this.isConfigured()) {
      throw new Error("LLM 未配置（缺少接口地址或密钥）");
    }

    const body = { messages };
    // Worker 会透传 max_tokens。输出越短生成越快，这里给个worst-case 上限，
    // 防止话痨模型无视「最多 3 行」的约束一路生成下去。
    if (maxTokens) body.max_tokens = maxTokens;
    if (this.mode === "advanced") {
      body.mode = "advanced";
      body.max_retries = this.maxRetries;
    } else {
      body.mode = "simple";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") throw new Error("请求超时");
      throw new Error(`网络错误：${err.message}`);
    }
    clearTimeout(timer);

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(describeHttpError(response.status, detail));
    }

    const data = await response.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content;
    if (!content || !content.trim()) {
      throw new Error("返回内容为空");
    }

    return {
      content: content.trim(),
      model: response.headers.get("X-Proxy-Model") || data?.model || "",
      attempts: response.headers.get("X-Proxy-Attempts") || "",
    };
  }

  /**
   * 语境化释义
   * @returns {Promise<{text: string, model: string}>}
   */
  async translate(text, context) {
    const { messages, maxTokens } = buildMessages(text, context);
    const { content, model } = await this.chat(messages, { maxTokens });
    return { text: normalizeOutput(content), model };
  }

  /** 连通性测试 */
  async test() {
    const { content, model } = await this.chat(
      [{ role: "user", content: "只回复两个字：正常" }],
      { timeoutMs: 30000 }
    );
    return { content, model };
  }
}

/**
 * 把上游错误翻成人话——这些字符串会直接显示在悬浮窗里，
 * 不能是一坨 JSON。免费模型跑满额度是最常见的失败原因。
 */
function describeHttpError(status, detail) {
  let message = "";
  try {
    message = JSON.parse(detail)?.error?.message || "";
  } catch (e) {
    message = detail.slice(0, 120);
  }

  if (status === 429 || /free-model attempts failed|rate limit/i.test(message)) {
    return "免费模型额度暂时用尽，请稍后再试";
  }
  if (status === 401 || status === 403) {
    return "API Key 无效或无权访问";
  }
  return `请求失败 (HTTP ${status})${message ? "：" + message.slice(0, 80) : ""}`;
}

/** 清掉模型偶尔带出来的 Markdown 包裹与空行 */
function normalizeOutput(content) {
  return content
    // Worker 自行选模型，万一路由到推理模型，思维链可能内联在 content 里
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/^\s*[*_#>-]+\s*/gm, "")
    .replace(/\*\*/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join("\n");
}
