import type { Album, AlbumBook, CardData } from "./types";

const KEY = "bs.albums.v1";
const MAX_ALBUMS = 40;

function read(): Album[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Album[]) : [];
  } catch {
    return [];
  }
}

/**
 * 写入并返回最新列表。
 * localStorage 有配额，写不下时从最旧的开始丢，直到能写进去。
 */
function write(albums: Album[]): Album[] {
  let list = albums.slice(0, MAX_ALBUMS);
  for (let i = 0; i < 4; i++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return list;
    } catch {
      if (list.length <= 1) break;
      list = list.slice(0, Math.max(1, Math.floor(list.length * 0.7)));
    }
  }
  return list;
}

export function listAlbums(): Album[] {
  return read().sort((a, b) => b.at - a.at);
}

export function getAlbum(id: string): Album | null {
  return read().find((a) => a.id === id) ?? null;
}

export function latestAlbum(): Album | null {
  return listAlbums()[0] ?? null;
}

/** 同一个 id 就替换，否则插到最前面。改名不会被后续保存覆盖掉 */
export function upsertAlbum(album: Album): Album[] {
  const albums = read();
  const prev = albums.find((a) => a.id === album.id);
  const merged: Album = { ...album, name: album.name ?? prev?.name };
  const rest = albums.filter((a) => a.id !== album.id);
  return write([merged, ...rest].sort((a, b) => b.at - a.at));
}

/** 给某一册改名（传空字符串 = 清掉名字） */
export function renameAlbum(id: string, name: string): Album[] {
  const albums = read();
  const target = albums.find((a) => a.id === id);
  if (!target) return listAlbums();
  const trimmed = name.trim().slice(0, 16);
  if (trimmed) target.name = trimmed;
  else delete target.name;
  return write(albums.sort((a, b) => b.at - a.at));
}

export function deleteAlbum(id: string): Album[] {
  return write(read().filter((a) => a.id !== id));
}

/** 只改某一本有没有被记下（历史页里点开书时用） */
export function toggleAlbumSaved(albumId: string, bookKey: string): Album[] {
  const albums = read();
  const target = albums.find((a) => a.id === albumId);
  if (!target) return listAlbums();
  target.saved = target.saved.includes(bookKey)
    ? target.saved.filter((k) => k !== bookKey)
    : [...target.saved, bookKey];
  return write(albums);
}

export function newAlbumId(): string {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/* ---------------- 转换 ---------------- */

export function toAlbumBook(card: CardData): AlbumBook {
  return {
    key: card.key,
    title: card.title,
    cover: card.cover,
    matched: card.matched,
    doubanId: card.doubanId,
    author: card.author,
    year: card.year,
    intro: card.intro,
    hook: card.hook,
    vibe: card.vibe,
    tags: card.tags,
    grade: card.grade,
    similar: card.similar,
    fit: card.fit,
    reason: card.reason,
  };
}

/** 历史里的书 → 卡片，交给详情页复用 */
export function albumBookToCard(book: AlbumBook): CardData {
  return {
    ...book,
    infoState: book.intro ? "done" : "error",
    coverState: book.cover ? "done" : "none",
  };
}

/* ---------------- 展示用 ---------------- */

export function formatWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return sameYear ? `${md} ${hm}` : `${d.getFullYear()}年${md}`;
}

/**
 * 一次性迁移：早期版本只存了「上一次的书架」，没有相册列表。
 * 如果相册还空着，就把那份旧数据补成一册，别让用户以为丢了。
 */
export function migrateLegacySession(): void {
  try {
    if (localStorage.getItem(KEY)) return;
    const raw = localStorage.getItem("bs.session.v2");
    if (!raw) return;
    const old = JSON.parse(raw) as { at?: number; thumb?: string | null; cards?: CardData[]; saved?: string[] };
    if (!old?.cards || old.cards.length === 0) return;
    upsertAlbum({
      id: newAlbumId(),
      at: old.at ?? Date.now(),
      thumb: old.thumb ?? null,
      books: old.cards.map(toAlbumBook),
      saved: old.saved ?? [],
    });
    localStorage.removeItem("bs.session.v2");
  } catch {
    /* 迁移失败就算了，不影响新数据 */
  }
}
