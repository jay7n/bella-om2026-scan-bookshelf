/**
 * 封面磁盘缓存。
 *
 * 之前只在内存里存，服务一重启就全丢，每个封面都要重新去豆瓣抓
 * （实测 3~8 秒一张）。写到 .cache/covers 之后，重启也还在。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DIR = path.join(process.cwd(), ".cache", "covers");

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

function keyFor(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 24);
}

/** 命中就返回字节和 content-type；没有就 null */
export async function readCoverFromDisk(url: string): Promise<{ body: Uint8Array; type: string } | null> {
  const key = keyFor(url);
  for (const ext of Object.keys(TYPE_BY_EXT)) {
    try {
      const body = await readFile(path.join(DIR, `${key}.${ext}`));
      return { body: new Uint8Array(body), type: TYPE_BY_EXT[ext] };
    } catch {
      /* 试下一个后缀 */
    }
  }
  return null;
}

export async function writeCoverToDisk(url: string, body: Uint8Array, type: string): Promise<void> {
  const ext = EXT_BY_TYPE[type.toLowerCase()];
  if (!ext) return;
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(path.join(DIR, `${keyFor(url)}.${ext}`), body);
  } catch {
    // 磁盘写失败不影响本次返回
  }
}
