"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import BookCard from "./BookCard";
import BookDetail from "./BookDetail";
import AlbumShelf from "./AlbumShelf";
import HistoryList from "./HistoryList";
import ProfileSheet from "./ProfileSheet";
import { getCachedEnrich, putCachedEnrich } from "@/lib/clientCache";
import { getCachedCover, putCachedCover, shrinkToDataUrl } from "@/lib/coverCache";
import {
  albumBookToCard,
  deleteAlbum,
  listAlbums,
  migrateLegacySession,
  newAlbumId,
  renameAlbum,
  toAlbumBook,
  toggleAlbumSaved,
  upsertAlbum,
} from "@/lib/albums";
import type { Album, CardData, EnrichResult } from "@/lib/types";
import {
  EMPTY_PROFILE,
  clearProfile,
  hasProfile,
  loadProfile,
  profileSummary,
  saveProfile,
  type Profile,
} from "@/lib/profile";

type Phase = "welcome" | "scanning" | "deck";
type Drag = { x: number; y: number; active: boolean; leaving: boolean };

const IDLE_DRAG: Drag = { x: 0, y: 0, active: false, leaving: false };
const SWIPE_THRESHOLD = 84;
const TAP_SLOP = 9;
const AUTOPLAY_MS = 5200;
/** 一次扫描最多给几本自动画封面（控制时间和花费） */
const MAX_GEN_PER_SCAN = 4;

/** 简易并发闸门：避免一下子打 20 个请求把豆瓣或模型接口打爆 */
function createLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      const next = waiting.shift();
      if (next) next();
    }
  };
}

const coverLimit = createLimiter(6);
const infoLimit = createLimiter(6);

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片解码失败"));
    img.src = src;
  });
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

/** 优先 createImageBitmap（快），失败退回 <img> 解码（HEIC 等格式） */
async function decodeImage(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      /* 掉到 <img> 方案 */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/** 上传前压到长边 1536、JPEG 0.72 —— 大约 150~250KB */
async function compressImage(file: File): Promise<{ blob: Blob; preview: string; thumb: string }> {
  const MAX_EDGE = 1536;
  const QUALITY = 0.72;

  const decoded = await decodeImage(file);
  const { source, width, height } = decoded;

  try {
    if (!width || !height) throw new Error("图片尺寸为 0");

    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const cw = Math.max(1, Math.round(width * scale));
    const ch = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器不支持 canvas");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, cw, ch);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("压缩失败"))), "image/jpeg", QUALITY);
    });

    // 再压一张很小的缩略图存进 localStorage，用于「继续上次的书架」
    const thumbCanvas = document.createElement("canvas");
    const ts = Math.min(1, 320 / Math.max(cw, ch));
    thumbCanvas.width = Math.max(1, Math.round(cw * ts));
    thumbCanvas.height = Math.max(1, Math.round(ch * ts));
    thumbCanvas.getContext("2d")?.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const thumb = thumbCanvas.toDataURL("image/jpeg", 0.55);

    return { blob, preview: URL.createObjectURL(blob), thumb };
  } finally {
    decoded.release();
  }
}

