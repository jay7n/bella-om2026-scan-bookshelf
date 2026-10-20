import type { DetailResponse } from "./types";

const KEY = "bs.detail.v1";

/** 完整结果（豆瓣 + AI）留 7 天，评分偶尔会变，不用永久存 */
const FULL_TTL = 7 * 24 * 60 * 60 * 1000;
/** AI 那部分失败的，10 分钟后就重试，别让用户一直看到残缺页 */
const PARTIAL_TTL = 10 * 60 * 1000;

type Entry = { at: number; value: DetailResponse };
type Store = Record<string, Entry>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? (obj as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // 配额满了就放弃缓存，下次重新请求
  }
}

/** 有豆瓣 id 用它，没有就用书名+作者 */
export function detailCacheKey(id?: string, title?: string, author?: string): string {
  if (id) return `id:${id}`;
  return `t:${title ?? ""}|${author ?? ""}`;
}

export function getCachedDetail(key: string): DetailResponse | null {
  const entry = read()[key];
  if (!entry?.value) return null;
  const ttl = entry.value.ai ? FULL_TTL : PARTIAL_TTL;
  if (Date.now() - entry.at > ttl) return null;
  return entry.value;
}

export function putCachedDetail(key: string, value: DetailResponse): void {
  const store = read();
  store[key] = { at: Date.now(), value };

  const keys = Object.keys(store);
  if (keys.length > 300) {
    // 按时间丢掉最老的
    const sorted = keys.sort((a, b) => store[a].at - store[b].at);
    for (const k of sorted.slice(0, keys.length - 300)) delete store[k];
  }
  write(store);
}
