"use client";

import { useEffect, useState } from "react";
import CoverArt from "./CoverArt";
import { fitLabel, fitTone } from "@/lib/fit";
import type { CardData } from "@/lib/types";

export default function BookCard({
  card,
  onOpenDetail,
  genCover,
  genLoading,
  saved = false,
  onToggleSave,
  onGenerateCover,
  genFailed = false,
}: {
  card: CardData;
  onOpenDetail?: () => void;
  /** Seedream 给这本画的封面（豆瓣没封面时） */
  genCover?: string;
  /** 正在画这张封面 */
  genLoading?: boolean;
  saved?: boolean;
  onToggleSave?: () => void;
  /** 手动让它画一张 */
  onGenerateCover?: () => void;
  /** 上一次画失败了 */
  genFailed?: boolean;
}) {
  // 豆瓣偶尔会 403/418，图片代理会返回 502。这时候不能让卡片显示破图。
  const [coverFailed, setCoverFailed] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    setCoverFailed(false);
  }, [card.cover]);

  // 本地缓存的图（豆瓣抓下来的 or AI 画的）优先，命中就完全不发请求
  const remote = card.coverState === "done" && card.cover && !coverFailed ? card.cover : null;
  const coverSrc = genCover ?? remote;
  const hasCover = Boolean(coverSrc);
  const showDouban = hasCover && card.matched;
  const showGen = hasCover && !card.matched;
  const loading = card.infoState === "loading";

  return (
    <div className="card">
      <div className="card-cover">
        {coverSrc ? (
          <>
            {/* 用同一张封面放大模糊做底，把左右留白填满，看着才像一本大书 */}
            <span className="cover-blur" style={{ backgroundImage: `url(${coverSrc})` }} aria-hidden />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={`real ${imgLoaded ? "in" : "out"}`}
              src={coverSrc}
              alt={`《${card.title}》封面`}
              draggable={false}
              onLoad={() => setImgLoaded(true)}
              onError={() => setCoverFailed(true)}
            />
            {!imgLoaded ? (
              <span className="cover-hint">
                <i className="spinner" />
                正在加载封面…
              </span>
            ) : null}
          </>
        ) : card.coverState === "loading" ? (
          <div className="sk" style={{ width: "62%", height: "72%", borderRadius: 10 }} />
        ) : (
          <CoverArt title={card.title} />
        )}

        {card.coverState !== "loading" && (
          <span className={`cover-badge ${showDouban ? "" : "diy"}`}>
            {showDouban ? "豆瓣书封" : showGen ? "AI 画封" : "自绘封面"}
          </span>
        )}

        {!hasCover ? (
          genLoading ? (
            <span className="cover-loading">
              <i className="spinner" />
              AI 正在画封面…
            </span>
          ) : onGenerateCover ? (
            <button
              className={`cover-gen ${genFailed ? "failed" : ""}`}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onGenerateCover();
              }}
            >
              {genFailed ? "画失败了，再试一次" : "✦ 生成封面"}
            </button>
          ) : null
        ) : null}

        {onToggleSave && (
          <button
            className={`cover-detail ${saved ? "on" : ""}`}
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSave();
            }}
            aria-pressed={saved}
            aria-label={saved ? "取消收藏" : "收藏"}
          >
            {saved ? "★ 已收藏" : "☆ 收藏"}
          </button>
        )}
      </div>

      <div className="card-body">
        <h2 className="card-title">{card.title}</h2>

        {card.matched && (card.author || card.year) ? (
          <p className="card-sub">{[card.author, card.year].filter(Boolean).join(" · ")}</p>
        ) : null}

        {fitTone(card.fit) ? (
          <div className={`card-fit fit-${fitTone(card.fit)}`}>
            <span className="card-fit-label">{fitLabel(card.fit)}</span>
            {card.reason ? <span className="card-fit-why">{card.reason}</span> : null}
          </div>
        ) : null}

        {loading ? (
          <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
            <span className="sk w50" />
            <span className="sk w90" />
            <span className="sk w70" />
          </div>
        ) : card.infoState === "error" ? (
          <p className="card-intro" style={{ color: "var(--ink-faint)" }}>
            这本的介绍没生成出来，先滑下一本吧。
          </p>
        ) : (
          <>
            {/* 气质词放在书名正下方：一眼就能判断「我喜不喜欢这种感觉」 */}
            {(card.vibe.length > 0 || card.grade) && (
              <div className="moods">
                {card.vibe.map((v, i) => (
                  <span key={`${v}-${i}`} className={`mood m${i % 3}`}>
                    {v}
                  </span>
                ))}
                {card.grade ? <span className="mood grade">{card.grade}</span> : null}
              </div>
            )}

            {card.hook ? <p className="card-hook">{card.hook}</p> : null}

            <p className="card-intro">{card.intro}</p>

            {card.tags.length > 0 && (
              <div className="tags">
                {card.tags.map((t, i) => (
                  <span key={`${t}-${i}`} className="tag">
                    {t}
                  </span>
                ))}
              </div>
            )}

            {card.similar ? <p className="card-similar">{card.similar}</p> : null}
          </>
        )}

      </div>

      {onOpenDetail ? (
        <div className="card-foot">
          <button
            className="card-detail"
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetail();
            }}
          >
            详情 ›
          </button>
        </div>
      ) : null}
    </div>
  );
}
