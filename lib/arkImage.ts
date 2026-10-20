/**
 * 火山方舟 · Seedream 文生图
 * 照着 qing-tuan-editor-exp-wksp2 里的 arkSeedreamImageClient 接的，
 * 只保留了封面场景需要的部分。
 */

const KEY = process.env.ARK_API_KEY?.trim() || "";
const BASE = (process.env.ARK_API_BASE?.trim() || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/+$/, "");
const MODEL = process.env.ARK_IMAGE_MODEL?.trim() || "doubao-seedream-4-0-20260415";

/**
 * 备选模型链。
 * 方舟的模型经常会被下架（Retiring）或者账号没开通，
 * 配错一个名字就整个功能挂掉，所以按顺序试，第一个能用的记住。
 */
const FALLBACK_MODELS = [
  "doubao-seedream-4-0-20260415",
  "doubao-seedream-4-0-250828",
  "doubao-seedream-5-0-flash-260915",
  "doubao-seedream-5-0-pro-260628",
];

let resolvedModel: string | null = null;

function modelQueue(): string[] {
  const first = resolvedModel ?? MODEL;
  return [first, ...FALLBACK_MODELS.filter((m) => m !== first)];
}

/** 只有"模型不存在/没开通"才换下一个；超时、限流之类的不重试 */
function isModelUnavailable(text: string): boolean {
  return /ModelNotOpen|InvalidEndpointOrModel|NotFound|not activated/i.test(text);
}

export function hasImageKey(): boolean {
  return KEY.length > 0;
}

export function imageModel(): string {
  return resolvedModel ?? MODEL;
}

/** Seedream 5 系列：方舟要求总像素 ≥ 1920×1920 */
const SEEDREAM5_MIN_PIXELS = 3_686_400;

function isSeedream5(model: string): boolean {
  return /seedream[-_.]?5|doubao-seedream-5/i.test(model);
}

/** 按 2:3 出图；模型是 5 系就自动放大到最小像素，保持比例 */
export function resolveCoverSize(model: string): { width: number; height: number } {
  let w = 1024;
  let h = 1536;

  if (isSeedream5(model) && w * h < SEEDREAM5_MIN_PIXELS) {
    const aspect = w / h;
    const scale = Math.sqrt(SEEDREAM5_MIN_PIXELS / (w * h));
    w = Math.ceil((w * scale) / 8) * 8;
    h = Math.ceil((h * scale) / 8) * 8;
    while (w * h < SEEDREAM5_MIN_PIXELS) h += 8;
    if (w / h < aspect) w += 8;
  }
  return { width: w, height: h };
}

/**
 * 封面提示词。
 * 死规定：画面里不能有字 —— 书名由前端叠上去，模型写字必糊。
 */
export function buildCoverPrompt(
  title: string,
  opts: { intro?: string; vibe?: string[]; tags?: string[]; grade?: string } = {},
): { prompt: string; negative: string } {
  // 简介自带句号，这里先去掉尾部标点，免得拼出「。。」
  const intro = (opts.intro || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[。！？，、；：\s]+$/, "")
    .slice(0, 70);
  const vibe = (opts.vibe || []).filter(Boolean).slice(0, 3).join("、");
  const tags = (opts.tags || []).filter(Boolean).slice(0, 3).join("、");
  const grade = (opts.grade || "").trim().slice(0, 8);

  const prompt = [
    `一本儿童绘本的封面插画，主题是「${title}」。`,
    intro ? `画面内容：${intro}。` : "",
    vibe ? `读起来的感觉：${vibe}。` : "",
    tags ? `类别：${tags}。` : "",
    grade ? `读者是${grade}的孩子。` : "",
    "柔和的手绘插画风格，颜色温暖但不刺眼。构图完整：主体放在画面中间，四周留出均匀的边距，任何部分都不要超出画面或被切掉。",
    "画面里绝对不要出现任何文字、汉字、字母、数字、印章、水印或 logo。",
  ]
    .filter(Boolean)
    .join("");

  const negative = "文字, 汉字, 字母, 数字, 水印, 签名, 排版, 书脊, 二维码, logo, 边框";
  return { prompt, negative };
}

type ArkImageResponse = {
  data?: Array<{ url?: string }>;
  id?: string;
  error?: { message?: string } | string;
};

/**
 * 生成一张封面并直接把图片字节读回来。
 * 方舟返回的是临时 URL（约 24 小时过期），所以必须当场下载，不能把 URL 存下来。
 */
export type CoverContext = {
  intro?: string;
  vibe?: string[];
  tags?: string[];
  grade?: string;
};

export async function generateCoverImage(
  title: string,
  ctx: CoverContext = {},
): Promise<{ bytes: Uint8Array; type: string; model: string }> {
  if (!KEY) throw new Error("缺少 ARK_API_KEY");

  const { prompt, negative } = buildCoverPrompt(title, ctx);
  const queue = modelQueue();
  let lastError = "";

  for (let i = 0; i < queue.length; i++) {
    const model = queue[i];
    const { width, height } = resolveCoverSize(model);

    let res: Response;
    try {
      res = await fetch(`${BASE}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${KEY}`,
        },
        body: JSON.stringify({
          model,
          prompt,
          size: `${width}x${height}`,
          response_format: "url",
          watermark: false,
          sequential_image_generation: "disabled",
          negative_prompt: negative,
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      // 网络/超时不换模型，直接抛
      throw err;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      lastError = `${res.status}: ${text.slice(0, 200)}`;
      if (isModelUnavailable(text) && i < queue.length - 1) {
        console.warn(`[ark] 模型 ${model} 不可用，换下一个`);
        continue;
      }
      throw new Error(`方舟生图失败 ${lastError}`);
    }

    const data = (await res.json()) as ArkImageResponse;
    const url = data?.data?.[0]?.url;
    if (!url) {
      const msg = typeof data?.error === "string" ? data.error : data?.error?.message;
      throw new Error(msg || "方舟没有返回图片地址");
    }

    // 临时 URL（约 24 小时过期）必须当场抓下来
    const img = await fetch(url, { signal: AbortSignal.timeout(45_000), cache: "no-store" });
    if (!img.ok) throw new Error(`下载生成的图片失败 ${img.status}`);

    const type = img.headers.get("content-type") || "image/jpeg";
    if (!type.startsWith("image/")) throw new Error("返回的不是图片");

    const bytes = new Uint8Array(await img.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 12 * 1024 * 1024) {
      throw new Error("生成的图片大小异常");
    }

    resolvedModel = model;
    return { bytes, type, model };
  }

  throw new Error(`没有可用的生图模型（最后一次：${lastError}）`);
}
