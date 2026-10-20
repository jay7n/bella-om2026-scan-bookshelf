/**
 * DeepSeek 接口封装（OpenAI 兼容格式）
 * 只用原生 fetch，不引第三方 SDK。
 */

const BASE_URL = (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
const API_KEY = process.env.DEEPSEEK_API_KEY?.trim() || "";
const VISION_MODEL = process.env.DEEPSEEK_VISION_MODEL?.trim() || "deepseek-flash";
const TEXT_MODEL = process.env.DEEPSEEK_TEXT_MODEL?.trim() || "deepseek-flash";

/**
 * DeepSeek 的思考模式默认是打开的（effort=high）。
 * 不关掉的话：首字要等十几秒，而且思维链会吃掉 max_tokens，
 * 把书名单截断 —— 「3~5 秒出第一张卡」直接不成立。
 * 换成火山方舟等其它厂商时，如果接口不认这个字段，把它设成空值即可。
 */
const THINKING = (process.env.DEEPSEEK_THINKING ?? "disabled").trim().toLowerCase();

function thinkingField(): Record<string, unknown> {
  if (THINKING === "enabled") return { thinking: { type: "enabled" } };
  if (THINKING === "off" || THINKING === "") return {};
  return { thinking: { type: "disabled" } };
}

export function hasApiKey(): boolean {
  return API_KEY.length > 0;
}

export function keyStatus(): { ok: boolean; message?: string } {
  if (!API_KEY) {
    return { ok: false, message: "缺少 DEEPSEEK_API_KEY：请在 bookshelf-scanner/.env.local 里填好 key，然后重启 npm run dev" };
  }
  return { ok: true };
}

type ImagePart = {
  type: "image_url";
  image_url: { url: string; detail?: "low" | "high" | "original" | "auto" };
};

type Msg =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "user"; content: Array<{ type: "text"; text: string } | ImagePart> };

async function post(body: unknown, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DeepSeek ${res.status}: ${text.slice(0, 400)}`);
  }
  return res;
}

/**
 * 流式调用，逐块吐出模型输出的文本增量。
 * 用于「边说边出书名」——第一个书名一到就能去查豆瓣。
 */
export async function* streamText(opts: {
  model?: string;
  messages: Msg[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const res = await post(
    {
      model: opts.model ?? VISION_MODEL,
      messages: opts.messages,
      stream: true,
      temperature: opts.temperature ?? 0,
      max_tokens: opts.maxTokens ?? 1200,
      ...thinkingField(),
    },
    opts.signal,
  );

  if (!res.body) throw new Error("DeepSeek 返回了空响应体");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE：一行一条 data: {...}
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line || !line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) yield delta;
        } catch {
          // 半截 JSON，忽略
        }
      }
    }
  } finally {
    // 调用方提前 break（比如已经凑够 20 本）时，把上游连接真正断掉，
    // 否则连接会一直挂到 GC，长时间用会堆积。
    reader.cancel().catch(() => {});
  }
}

/** 一次性调用，要求模型返回 JSON 对象 */
export async function chatJSON<T>(opts: {
  model?: string;
  messages: Msg[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<T> {
  const res = await post(
    {
      model: opts.model ?? TEXT_MODEL,
      messages: opts.messages,
      stream: false,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 600,
      response_format: { type: "json_object" },
      ...thinkingField(),
    },
    opts.signal,
  );
  const json = await res.json();
  const content: string = json?.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(stripFence(content)) as T;
}

/** 去掉模型偶尔加上的 ```json 围栏 */
export function stripFence(s: string): string {
  let t = s.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\s*/, "");
    t = t.replace(/```\s*$/, "");
  }
  return t.trim();
}

export const models = { vision: VISION_MODEL, text: TEXT_MODEL };
