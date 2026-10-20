import type { EnrichResult } from "./types";

const ENRICH_KEY = "bs.enrich.v2";

type EnrichMap = Record<string, EnrichResult>;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式或配额满了，静默失败，不影响主流程
  }
}

/** 同一本书的文案只调一次模型 */
export function getCachedEnrich(title: string): EnrichResult | null {
  const map = read<EnrichMap>(ENRICH_KEY);
  return map?.[title] ?? null;
}

export function putCachedEnrich(title: string, value: EnrichResult): void {
  const map = read<EnrichMap>(ENRICH_KEY) ?? {};
  map[title] = value;
  const keys = Object.keys(map);
  if (keys.length > 200) {
    for (const k of keys.slice(0, keys.length - 200)) delete map[k];
  }
  write(ENRICH_KEY, map);
}
