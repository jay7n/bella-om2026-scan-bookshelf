/** 提示词集中放这里，方便调 */

/**
 * 第一步：从书架照片里读书名。
 * 要求模型输出 JSON Lines（一行一本），这样流式解析时
 * 收到第一行就能立刻去查封面，不用等全部识别完。
 */
export const TITLE_PROMPT = `你是一个书架识别助手。请读出这张书架照片里所有书脊上的书名。

输出格式：严格使用 JSON Lines，每行一个 JSON 对象，格式为 {"t":"书名"}
不要输出数组、不要输出任何解释文字、不要用 markdown 代码块。

规则：
1. 只输出书脊上真实可见的书名，看不清的、被挡住的、猜的不确定的一律不要输出。
2. 不要编造书名，不要输出重复的书名。
3. 书名保持书脊上的原样，不要加书名号《》。
4. 如果照片里一本书都认不出来，就输出一个空行，不要乱猜。
5. 最多输出 30 本。`;

/**
 * 第二步：给一本书写「8 岁能听懂」的简介。
 * 一本书一次调用——这样第一张卡片的文案能最先回来，
 * 不用等全部 20 本一起算完。
 *
 * 目标是「看一眼就知道喜不喜欢」，所以除了简介还要：
 * 一句钩子（想不想看全看这句）、一组气质词、一本同类书。
 */
export function enrichPrompt(
  title: string,
  author?: string,
  year?: string,
  profileText?: string,
): string {
  const extra = [author && `作者：${author}`, year && `出版年：${year}`].filter(Boolean).join("，");
  const who = profileText
    ? `你要推荐给的这个孩子：${profileText}。`
    : "你要推荐给一个四年级（10 岁）的孩子。";
  return `你是一个懂小朋友的图书管理员。${who}

书：《${title}》${extra ? `（${extra}）` : ""}

请用 8 岁小孩能听懂的大白话写介绍。要求：
- intro：一句话讲清这本书讲什么，不超过 35 个字。不许用"认知发展""文学素养""寓教于乐"这类大人词。
- hook：一句让孩子「立刻想看」的话，不超过 22 个字。要有具体画面或具体疑问，不要"快来读一读吧"这种废话。
- vibe：2 到 3 个词，形容「读这本书是什么感觉」，每个 2 到 4 个字。例如：好笑、有点吓人、温暖、烧脑、安静、热血。
- tags：2 到 3 个，每个 2 到 6 个字，说明类别或用途。不要带 # 号。
- grade：最适合几年级读。
- similar：一本家喻户晓的同类书，写成「喜欢《X》的会喜欢这本」，不超过 18 个字。没把握就给空字符串，绝对不要瞎编。

如果这本书你不了解，就照书名推测它大概讲什么，语气要诚实、不要吹。

${FIT_PROMPT}
只返回 JSON，格式：
{"intro":"...","hook":"...","vibe":["好笑","温暖"],"tags":["科普"],"grade":"三年级","similar":"喜欢《神奇校车》的会喜欢这本","fit":"很合适","reason":"..."}`;
}

/** 详情页：比卡片更深一层，但依然说人话 */
export function detailPrompt(title: string, author?: string, year?: string, rating?: string | null): string {
  const meta = [author && `作者：${author}`, year && `出版年：${year}`, rating && `豆瓣评分：${rating}`]
    .filter(Boolean)
    .join("，");

  return `你是社区图书角的管理员，正在帮一个四年级小朋友判断「这本书值不值得借回家」。

书：《${title}》${meta ? `（${meta}）` : ""}

请回答四个问题，全部用 10 岁孩子能听懂的话，不要书面语，不要空话：

- what：这本书到底讲了个什么故事 / 什么事，不超过 80 字。要有具体的人或事，不要「探讨了成长的烦恼」这种。
- why：为什么值得读，不超过 60 字。要说具体的东西（比如「你能看到真的恐龙有多大」），不要说「增长见识」。
- before：读之前要知道的一件事，不超过 45 字。比如要不要按顺序读、书厚不厚、有没有难字、会不会吓人。
- bestFor：最适合谁读，一句话，不超过 25 字。

不知道的就照书名合理推测，不要编造事实性细节（比如获奖、销量）。

只返回 JSON：
{"what":"...","why":"...","before":"...","bestFor":"..."}`;
}

/**
 * 书名的清洗与比较。
 * 豆瓣返回的结果经常带副标题、丛书名、版本后缀，
 * 所以要先归一化再比，避免贴错封面。
 */
export function normalizeTitle(s: string): string {
  return s
    .replace(/[《》〈〉「」『』【】\[\]]/g, "")
    .replace(/[\s\u3000]/g, "")
    .replace(/[：:·•・_，,。.！!？?—\-]/g, "")
    .replace(/["'“”‘’]/g, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .toLowerCase()
    .trim();
}

/** 从流式返回的一行里抽书名，抽不到返回 null */
export function parseTitleLine(line: string): string | null {
  let t = line.trim();
  if (!t) return null;
  t = t.replace(/^```[a-zA-Z]*/, "").replace(/```$/, "").trim();
  if (!t || t === "[" || t === "]" || t === "{}") return null;

  // 形如 {"t":"书名"}
  if (t.startsWith("{")) {
    try {
      const obj = JSON.parse(t.replace(/,\s*$/, ""));
      const v = obj.t ?? obj.title ?? obj.name ?? obj["书名"];
      if (typeof v === "string" && v.trim()) return cleanupTitle(v);
    } catch {
      const m = t.match(/"(?:t|title|name)"\s*:\s*"([^"]+)"/);
      if (m) return cleanupTitle(m[1]);
    }
    return null;
  }

  // 形如 "书名"
  if (t.startsWith('"')) {
    const m = t.match(/^"([^"]+)"/);
    if (m) return cleanupTitle(m[1]);
    return null;
  }

  // 形如 1. 书名  或  - 书名
  const bare = t.replace(/^[\d]+[.、)）]\s*/, "").replace(/^[-*•]\s*/, "");
  if (bare && !/[{}[\]]/.test(bare) && bare.length <= 40) return cleanupTitle(bare);

  return null;
}

function cleanupTitle(s: string): string | null {
  const t = s.replace(/^[《「『]/, "").replace(/[》」』]$/, "").replace(/\s+/g, " ").trim();
  if (!t || t.length < 1 || t.length > 40) return null;
  if (/^(书名|标题|unknown|无|暂无)$/i.test(t)) return null;
  return t;
}

/** 把使用者画像写成一句给模型看的话 */
export function profilePrompt(p?: {
  grade?: string;
  gender?: string;
  traits?: string[];
  interests?: string[];
  note?: string;
}): string {
  if (!p) return "";
  const bits: string[] = [];
  if (p.grade) bits.push(p.grade);
  if (p.gender && p.gender !== "先不说") bits.push(p.gender);
  if (p.traits?.length) bits.push(`性格${p.traits.join("、")}`);
  if (p.interests?.length) bits.push(`喜欢${p.interests.join("、")}`);
  if (p.note?.trim()) bits.push(`补充：${p.note.trim()}`);
  return bits.join("，");
}

/** 有画像时追加的推荐判断要求 */
export const FIT_PROMPT = `另外，判断这本书适不适合这个孩子，并给出：
- fit：只能是「很合适」「可以试试」「不太合」三者之一。
- reason：一句话说明为什么，不超过 22 字，必须具体。比如「你喜欢动物，这本全是真实的动物故事」
  或「你喜欢搞笑，这本偏安静」。不确定就选「可以试试」，不要硬夸。
如果没有给孩子的信息，fit 和 reason 都返回空字符串。
`;
