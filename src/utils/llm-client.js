/**
 * LLM 翻译客户端（OpenAI Chat Completions 协议）
 *
 * 支持两种 provider：
 *   openai   —— 默认。标准 OpenAI 兼容接口（OpenAI / DeepSeek / Groq / OpenRouter /
 *               Ollama / 自建 vLLM 等），请求体只带协议内字段：{ model, messages, max_tokens }。
 *   cfworker —— 特殊接口。作者自建的 Cloudflare Worker 代理，由 Worker 侧挑模型，
 *               额外接受 { mode, max_retries } 以及关思考的私有字段，
 *               并通过 X-Proxy-Model / X-Proxy-Attempts 响应头回传实际用的模型。
 *
 * 两者共用同一套 messages 构造与输出清洗逻辑，差别只在请求体与模型名来源。
 *
 * 该模块同时被 service-worker（module）与 dashboard（module）引用，
 * 因此保持纯 ES Module，不依赖任何 chrome API。
 */

export const LLM_PROVIDER_OPENAI = "openai";
export const LLM_PROVIDER_CFWORKER = "cfworker";

export const LLM_PROVIDER_PRESETS = {
  [LLM_PROVIDER_OPENAI]: {
    label: "OpenAI 兼容接口",
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
  },
  [LLM_PROVIDER_CFWORKER]: {
    label: "Cloudflare Worker 代理",
    endpoint: "https://freeopenrouter.turfia.ggff.net/v1/chat/completions",
    model: "", // 由 Worker 侧路由，不填
  },
};

/** 默认接口地址（OpenAI 官方） */
export const LLM_DEFAULT_ENDPOINT =
  LLM_PROVIDER_PRESETS[LLM_PROVIDER_OPENAI].endpoint;

export const LLM_DEFAULT_SETTINGS = {
  enabled: false,
  provider: LLM_PROVIDER_OPENAI,
  endpoint: LLM_DEFAULT_ENDPOINT,
  api_key: "",
  model: LLM_PROVIDER_PRESETS[LLM_PROVIDER_OPENAI].model,
  // 以下两项只对 cfworker 生效，openai 分支不会发出去
  mode: "advanced", // simple | advanced
  max_retries: 3,
};

/**
 * 合并默认值并迁移老配置。
 * v1 只有 CF Worker 一种接口，存下来的 llm_settings 没有 provider 字段；
 * 这类记录必须继续按 cfworker 走，否则会把私有字段发给不认识它们的上游。
 */
export function normalizeLlmSettings(rawSettings) {
  const raw = rawSettings || {};
  const settings = { ...LLM_DEFAULT_SETTINGS, ...raw };

  if (!raw.provider) {
    const hasLegacyConfig = !!(raw.endpoint || raw.api_key);
    settings.provider = hasLegacyConfig
      ? LLM_PROVIDER_CFWORKER
      : LLM_PROVIDER_OPENAI;
  }
  if (settings.provider !== LLM_PROVIDER_CFWORKER) {
    settings.provider = LLM_PROVIDER_OPENAI;
  }

  // 缺省值必须取**当前 provider** 的预设，不能用 LLM_DEFAULT_SETTINGS 里的
  // openai 预设兜底——否则一份没写 endpoint 的 cfworker 配置会被打到 OpenAI 上。
  const preset = LLM_PROVIDER_PRESETS[settings.provider];
  settings.endpoint = ((raw.endpoint || "").trim() || preset.endpoint).trim();
  settings.api_key = (settings.api_key || "").trim();
  settings.model = (
    (raw.model === undefined ? preset.model : raw.model) || ""
  ).trim();
  settings.mode = settings.mode === "simple" ? "simple" : "advanced";
  settings.max_retries = Math.min(
    10,
    Math.max(1, parseInt(settings.max_retries, 10) || 3)
  );

  return settings;
}

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
  // 上游可能是推理模型（Worker 会路由过去，用户也可能自己填一个）。
  // 预算必须容得下「思维链 + 答案」，否则 token 烧完时只吐出半截思考过程（历史 bug）。
  // 答案本身只要 ~60 token。
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

/**
 * 值得重试的状态码：429 限流、5xx 上游过载/网关抖动。
 * 4xx 的其余情况（key 无效、模型名写错）重试多少次都是同样的结果，不进这个集合。
 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** 退避间隔，长度即额外重试次数。查词是交互操作，总耗时不能拖太久 */
