const KEY = "bs.covers.v1";
const MAX = 80;

type Store = Record<string, string>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? (o as Store) : {};
  } catch {
    return {};
  }
}

export function getCachedCover(title: string): string | null {
  return read()[title] ?? null;
}

export function putCachedCover(title: string, dataUrl: string): void {
  const store = read();
  store[title] = dataUrl;
  const keys = Object.keys(store);
  if (keys.length > MAX) {
    for (const k of keys.slice(0, keys.length - MAX)) delete store[k];
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // 配额满：放弃缓存，下次重新画
  }
}

/** 把拿到的图片压成 448 宽的 dataURL，一张约 25~40KB */
export async function shrinkToDataUrl(blob: Blob, maxWidth = 448): Promise<string> {
  let source: CanvasImageSource;
  let width: number;
  let height: number;

  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
  } else {
    const url = URL.createObjectURL(blob);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("图片解码失败"));
      el.src = url;
    });
    source = img;
    width = img.naturalWidth;
    height = img.naturalHeight;
    URL.revokeObjectURL(url);
  }

  const scale = Math.min(1, maxWidth / width);
  const cw = Math.max(1, Math.round(width * scale));
  const ch = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 不可用");
  ctx.drawImage(source, 0, 0, cw, ch);
  if (typeof (source as ImageBitmap).close === "function") (source as ImageBitmap).close();

  return canvas.toDataURL("image/jpeg", 0.72);
}
