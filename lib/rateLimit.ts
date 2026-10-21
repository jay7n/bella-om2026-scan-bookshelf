/**
 * 极简限流：内存滑动窗口，按 IP + 接口分桶。
 *
 * 这个应用是公网可访问的，而 /api/scan 和 /api/cover-gen 会调用付费接口。
 * 没有限流的话，任何人拿到地址都能把额度刷光。
 *
 * 单实例内存足够用（Devbox 只有一个进程），不需要 Redis。
 */

const buckets = new Map<string, number[]>();
const MAX_KEYS = 4000;

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "local";
}

/**
 * 超过限制时返回一个 429 Response，否则返回 null 表示放行。
 *
 * @param name   接口名，用来分桶
 * @param limit  窗口内允许的次数
 * @param windowMs 窗口长度，默认 1 分钟
 */
export function rateLimit(
  req: Request,
  name: string,
  limit: number,
  windowMs = 60_000,
): Response | null {
  const key = `${name}:${clientIp(req)}`;
  const now = Date.now();

  let times = buckets.get(key);
  if (!times) {
    // 防止被大量不同 IP 打爆内存
    if (buckets.size > MAX_KEYS) buckets.clear();
    times = [];
    buckets.set(key, times);
  }

  while (times.length > 0 && now - times[0] > windowMs) times.shift();

  if (times.length >= limit) {
    return new Response(
      JSON.stringify({ ok: false, error: "请求太频繁了，等一分钟再试" }),
      {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "60" },
      },
    );
  }

  times.push(now);
  return null;
}
