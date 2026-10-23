/**
 * 极简埋点：全部存在本机（localStorage），不发任何网络请求。
 *
 * 用途：看自己/家人怎么用这个应用 —— 扫了几次、滑了几张、在哪个环节离开。
 * 限制：数据只在这台设备上，看不到其他用户。要做汇总得接第三方（见 README）。
 *
 * 设计原则：
 * - 任何一步失败都静默，绝不因为埋点把主流程搞崩
 * - 环形缓冲，最多留 500 条，不会把 localStorage 撑爆
 * - 只记动作，不记内容（不存书名、不存照片）
 */

const KEY = "bs.stats.v1";
const MAX = 500;

export type StatEvent = {
  /** 事件名，如 scan_start */
  n: string;
  /** 时间戳（毫秒） */
  t: number;
  /** 会话 id，一次打开页面算一个会话 */
  s: string;
  /** 附加数值，如识别出的本数 */
  v?: number;
  /** 附加标签，如卡片来源 */
  k?: string;
};

type Store = {
  session: string;
  first: number;
  events: StatEvent[];
};

function newSession(): string {
  return Math.random().toString(36).slice(2, 8);
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Store;
      if (s && Array.isArray(s.events)) {
        return { session: s.session || newSession(), first: s.first || Date.now(), events: s.events };
      }
    }
  } catch {
    /* ignore */
  }
  return { session: newSession(), first: Date.now(), events: [] };
}

function save(s: Store): void {
  try {
    // 只保留最近 MAX 条
    if (s.events.length > MAX) s.events = s.events.slice(-MAX);
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 配额满了就放弃，不影响主流程 */
  }
}

/** 记一个事件。参数错了也不会抛。 */
export function track(name: string, opts?: { v?: number; k?: string }): void {
  if (typeof window === "undefined") return;
  try {
    const s = load();
    s.events.push({ n: name, t: Date.now(), s: s.session, v: opts?.v, k: opts?.k });
    save(s);
  } catch {
    /* ignore */
  }
}

/** 读取全部记录 */
export function readStats(): Store {
  return load();
}

/** 按事件名汇总次数 */
export function summarize(events: StatEvent[]): Array<{ n: string; count: number; last: number }> {
  const map = new Map<string, { n: string; count: number; last: number }>();
  for (const e of events) {
    const hit = map.get(e.n);
    if (hit) {
      hit.count += 1;
      hit.last = Math.max(hit.last, e.t);
    } else {
      map.set(e.n, { n: e.n, count: 1, last: e.t });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** 导出成 JSON 文本，方便复制或下载 */
export function exportJSON(): string {
  const s = load();
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      session: s.session,
      firstSeen: new Date(s.first).toISOString(),
      total: s.events.length,
      summary: summarize(s.events),
      events: s.events,
    },
    null,
    2,
  );
}

/** 清空 */
export function clearStats(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** 从页面装载那一刻自动记一条 open */
export function trackOpen(): void {
  track("app_open");
}