const RETRY_BACKOFF_MS = [700, 2000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class LLMClient {
  constructor(settings = {}) {
    const merged = normalizeLlmSettings(settings);
    this.provider = merged.provider;
    this.endpoint = merged.endpoint;
    this.apiKey = merged.api_key;
    this.model = merged.model;
    this.mode = merged.mode;
    this.maxRetries = merged.max_retries;
    // o 系列 / gpt-5 只认 max_completion_tokens，其余模型只认 max_tokens。
    // 先按大多数情况发 max_tokens，被上游拒了再自动改用另一个字段（见 chat）。
    this.tokenField = "max_tokens";
  }

  isCfWorker() {
    return this.provider === LLM_PROVIDER_CFWORKER;
  }

  isConfigured() {
    if (!this.endpoint || !this.apiKey) return false;
    // 标准 OpenAI 接口必须显式指定模型；CF Worker 由服务端自己挑
    if (!this.isCfWorker() && !this.model) return false;
    return true;
  }

  /** 按 provider 组装请求体 */
  buildBody(messages, maxTokens) {
    const body = { messages };

    if (this.isCfWorker()) {
      // 查词是简单任务，不需要推理。两个字段覆盖两套关法：
      //   reasoning          —— OpenRouter 的统一开关，exclude 顺带保证不内联进 content
      //   chat_template_kwargs —— Nemotron / Qwen3 这类靠 chat template 切换思考模式的模型
      // 这些都是私有扩展字段，只能发给 Worker：官方 OpenAI 接口见到未知字段会直接 400。
      body.reasoning = { enabled: false, exclude: true };
      body.chat_template_kwargs = { thinking: false };
      if (this.mode === "advanced") {
        body.mode = "advanced";
        body.max_retries = this.maxRetries;
      } else {
        body.mode = "simple";
      }
    } else {
      body.model = this.model;
    }

    // 输出越短生成越快，这里给个 worst-case 上限，
    // 防止话痨模型无视「最多 3 行」的约束一路生成下去。
    if (maxTokens) body[this.tokenField] = maxTokens;
    return body;
  }

  async post(body, { timeoutMs, signal }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: signal || controller.signal,
      });
    } catch (err) {
      if (err.name === "AbortError") throw new Error("请求超时");
      throw new Error(`网络错误：${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 发送一次 chat/completions 请求（含针对瞬时故障的退避重试）
   * @returns {Promise<{content: string, model: string, attempts: string}>}
   */
  async chat(messages, { timeoutMs = 45000, maxTokens = 0 } = {}) {
    if (!this.isConfigured()) {
      throw new Error(
        this.isCfWorker()
          ? "LLM 未配置（缺少接口地址或密钥）"
          : "LLM 未配置（缺少接口地址、密钥或模型名）"
      );
    }

    // 429/5xx 是瞬时的（上游过载最常见），退避重发一次通常就过了。
    // cfworker 的 advanced 模式已经在服务端自己换模型重试，这里不再叠加。
    const maxAttempts = this.isCfWorker() ? 1 : RETRY_BACKOFF_MS.length + 1;
    let lastRetryableError = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response = await this.post(this.buildBody(messages, maxTokens), {
        timeoutMs,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        // gpt-5 / o 系列会用 400 明确要求换成 max_completion_tokens，换了重发一次
        if (
          response.status === 400 &&
          maxTokens &&
          this.tokenField === "max_tokens" &&
          /max_completion_tokens/i.test(detail)
        ) {
          this.tokenField = "max_completion_tokens";
          response = await this.post(this.buildBody(messages, maxTokens), {
            timeoutMs,
          });
          if (!response.ok) {
            const retryDetail = await response.text().catch(() => "");
            throw new Error(describeHttpError(response.status, retryDetail));
          }
        } else if (
          RETRYABLE_STATUS.has(response.status) &&
          attempt < maxAttempts
        ) {
          lastRetryableError = describeHttpError(response.status, detail);
          await sleep(RETRY_BACKOFF_MS[attempt - 1]);
          continue;
        } else {
          const message = describeHttpError(response.status, detail);
          // 重试过还是同一类错误时说明白，免得用户以为只试了一次
          throw new Error(
            attempt > 1 ? `${message}（已重试 ${attempt - 1} 次）` : message
          );
        }
      }

      const data = await response.json().catch(() => null);
      const content = data?.choices?.[0]?.message?.content;
      if (!content || !content.trim()) {
        throw new Error("返回内容为空");
      }

      return {
        content: content.trim(),
        // CF Worker 自己选模型，实际用的那个在响应头里；标准接口直接回显 model
        model:
          response.headers.get("X-Proxy-Model") || data?.model || this.model,
        attempts: response.headers.get("X-Proxy-Attempts") || "",
      };
    }

    // 循环只会因「可重试错误且还有次数」而继续，走到这里说明次数用尽
    throw new Error(lastRetryableError || "请求失败");
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
 * 不能是一坨 JSON。限流/余额不足是最常见的失败原因。
 */
function describeHttpError(status, detail) {
  let message = "";
  try {
    message = JSON.parse(detail)?.error?.message || "";
  } catch (e) {
    message = detail.slice(0, 120);
  }

  if (/free-model attempts failed/i.test(message)) {
    return "免费模型额度暂时用尽，请稍后再试";
  }
  if (/insufficient_quota|exceeded your current quota|余额/i.test(message)) {
    return "账户额度不足，请检查计费设置";
  }
  if (status === 429 || /rate limit/i.test(message)) {
    return "请求过于频繁或额度用尽，请稍后再试";
  }
  if (status === 503 || status === 502 || status === 504) {
    // 模型服务过载时会带明确的 message；空 body 的 5xx 基本都是中间环节吐的，
    // 这条区分很重要——前者等一等就好，后者再等也没用，得去查代理
    if (!message) {
      return `上游 ${status} 且无错误详情，通常来自代理/网关而非模型服务，请检查代理链路`;
    }
    if (/overload/i.test(message)) {
      return "模型服务过载，请稍后再试或换一个模型";
    }
    return `上游暂时不可用 (HTTP ${status})：${message.slice(0, 80)}`;
  }
  if (status === 401 || status === 403) {
    return "API Key 无效或无权访问";
  }
  if (status === 404) {
    return `接口或模型不存在 (HTTP 404)${message ? "：" + message.slice(0, 80) : ""}`;
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
