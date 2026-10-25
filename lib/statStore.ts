/**
 * 极简服务端埋点存储：内存计数 + 追加到 JSONL 文件。
 *
 * 不做数据库，不存个人信息，只回答三件事：
 *   哪个动作被做了多少次 / 每天多少条 / 大概多少个会话
 *
 * 文件放在 .cache/stats/events.jsonl，项目重启后能读回来。
 */

import fs from "node:fs";
import path from "node:path";

export type InEvent = {
  n: string;      // 事件名
  t?: number;     // 时间戳（毫秒），不传就用服务端时间
  s?: string;     // 会话 id
  v?: number;     // 数值
  k?: string;     // 标签
};

type Day = string; // YYYY-MM-DD

const DIR = path.join(process.cwd(), ".cache", "stats");
const FILE = path.join(DIR, "events.jsonl");
const MAX_SESSIONS = 5000;
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB 后停止追加，防止写爆磁盘

const byEvent = new Map<string, number>();
const byDay = new Map<Day, number>();
const sessions = new Set<string>();
let total = 0;
let loaded = false;
let fileBytes = 0;

function dayOf(ts: number): Day {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function apply(e: InEvent): void {
  const name = String(e.n || "").slice(0, 40);
  if (!name) return;
  const ts = Number(e.t) || Date.now();
  total += 1;
  byEvent.set(name, (byEvent.get(name) ?? 0) + 1);
  const d = dayOf(ts);
  byDay.set(d, (byDay.get(d) ?? 0) + 1);
  const s = e.s ? String(e.s).slice(0, 24) : "";
  if (s && sessions.size < MAX_SESSIONS) sessions.add(s);
}

/** 第一次用到时把历史文件读回来 */
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(FILE)) return;
    const text = fs.readFileSync(FILE, "utf8");
    fileBytes = Buffer.byteLength(text);
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        apply(JSON.parse(line) as InEvent);
      } catch {
        /* 单行坏了就跳过 */
      }
    }
  } catch {
    /* 读不到就当空的 */
  }
}

function append(e: InEvent): void {
  try {
    if (fileBytes > MAX_FILE_BYTES) return;
    fs.mkdirSync(DIR, { recursive: true });
    const line = JSON.stringify({
      n: String(e.n).slice(0, 40),
      t: Number(e.t) || Date.now(),
      s: e.s ? String(e.s).slice(0, 24) : undefined,
      v: typeof e.v === "number" ? e.v : undefined,
      k: e.k ? String(e.k).slice(0, 20) : undefined,
    });
    fs.appendFileSync(FILE, line + "\n");
    fileBytes += Buffer.byteLength(line) + 1;
  } catch {
    /* 写不进去就算了，内存里还有 */
  }
}

/** 记一批事件 */
export function record(events: InEvent[]): number {
  ensureLoaded();
  let n = 0;
  for (const e of events.slice(0, 50)) {
    if (!e || typeof e !== "object") continue;
    apply(e);
    append(e);
    n += 1;
  }
  return n;
}

/** 汇总，按次数从多到少 */
export function summary() {
  ensureLoaded();
  const events = [...byEvent.entries()]
    .map(([n, count]) => ({ n, count }))
    .sort((a, b) => b.count - a.count);

  const days = [...byDay.entries()]
    .map(([d, count]) => ({ d, count }))
    .sort((a, b) => (a.d < b.d ? 1 : -1))
    .slice(0, 14);

  return {
    total,
    sessions: sessions.size,
    events,
    days,
    since: days.length ? days[days.length - 1].d : null,
  };
}
