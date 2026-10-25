import { record, summary, type InEvent } from "@/lib/statStore";
import { rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/stat   收集事件
 *   body: { events: [{ n, t, s, v, k }] }  或 单个 { n, ... }
 *
 * GET  /api/stat   返回汇总（只有次数，没有个人信息）
 *   如果配置了 STATS_KEY，需要带 ?key=
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "stat", 240, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const list: InEvent[] = Array.isArray((body as { events?: unknown })?.events)
    ? ((body as { events: InEvent[] }).events as InEvent[])
    : body && typeof body === "object"
      ? [body as InEvent]
      : [];

  const n = record(list);
  return Response.json({ ok: true, recorded: n });
}

export async function GET(req: Request) {
  const key = process.env.STATS_KEY;
  if (key) {
    const given = new URL(req.url).searchParams.get("key");
    if (given !== key) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
  }
  return Response.json({ ok: true, ...summary() });
}
