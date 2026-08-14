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
  // Worker 自行选模型，可能路由到推理模型。预算必须容得下「思维链 + 答案」，
  // 否则 token 烧完时只吐出半截思考过程（历史 bug）。答案本身只要 ~60 token。
  const maxTokens = isLexicalUnit(term) ? 600 : 800;

  if (isLexicalUnit(term)) {
    const system = [
      "你是一部英汉学习词典。用户给出一个词/短语以及它所在的句子，",
      "你只输出【符合该语境】的简短词典式释义。",
      "输出规则：",
      "1. 纯文本，禁止 Markdown、禁止引号、禁止任何客套话或解释性开场白。",
      "1.1 直接给答案。不要复述规则、不要分析、不要输出任何思考过程。",
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
    "输出规则：纯文本，禁止 Markdown，禁止客套话。直接给答案，不要输出任何思考过程。最多 3 行：",
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
    // 查词是简单任务，不需要推理。两个字段覆盖两套关法：
    //   reasoning          —— OpenRouter 的统一开关，exclude 顺带保证不内联进 content
    //   chat_template_kwargs —— Nemotron / Qwen3 这类靠 chat template 切换思考模式的模型
    // 不认识这些字段的上游会忽略它们。
    body.reasoning = { enabled: false, exclude: true };
    body.chat_template_kwargs = { thinking: false };
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

    // 免费模型不稳定，吐思维链时重试一次通常就正常了。
    let lastModel = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const { content, model } = await this.chat(messages, { maxTokens });
      lastModel = model;
      const result = normalizeOutput(content);
      if (result && !looksLikeReasoning(result)) {
        return { text: result, model };
      }
    }
    // 抛错而不是返回垃圾：上层据此走 error 分支，不会写进缓存和生词本
    throw new Error(
      `模型返回了思考过程而非结果${lastModel ? `（${lastModel}）` : ""}，请重试`
    );
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

/**
 * 剥掉内联在 content 里的思维链。
 * 三种形态都要处理，只匹配成对标签会漏掉后两种：
 *   1. <think>…</think>答案
 *   2. 思考…</think>答案   —— 上游把开标签当成 prefill 吃掉了
 *   3. <think>思考…        —— token 用尽，答案根本没生成，全丢
 */
function stripReasoning(content) {
  let out = content.replace(/<think>[\s\S]*?<\/think>/gi, "");

  const lastClose = out.toLowerCase().lastIndexOf("</think>");
  if (lastClose !== -1) out = out.slice(lastClose + "</think>".length);

  const openIdx = out.search(/<think>/i);
  if (openIdx !== -1) out = out.slice(0, openIdx);

  return out;
}

/**
 * 判断这段文本是不是模型的自言自语。
 * 释义/译文必须是中文，思维链几乎总是英文的元讨论。
 */
function looksLikeReasoning(text) {
  const cjk = (text.match(/[一-鿿]/g) || []).length;
  if (cjk / text.length < 0.2) return true;

  return /\b(we need to|we should|the user (wants|gave|asks)|per (the )?rules?|output rules?|so (the )?format|let'?s (output|write)|I should (output|answer))\b/i.test(
    text.slice(0, 300)
  );
}

/** 清掉模型偶尔带出来的 Markdown 包裹与空行 */
function normalizeOutput(content) {
  return stripReasoning(content)
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/^\s*[*_#>-]+\s*/gm, "")
    .replace(/\*\*/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    // 无标签的思维链只能靠内容识别：正式答案必然以中文开头，
    // 所以丢掉开头那些「自言自语」行，剩下的才是结果
    .reduce((acc, line) => {
      if (!acc.length && looksLikeReasoning(line)) return acc;
      acc.push(line);
      return acc;
    }, [])
    .slice(0, 4)
    .join("\n");
}