function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label}超时`)), ms);
    task.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export default function ShelfScanner() {
  const [phase, setPhase] = useState<Phase>("welcome");
  const [cards, setCards] = useState<CardData[]>([]);
  const [index, setIndex] = useState(0);
  const [saved, setSaved] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [foundCount, setFoundCount] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [ready, setReady] = useState<{ ok: boolean; message?: string | null } | null>(null);
  const [drag, setDrag] = useState<Drag>(IDLE_DRAG);
  const [auto, setAuto] = useState(false);
  const [detailCard, setDetailCard] = useState<CardData | null>(null);
  /** 详情页是从某一册历史里打开的（而不是当前这次） */
  const [detailAlbumId, setDetailAlbumId] = useState<string | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [screen, setScreen] = useState<"main" | "history" | "album">("main");
  const [openAlbumId, setOpenAlbumId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  /** 只看 AI 推荐的书 */
  const [onlyRecommended, setOnlyRecommended] = useState(false);
  /** 卡片飞出的时长：手指滑 260ms，点按钮 420ms */
  const [flyMs, setFlyMs] = useState(260);
  /** 相册是从闪卡页进的，还是从历史进的（决定返回去哪儿） */
  const [albumFrom, setAlbumFrom] = useState<"deck" | "history">("history");
  /** title -> 生成的封面 dataURL */
  const [genCovers, setGenCovers] = useState<Record<string, string>>({});
  const [genLoading, setGenLoading] = useState<Record<string, boolean>>({});
  const [genFailed, setGenFailed] = useState<Record<string, boolean>>({});
  /** 上一本时，从左侧滑回来的那张卡（盖在当前卡上面） */
  const [entering, setEntering] = useState<CardData | null>(null);

  const pointerStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const dxRef = useRef(0);
  const dyRef = useRef(0);
  const movedRef = useRef(false);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const scanSeq = useRef(0);
  const previewRef = useRef<string | null>(null);
  const thumbRef = useRef<string | null>(null);
  const flyingRef = useRef(false);
  const albumIdRef = useRef<string | null>(null);
  const albumAtRef = useRef<number>(0);
  const savedRef = useRef<string[]>([]);
  const genPending = useRef<Set<string>>(new Set());
  const coverPending = useRef<Set<string>>(new Set());
  const genCount = useRef(0);
  const indexRef = useRef(0);
  const lenRef = useRef(0);
  const cardsRef = useRef<CardData[]>([]);

  // 开了「只看推荐」就只在推荐的书里翻
  const viewCards = onlyRecommended
    ? cards.filter((c) => c.fit === "很合适" || c.fit === "可以试试")
    : cards;

  indexRef.current = index;
  lenRef.current = viewCards.length;
  cardsRef.current = cards;
  savedRef.current = saved;

  // 进页面：问后端 key 配好没 + 看看上次有没有没看完的书架
  useEffect(() => {
    let cancelled = false;
    fetch("/api/scan")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setReady({ ok: !!d.ok, message: d.message ?? null });
      })
      .catch(() => {
        if (!cancelled) setReady({ ok: false, message: "连不上本地服务，先确认 npm run dev 还在跑" });
      });
    migrateLegacySession();
    setAlbums(listAlbums());
    setProfile(loadProfile());
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = useCallback((key: string, partial: Partial<CardData>) => {
    setCards((prev) => prev.map((c) => (c.key === key ? { ...c, ...partial } : c)));
  }, []);

  /** 立刻把当前这次写进历史（不走防抖） */
  const flushAlbum = useCallback(() => {
    const id = albumIdRef.current;
    const books = cardsRef.current;
    if (!id || books.length === 0) return;
    setAlbums(
      upsertAlbum({
        id,
        at: albumAtRef.current || Date.now(),
        thumb: thumbRef.current,
        books: books.map(toAlbumBook),
        saved: savedRef.current,
      }),
    );
  }, []);

  /** 豆瓣封面只在第一次下载，之后都读本地 dataURL */
  const cacheRemoteCover = useCallback(async (title: string, url: string) => {
    if (getCachedCover(title) || coverPending.current.has(title)) return;
    coverPending.current.add(title);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      if (!res.ok) return;
      const blob = await res.blob();
      const dataUrl = await shrinkToDataUrl(blob, 280);
      putCachedCover(title, dataUrl);
      setGenCovers((prev) => ({ ...prev, [title]: dataUrl }));
    } catch {
      // 抓不到就继续用 URL 显示，不影响
    } finally {
      coverPending.current.delete(title);
    }
  }, []);

  /** 给豆瓣没有封面的书现画一张 */
  const generateCover = useCallback(
    async (
      title: string,
      ctx: { intro?: string; vibe?: string[]; tags?: string[]; grade?: string } = {},
    ) => {
      if (genPending.current.has(title)) return;

      // 已经画过：直接拿出来显示，不要静默什么都不做
      const cached = getCachedCover(title);
      if (cached) {
        setGenCovers((prev) => (prev[title] === cached ? prev : { ...prev, [title]: cached }));
        return;
      }

      genPending.current.add(title);
      setGenLoading((prev) => ({ ...prev, [title]: true }));
      setGenFailed((prev) => {
        if (!prev[title]) return prev;
        const next = { ...prev };
        delete next[title];
        return next;
      });

      try {
        const params = new URLSearchParams({ title });
        if (ctx.intro) params.set("intro", ctx.intro.slice(0, 70));
        if (ctx.vibe?.length) params.set("vibe", ctx.vibe.slice(0, 3).join("|"));
        if (ctx.tags?.length) params.set("tags", ctx.tags.slice(0, 3).join("|"));
        if (ctx.grade) params.set("grade", ctx.grade);

        const res = await fetch(`/api/cover-gen?${params.toString()}`, {
            signal: AbortSignal.timeout(90_000),
          });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const blob = await res.blob();
        const dataUrl = await shrinkToDataUrl(blob, 448);
        putCachedCover(title, dataUrl);
        setGenCovers((prev) => ({ ...prev, [title]: dataUrl }));
      } catch {
        // 失败要让用户看见，否则就是"点了没反应"
        setGenFailed((prev) => ({ ...prev, [title]: true }));
      } finally {
        genPending.current.delete(title);
        setGenLoading((prev) => {
          const next = { ...prev };
          delete next[title];
          return next;
        });
      }
    },
    [],
  );

  const loadCover = useCallback(
    async (key: string, title: string) => {
      await coverLimit(async () => {
        try {
          const res = await fetch(`/api/search?title=${encodeURIComponent(title)}`, {
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) throw new Error(String(res.status));
          const data = await res.json();
          patch(key, {
            cover: data.matched ? data.cover : null,
            matched: !!data.matched,
            doubanId: data.matched ? data.id : undefined,
            author: data.author,
            year: data.year,
            coverState: data.matched ? "done" : "none",
          });
          // 顺手把封面抓到本地，下次连请求都不用发
          if (data.matched && data.cover) void cacheRemoteCover(title, data.cover);
        } catch {
          patch(key, { coverState: "none", matched: false });
        }
      });
    },
    [patch, cacheRemoteCover],
  );

  const loadInfo = useCallback(
    async (key: string, title: string) => {
      // 换了画像，之前那份文案就作废了（推荐理由不一样）
      const profileKey = profile
        ? [profile.grade, profile.gender, profile.traits.join(""), profile.interests.join(""), profile.note]
            .filter(Boolean)
            .join("-")
        : "none";
      const cacheKey = `${profileKey}::${title}`;

      const cached = getCachedEnrich(cacheKey);
      if (cached) {
        patch(key, { ...cached, infoState: "done" });
        return;
      }

      await infoLimit(async () => {
        try {
          const params = new URLSearchParams({ title });
          if (profile?.grade) params.set("grade", profile.grade);
          if (profile?.gender) params.set("gender", profile.gender);
          if (profile?.traits.length) params.set("traits", profile.traits.join("|"));
          if (profile?.interests.length) params.set("interests", profile.interests.join("|"));
          if (profile?.note) params.set("note", profile.note);

          const res = await fetch(`/api/enrich?${params.toString()}`, {
            signal: AbortSignal.timeout(25_000),
          });
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as EnrichResult;
          const value: EnrichResult = {
            intro: data.intro ?? "",
            hook: data.hook ?? "",
            vibe: Array.isArray(data.vibe) ? data.vibe : [],
            tags: Array.isArray(data.tags) ? data.tags : [],
            grade: data.grade ?? "",
            similar: data.similar ?? "",
            fit: data.fit ?? "",
            reason: data.reason ?? "",
          };
          putCachedEnrich(cacheKey, value);
          patch(key, { ...value, infoState: "done" });
        } catch {
          patch(key, { infoState: "error" });
        }
      });
    },
    [patch, profile],
  );

  const addCard = useCallback(
    (title: string) => {
      const key = `${title}#${Math.random().toString(36).slice(2, 9)}`;
      setCards((prev) => {
        if (prev.some((c) => c.title === title)) return prev;
        return [
          ...prev,
          {
            key,
            title,
            cover: null,
            matched: false,
            tags: [],
            vibe: [],
            infoState: "loading" as const,
            coverState: "loading" as const,
          },
        ];
      });
      // 两条线并行：查封面（1~2s）+ 写简介（1~3s），谁先回谁先填
      void loadCover(key, title);
      void loadInfo(key, title);
    },
    [loadCover, loadInfo],
  );

  const startScan = useCallback(
    async (file: File) => {
      if (busyRef.current) return;
      busyRef.current = true;

      const myId = scanSeq.current + 1;
      scanSeq.current = myId;
      const alive = () => scanSeq.current === myId;

      setError(null);
      setCards([]);
      setIndex(0);
      setSaved([]);
      setFoundCount(0);
      setPhase("scanning");
      setStreaming(true);
      setAuto(false);
      setDetailCard(null);
      setDetailAlbumId(null);
      genCount.current = 0;
      albumIdRef.current = newAlbumId();
      albumAtRef.current = Date.now();

      let blob: Blob;
      try {
        const out = await withTimeout(compressImage(file), 10000, "压缩");
        blob = out.blob;
        if (!alive()) return;
        if (previewRef.current) URL.revokeObjectURL(previewRef.current);
        previewRef.current = out.preview;
        thumbRef.current = out.thumb;
        setPreview(out.preview);
      } catch {
        if (!alive()) return;
        // 本地压缩只是优化项，不是必需项 —— 失败就原图直传
        if (file.size > 8 * 1024 * 1024) {
          setError("这张照片太大了（超过 8MB），换一张，或者先在相册里裁小一点");
          setPhase("welcome");
          setStreaming(false);
          busyRef.current = false;
          return;
        }
        blob = file;
        thumbRef.current = null;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      // 整体兜底：90 秒还没结束就中断，避免一直卡在"正在识别"
      const scanTimeout = window.setTimeout(() => controller.abort(), 90_000);

      let res: Response;
      try {
        res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": blob.type || "image/jpeg" },
          body: blob,
          signal: controller.signal,
        });
      } catch {
        if (!alive()) return;
        setStreaming(false);
        busyRef.current = false;
        if (controller.signal.aborted) return;
        setError("连不上本地服务，确认 npm run dev 还在跑");
        setPhase("welcome");
        return;
      }

      if (!alive()) return;

      if (!res.ok || !res.body) {
        let message = `识别失败（${res.status}）`;
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {
          /* ignore */
        }
        if (!alive()) return;
        setError(message);
        setPhase("welcome");
        setStreaming(false);
        busyRef.current = false;
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let found = 0;
      let failure: string | null = null;

      try {
        while (true) {
          if (!alive()) {
            reader.cancel().catch(() => {});
            return;
          }
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            let event: { type?: string; t?: string; message?: string };
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }
            if (event.type === "title" && event.t) {
              found += 1;
              setFoundCount(found);
              addCard(event.t);
            } else if (event.type === "error") {
              failure = event.message || "识别出错了";
            }
          }
        }
      } catch {
        if (!controller.signal.aborted) {
          failure = "读取识别结果时断开了，请重试";
        }
      }

      window.clearTimeout(scanTimeout);

      if (!alive()) return;

      setStreaming(false);
      busyRef.current = false;
      abortRef.current = null;

      if (controller.signal.aborted) return;

      if (found > 0) flushAlbum();

      if (failure) setError(failure);
      if (found === 0) {
        setError(failure || "这张照片里一本都没认出来。试试：正对书架、光线亮一点、别开闪光灯、只拍一排。");
        setPhase("welcome");
      }
    },
    [addCard, flushAlbum],
  );

  // 识别完 + 有卡片 → 自动进入速览
  useEffect(() => {
    if (phase !== "scanning" || streaming || cards.length === 0) return;
    const timer = window.setTimeout(() => setPhase("deck"), 700);
    return () => window.clearTimeout(timer);
  }, [phase, streaming, cards.length]);

  // 画像一改，之前那些推荐理由就作废了，重算一遍
  useEffect(() => {
    if (!profile) return;
    if (phase !== "deck" && phase !== "scanning") return;
    for (const c of cardsRef.current) {
      if (c.infoState !== "loading") void loadInfo(c.key, c.title);
    }
    // 只在画像变化时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  // 切到「只看推荐」时，索引可能越界
  useEffect(() => {
    if (index > 0 && index > viewCards.length - 1) {
      setIndex(Math.max(0, viewCards.length - 1));
    }
  }, [index, viewCards.length]);

  // 本地已经画过的封面，挂载/续看时先读回来，别让卡片显示"未画"
  useEffect(() => {
    if (cards.length === 0) return;
    setGenCovers((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const c of cards) {
        if (next[c.title]) continue;
        const cached = getCachedCover(c.title);
        if (cached) {
          next[c.title] = cached;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [cards]);

  // 豆瓣没封面的书，认完以后自动补画，一次最多 4 本，串行跑
  useEffect(() => {
    if (phase !== "deck" || streaming) return;
    const missing = cards.filter(
      (c) => c.coverState === "none" && !getCachedCover(c.title) && !genPending.current.has(c.title),
    );
    const room = Math.max(0, MAX_GEN_PER_SCAN - genCount.current);
    for (const c of missing.slice(0, room)) {
      genCount.current += 1;
      void generateCover(c.title, { intro: c.intro, vibe: c.vibe, tags: c.tags, grade: c.grade });
    }
  }, [phase, streaming, cards, generateCover]);

  // 一进速览页就先存一次，保证「历史」里马上能看到这一册
  useEffect(() => {
    if (phase === "deck") flushAlbum();
  }, [phase, flushAlbum]);

  // 存到本地：下次打开能接着看
  useEffect(() => {
    if (phase === "welcome" || cards.length === 0) return;
    const id = albumIdRef.current;
    if (!id) return;
    const timer = window.setTimeout(() => {
      setAlbums(
        upsertAlbum({
          id,
          at: albumAtRef.current || Date.now(),
          thumb: thumbRef.current,
          books: cards.map(toAlbumBook),
          saved,
        }),
      );
    }, 900);
    return () => window.clearTimeout(timer);
  }, [cards, saved, phase]);

  const current = viewCards[index];
  const openAlbum = openAlbumId ? albums.find((a) => a.id === openAlbumId) ?? null : null;
  const detailIsLive = detailAlbumId === null || detailAlbumId === albumIdRef.current;
  const detailSaved = !detailCard
    ? false
    : detailIsLive
      ? saved.includes(detailCard.key)
      : (albums.find((a) => a.id === detailAlbumId)?.saved.includes(detailCard.key) ?? false);
  const savedCards = saved.map((k) => cards.find((c) => c.key === k)).filter((c): c is CardData => Boolean(c));

  /**
   * delta = +1 下一本
   * delta = -1 上一本
   *
   * 两个方向不能用同一套动画：
   *  - 下一本：当前卡向左飞走，露出底下那张（底下刚好就是下一本）—— 天然正确。
   *  - 上一本：如果也用「飞走露出底下」，露出来的是下一本，会闪一下错的卡。
   *    所以上一本改成「把上一张从左边滑回来、盖在当前卡上面」，
   *    正好是刚才那次向左飞走的倒放。
   */
  const go = useCallback((delta: 1 | -1, slow = false) => {
    if (flyingRef.current) return;
    const target = indexRef.current + delta;
    if (target < 0 || target > lenRef.current - 1) return;

    flyingRef.current = true;

    // 手指滑出去时卡片已经跟手走了一段，260ms 看着刚好；
    // 点按钮是从静止直接飞出整张卡，同样的时长会"嗖"一下太快。
    const ms = slow ? 420 : 260;
    setFlyMs(ms);

    if (delta > 0) {
      setDrag({ x: -660, y: 0, active: false, leaving: true });
      window.setTimeout(() => {
        setIndex(target);
        dxRef.current = 0;
        dyRef.current = 0;
        setDrag(IDLE_DRAG);
        flyingRef.current = false;
      }, ms);
    } else {
      const previous = cardsRef.current[target] ?? null;
      setEntering(previous);
      window.setTimeout(() => {
        setIndex(target);
        setEntering(null);
        dxRef.current = 0;
        dyRef.current = 0;
        setDrag(IDLE_DRAG);
        flyingRef.current = false;
      }, ms + 40);
    }
  }, []);

  const userGo = useCallback(
    (delta: 1 | -1) => {
      if (auto) setAuto(false); // 手动介入就停掉轮播
      go(delta, true);
    },
    [auto, go],
  );

  // 自动轮播
  useEffect(() => {
    if (!auto || phase !== "deck" || detailCard || sheetOpen) return;
    if (index >= viewCards.length - 1) return;
    const timer = window.setTimeout(() => go(1, true), AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [auto, phase, detailCard, sheetOpen, index, viewCards.length, go]);

  const onPointerCancel = () => {
    pointerStart.current = null;
    setDrag(IDLE_DRAG);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.leaving || !current || detailCard) return;

    // 手指落在按钮/链接上时，交给按钮自己处理，
    // 否则「轻点卡片开详情」会把按钮的点击一起吃掉
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, a, input, label, [role='button']")) {
      pointerStart.current = null;
      return;
    }

    pointerStart.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    dxRef.current = 0;
    dyRef.current = 0;
    movedRef.current = false;
    setDrag({ x: 0, y: 0, active: true, leaving: false });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointerStart.current || drag.leaving) return;
    const dx = e.clientX - pointerStart.current.x;
    const dy = e.clientY - pointerStart.current.y;
    if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) movedRef.current = true;
    dxRef.current = dx;
    dyRef.current = dy * 0.2;
    setDrag({ x: dx, y: dy * 0.2, active: true, leaving: false });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointerStart.current) return;
    const startedAt = pointerStart.current.t;
    pointerStart.current = null;

    const elapsed = Date.now() - startedAt;

    // 轻点：按落点在左 / 中 / 右分成"上一本 / 详情 / 下一本"
    if (!movedRef.current && elapsed < 400) {
      setDrag(IDLE_DRAG);
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);

      if (ratio < 0.3) {
        if (auto) setAuto(false);
        go(-1);
        return;
      }
      if (ratio > 0.7) {
        if (auto) setAuto(false);
        go(1);
        return;
      }
      if (current) {
        setDetailCard(current);
        setDetailAlbumId(null);
      }
      return;
    }

    if (auto) setAuto(false);

    if (dxRef.current < -SWIPE_THRESHOLD) {
      go(1);
    } else if (dxRef.current > SWIPE_THRESHOLD) {
      go(-1);
    } else {
      setDrag(IDLE_DRAG);
    }
  };

  const toggleSave = useCallback((key: string) => {
    setSaved((prev) => (prev.includes(key) ? prev : [...prev, key]));
  }, []);

  const toggleDetailSaved = () => {
    if (!detailCard) return;
    if (detailIsLive) {
      toggleSave(detailCard.key);
    } else if (detailAlbumId) {
      setAlbums(toggleAlbumSaved(detailAlbumId, detailCard.key));
    }
  };

  const reset = () => {
    flushAlbum();
    scanSeq.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    busyRef.current = false;
    flyingRef.current = false;
    setPhase("welcome");
    setCards([]);
    setIndex(0);
    setSaved([]);
    setPreview(null);
    setFoundCount(0);
    setError(null);
    setDrag(IDLE_DRAG);
    setAuto(false);
    setDetailCard(null);
    setDetailAlbumId(null);
    // 注意：不清 localStorage —— 用户可能只是想重拍，上次的还在
    albumIdRef.current = null;
    setAlbums(listAlbums());
  };

  const resumeLatest = () => {
    const album = albums[0];
    if (!album) return;
    const restored = album.books.map(albumBookToCard);
    setCards(restored);
    setSaved(album.saved ?? []);
    setIndex(0);
    setFoundCount(restored.length);
    setError(null);
    setPhase("deck");
    setAuto(false);
    setDetailCard(null);
    setDetailAlbumId(null);
    albumIdRef.current = album.id;
    albumAtRef.current = album.at;
    thumbRef.current = album.thumb;
    if (album.thumb) setPreview(album.thumb);
    // 上次没生成完的，接着补
    for (const c of restored) {
      if (c.infoState !== "done") void loadInfo(c.key, c.title);
      if (c.coverState !== "done") void loadCover(c.key, c.title);
    }
  };

  /** 从书架直接进闪卡，把这一册的书重新排成卡片 */
  const playAlbum = (album: Album) => {
    const restored = album.books.map(albumBookToCard);
    if (restored.length === 0) return;

    setCards(restored);
    setSaved(album.saved ?? []);
    setIndex(0);
    setFoundCount(restored.length);
    setError(null);
    setPhase("deck");
    setScreen("main");
    setAuto(false);
    setOnlyRecommended(false);
    setDetailCard(null);
    setDetailAlbumId(null);

    // 之后在闪卡里点收藏，写回的就是这一册
    albumIdRef.current = album.id;
    albumAtRef.current = album.at;
    thumbRef.current = album.thumb;
    if (album.thumb) setPreview(album.thumb);
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void startScan(file);
  };

  const topCardStyle: CSSProperties = {
    transform: `translate3d(${drag.x}px, ${drag.y}px, 0) rotate(${drag.x / 26}deg)`,
    transition: drag.active
      ? "none"
      : `transform ${flyMs}ms cubic-bezier(.22,.61,.36,1), opacity ${flyMs}ms ease`,
    opacity: drag.leaving ? 0 : 1,
  };

  return (
    <>
      {/* 书架照片打底，只做氛围，不抢主题色 */}
      <div className="bg-photo" aria-hidden />

      <main className="app">
      {/*
        文件选择框不用 hidden / display:none —— iOS Safari 会拒绝打开。
        改成 <label for> 原生触发，不依赖 JS 的 .click()。
      */}
      <input id="pick-camera" className="sr-file" type="file" accept="image/*" capture="environment" onChange={onPickFile} />
      <input id="pick-gallery" className="sr-file" type="file" accept="image/*" onChange={onPickFile} />

      {screen !== "main" ? (
        screen === "history" ? (
          <HistoryList
            albums={albums}
            onBack={() => setScreen("main")}
            onOpen={(id) => {
              setAlbumFrom("history");
              setOpenAlbumId(id);
              setScreen("album");
            }}
          />
        ) : openAlbum ? (
          <AlbumShelf
            album={openAlbum}
            onBack={() => setScreen(albumFrom === "deck" ? "main" : "history")}
            onOpenBook={(book) => {
              setDetailCard(albumBookToCard(book));
              setDetailAlbumId(openAlbum.id);
            }}
            onDelete={() => {
              setAlbums(deleteAlbum(openAlbum.id));
              setOpenAlbumId(null);
              setScreen("history");
            }}
            onRename={(name) => setAlbums(renameAlbum(openAlbum.id, name))}
            onPlay={() => playAlbum(openAlbum)}
          />
        ) : null
      ) : (
        <>
      <header className="topbar">
        {phase !== "welcome" ? (
          <button className="icon-btn" type="button" onClick={reset} aria-label="回到首页">
            ‹ 首页
          </button>
        ) : (
          <span />
        )}
        <div className="topbar-actions">
          <button
            className="icon-btn"
            onClick={() => {
              flushAlbum();
              setAlbums(listAlbums());
              setScreen("history");
            }}
            type="button"
          >
            历史
            <span className="count muted">{albums.length}</span>
          </button>
          <button className="icon-btn" onClick={() => setSheetOpen(true)} type="button">
            收藏
            <span className="count">{savedCards.length}</span>
          </button>
        </div>
      </header>

      {/* ---------------- 欢迎页 ---------------- */}
      {phase === "welcome" && (
        <section className="welcome">
          <div className="welcome-inner">
            <span className="welcome-eyebrow">社区图书角 · 挑书小助手</span>

            <h1 className="welcome-title">扫书</h1>

            <p className="welcome-brand">AI 书架速览器</p>

            <p className="welcome-tagline">
              拍下这排书，<em>滑着看</em>该借哪本
            </p>

            <p className="lead">
              不用打字搜，也不用一本本抽出来看。拍一张照片，AI 会把书脊上的书名全认出来，再把每本书
              <b> 讲什么、读起来什么感觉 </b>说给你听。
            </p>

            {error && <div className="banner">{error}</div>}

            {ready && !ready.ok && (
              <div className="banner">
                {ready.message ?? "后端还没准备好"} <code>bookshelf-scanner/.env.local</code>
              </div>
            )}

            {albums.length > 0 && (
              <button className="resume-card" type="button" onClick={resumeLatest}>
                <span
                  className="resume-thumb"
                  style={albums[0].thumb ? { backgroundImage: `url(${albums[0].thumb})` } : undefined}
                />
                <span className="resume-text">
                  <b>继续上次的书架</b>
                  <span>
                    {albums[0].books.length} 本书 · 收藏 {albums[0].saved.length} 本
                  </span>
                </span>
                <span className="resume-arrow">›</span>
              </button>
            )}

            <label className="cta" htmlFor="pick-camera">
              <span className="cta-icon">📷</span>
              拍下这排书
            </label>

            <div className="cta-sub">
              <label className="linkish" htmlFor="pick-gallery">
                从相册里选一张
              </label>
            </div>

            <button
              className={`profile-card ${hasProfile(profile) ? "filled" : ""}`}
              type="button"
              onClick={() => setProfileOpen(true)}
            >
              <span className="profile-bar" aria-hidden />
              <span className="profile-text">
                <b>{hasProfile(profile) ? profileSummary(profile) : "告诉我你是谁"}</b>
                <span>{hasProfile(profile) ? "点这里改" : "填一下年级和喜好，推荐会更合你口味"}</span>
              </span>
              <span className="resume-arrow">›</span>
            </button>

            <div className="hints">
              <div className="hint">
                <span className="hint-num">01</span>
                <span>
                  <b>正对书架、光线足</b>，别开闪光灯，只拍一排，认出来的书名最多。
                </span>
              </div>
              <div className="hint">
                <span className="hint-num">02</span>
                <span>
                  认完之后变成<b>卡片</b>：左右滑翻书，点卡片左右两边也能翻，点中间看详情。
                </span>
              </div>
              <div className="hint">
                <span className="hint-num">03</span>
                <span>照片只在识别时用一次，存在你自己的手机里，不往外传。</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ---------------- 识别中 ---------------- */}
      {phase === "scanning" && (
        <section className="scanning">
          <div className="scanning-bg" style={preview ? { backgroundImage: `url(${preview})` } : undefined} />
          <div className="scanning-veil" />

          <div className="scanning-inner">
            <div>
              <h2 className="scan-title">
                AI 正在书架里找宝藏
                <span className="dots" style={{ marginLeft: 8 }}>
                  <i />
                  <i />
                  <i />
                </span>
              </h2>
              <p className="scan-sub">一行一行地读书脊，认出第一本就马上给你看</p>
            </div>

            <div className="scanner-line" />

            <div className="found-head">
              <b>{foundCount}</b>
              <span>本已认出</span>
            </div>

            <div className="chips">
              {cards.map((c) => (
                <span className={`chip-found ${c.fit === "很合适" ? "picked" : ""}`} key={c.key}>
                  {c.fit === "很合适" ? "👍 " : ""}
                  {c.title}
                </span>
              ))}
            </div>

            <div className="scan-foot">
              {error ? <div className="banner">{error}</div> : null}

              {cards.length > 0 && (
                <button className="btn-light" type="button" onClick={() => setPhase("deck")}>
                  先看这 {cards.length} 本 →
                </button>
              )}

              <button className="btn-ghost-light" type="button" onClick={reset}>
                取消，重新拍
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ---------------- 速览 ---------------- */}
      {phase === "deck" && (
        <section className="deck">
          <div className="deck-meta">
            <div className="deck-meta-left">
              <span>
                第 {Math.min(index + 1, viewCards.length)} / {viewCards.length} 本
              </span>
              {hasProfile(profile) && (
                <button
                  className={`auto-toggle ${onlyRecommended ? "on" : ""}`}
                  type="button"
                  onClick={() => {
                    setOnlyRecommended((v) => !v);
                    setIndex(0);
                  }}
                  aria-pressed={onlyRecommended}
                >
                  {onlyRecommended ? "显示全部" : "仅显示推荐"}
                </button>
              )}
            </div>
            <div className="deck-meta-right">
              {streaming && (
                <span className="pill-live">
                  <span className="dot" />
                  还在认…
                </span>
              )}
              <button
                className="auto-toggle"
                type="button"
                onClick={() => {
                  flushAlbum();
                  const id = albumIdRef.current;
                  setAlbums(listAlbums());
                  const target = id ?? listAlbums()[0]?.id;
                  if (target) {
                    setAlbumFrom("deck");
                    setOpenAlbumId(target);
                    setScreen("album");
                  }
                }}
              >
                书架
              </button>
              <button
                className={`auto-toggle ${auto ? "on" : ""}`}
                type="button"
                onClick={() => setAuto((v) => !v)}
                aria-pressed={auto}
              >
                {auto ? "停止" : "自动"}
              </button>
            </div>
          </div>

          {auto && current ? (
            <div className="autoplay-track" key={`${current.key}-${auto}`}>
              <span style={{ animationDuration: `${AUTOPLAY_MS}ms` }} />
            </div>
          ) : (
            <div className="autoplay-track ghost" />
          )}

          {current ? (
            <>
              <div
                className="stage"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
              >
                {viewCards
                  .slice(index, index + 3)
                  .map((card, i) => (
                    <div
                      key={card.key}
                      className={`card-wrap ${i === 0 ? "top" : "rest"}`}
                      style={
                        i === 0
                          ? topCardStyle
                          : {
                              transform: `translate3d(0, ${i * 10}px, 0) scale(${1 - i * 0.045})`,
                            }
                      }
                    >
                      <BookCard
                        card={card}
                        genCover={genCovers[card.title]}
                        genLoading={Boolean(genLoading[card.title])}
                        genFailed={Boolean(genFailed[card.title])}
                        saved={saved.includes(card.key)}
                        onToggleSave={i === 0 ? () => toggleSave(card.key) : undefined}
                        onGenerateCover={
                          i === 0
                            ? () =>
                                generateCover(card.title, {
                                  intro: card.intro,
                                  vibe: card.vibe,
                                  tags: card.tags,
                                  grade: card.grade,
                                })
                            : undefined
                        }
                        onOpenDetail={
                          i === 0
                            ? () => {
                                setDetailCard(card);
                                setDetailAlbumId(null);
                              }
                            : undefined
                        }
                      />
                    </div>
                  ))
                  .reverse()}

                {/* 上一本：从左边滑回来盖在当前卡上面（倒放效果） */}
                {entering && (
                  <div
                    className="card-wrap entering"
                    key={`enter-${entering.key}`}
                    style={{ animationDuration: `${flyMs}ms` }}
                  >
                    <BookCard card={entering} />
                  </div>
                )}
              </div>

              <div className="actions">
                <button
                  className="btn btn-prev"
                  type="button"
                  onClick={() => userGo(-1)}
                  disabled={index === 0}
                  aria-label="上一本"
                >
                  ‹ 上一本
                </button>
                <button className="btn btn-next" type="button" onClick={() => userGo(1)} aria-label="下一本">
                  下一本 ›
                </button>
              </div>
            </>
          ) : onlyRecommended && cards.length > 0 ? (
            <div className="done-panel">
              <h2>还没有特别适合你的</h2>
              <p>
                这排书里暂时没有和你的口味对得上的。
                <br />
                也可以点上面的「显示全部」看看全部 {cards.length} 本。
              </p>
            </div>
          ) : streaming ? (
            <div className="done-panel">
              <h2>这排还没认完</h2>
              <p>已经认出 {cards.length} 本，后面还有，等一下下。</p>
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
            </div>
          ) : (
            <div className="done-panel">
              <h2>这排书看完了</h2>
              <p>
                {savedCards.length > 0
                  ? `你收藏了 ${savedCards.length} 本，去书架上把它们抽出来吧。`
                  : "一本都没收藏，要不要再来一次？"}
              </p>
              {savedCards.length > 0 && (
                <div className="saved-list">
                  {savedCards.map((c, i) => (
                    <div className="saved-item" key={c.key}>
                      <span className="idx">{i + 1}</span>
                      {c.title}
                    </div>
                  ))}
                </div>
              )}
              <button className="cta" type="button" onClick={reset} style={{ marginTop: 8 }}>
                <span className="cta-icon">📷</span>
                再拍一排
              </button>
            </div>
          )}
        </section>
      )}

        </>
      )}

      {/* ---------------- 详情 ---------------- */}
      {detailCard && (
        <BookDetail
          card={detailCard}
          onClose={() => {
            setDetailCard(null);
            setDetailAlbumId(null);
          }}
          saved={detailSaved}
          onToggleSave={toggleDetailSaved}
        />
      )}

      {profileOpen && (
        <ProfileSheet
          initial={profile ?? EMPTY_PROFILE}
          onClose={() => setProfileOpen(false)}
          onSave={(p) => {
            saveProfile(p);
            setProfile(p);
            setProfileOpen(false);
          }}
          onClear={() => {
            clearProfile();
            setProfile(null);
            setProfileOpen(false);
          }}
        />
      )}

      {/* ---------------- 收藏清单 ---------------- */}
      {sheetOpen && (
        <>
          <div className="sheet-mask" onClick={() => setSheetOpen(false)} />
          <div className="sheet">
            <div className="sheet-grab" />
            <div className="sheet-head">
              <h3>收藏的书 · {savedCards.length}</h3>
              <button className="linkish" type="button" onClick={() => setSheetOpen(false)}>
                关闭
              </button>
            </div>
            {savedCards.length === 0 ? (
              <div className="sheet-empty">
                还没有收藏的书。
                <br />
                滑到喜欢的那本，点「☆ 收藏」就会出现在这里。
              </div>
            ) : (
              <div className="saved-list" style={{ maxHeight: "60dvh" }}>
                {savedCards.map((c, i) => (
                  <div className="saved-item" key={c.key}>
                    <span className="idx">{i + 1}</span>
                    {c.title}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      </main>
    </>
  );
}
