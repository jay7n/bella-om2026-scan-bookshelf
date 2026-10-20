export type CardData = {
  /** 每张卡唯一，重复书名也不会撞 */
  key: string;
  title: string;
  /** 豆瓣书封地址（走 /api/cover 代理）。null 表示没匹配上，用程序化封面 */
  cover: string | null;
  matched: boolean;
  /** 豆瓣条目 id，详情页要用 */
  doubanId?: string;
  author?: string;
  year?: string;
  intro?: string;
  hook?: string;
  /** 读起来什么感觉：好笑 / 温暖 / 烧脑 …… */
  vibe: string[];
  similar?: string;
  tags: string[];
  grade?: string;
  /** AI 的判断：很合适 / 可以试试 / 不太合 */
  fit?: string;
  /** 为什么推荐（或为什么不推荐） */
  reason?: string;
  infoState: "loading" | "done" | "error";
  coverState: "loading" | "done" | "none";
};

export type EnrichResult = {
  intro: string;
  hook: string;
  vibe: string[];
  tags: string[];
  grade: string;
  similar: string;
  fit: string;
  reason: string;
};

export type DoubanDetail = {
  id: string;
  url: string;
  rating: string | null;
  votes: string | null;
  summary: string | null;
  publisher: string | null;
  comments: string[];
};

export type AiDetail = {
  what: string;
  why: string;
  before: string;
  bestFor: string;
};

export type DetailResponse = {
  douban: DoubanDetail | null;
  ai: AiDetail | null;
};

/* ---------------- 相册（每次拍照的一份合集） ---------------- */

export type AlbumBook = {
  key: string;
  title: string;
  cover: string | null;
  matched: boolean;
  doubanId?: string;
  author?: string;
  year?: string;
  intro?: string;
  hook?: string;
  vibe: string[];
  tags: string[];
  grade?: string;
  similar?: string;
  fit?: string;
  reason?: string;
};

export type Album = {
  id: string;
  /** 这一册叫什么（社区图书角 / 学校图书馆 / 自己写） */
  name?: string;
  /** 拍照时间 */
  at: number;
  /** 现场快照缩略图（dataURL） */
  thumb: string | null;
  books: AlbumBook[];
  /** 记下的书名 key */
  saved: string[];
};
