"use client";

import { useEffect, useState } from "react";
import CoverArt from "./CoverArt";
import { detailCacheKey, getCachedDetail, putCachedDetail } from "@/lib/detailCache";
import { getCachedCover } from "@/lib/coverCache";
import { fitLabel, fitTone } from "@/lib/fit";
import type { CardData, DetailResponse } from "@/lib/types";

function Stars({ rating }: { rating: string | null }) {
  if (!rating) return null;
  const score = Number(rating);
  if (!Number.isFinite(score) || score <= 0) return null;
  const filled = Math.round(score / 2);
  return (
    <span className="stars" aria-label={`豆瓣评分 ${rating}`}>
      {"★".repeat(Math.min(5, filled))}
      <span className="stars-off">{"★".repeat(Math.max(0, 5 - filled))}</span>
    </span>
  );
}

export default function BookDetail({
  card,
  onClose,
  onToggleSave,
  saved,
}: {
  card: CardData;
  onClose: () => void;
  onToggleSave: () => void;
  saved: boolean;
}) {
  const cacheKey = detailCacheKey(card.doubanId, card.title, card.author);

  const [data, setData] = useState<DetailResponse | null>(() => getCachedDetail(cacheKey));
  const [error, setError] = useState<string | null>(null);
  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => {
    const cached = getCachedDetail(cacheKey);
    if (cached) {
      setData(cached);
      setError(null);
      return;
    }

    let cancelled = false;
    setData(null);
    setError(null);

    const params = new URLSearchParams({ title: card.title });
    if (card.doubanId) params.set("id", card.doubanId);
    if (card.author) params.set("author", card.author);
    if (card.year) params.set("year", card.year);

    fetch(`/api/detail?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as DetailResponse;
      })
      .then((d) => {
        if (cancelled) return;
        putCachedDetail(cacheKey, d);
        setData(d);
      })
      .catch(() => {
        if (!cancelled) setError("详情没拿到，可能是网络或者豆瓣那边卡住了。");
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, card.title, card.doubanId, card.author, card.year]);

  const douban = data?.douban ?? null;
  const ai = data?.ai ?? null;
  const loading = !data && !error;

  // 封面：本地缓存（豆瓣抓下来的 / AI 画的）优先，其次才是网络地址
  const cachedCover = getCachedCover(card.title);
  const remoteCover = card.coverState === "done" ? card.cover : null;
  const coverUrl = !coverFailed ? (cachedCover ?? remoteCover) : null;

  return (
    <section className="detail">
      <header className="detail-bar">
        <button className="detail-back" type="button" onClick={onClose}>
          ‹ 返回
        </button>
        <span className="detail-bar-title">{card.title}</span>
        <span style={{ width: 56 }} />
      </header>

      <div className="detail-scroll">
        {/* 顶部：封面 + 书名 + 评分，不做糊成一团的背景 */}
        <div className="dt-top">
          {coverUrl ? (
            <div className="dt-glow" style={{ backgroundImage: `url(${coverUrl})` }} aria-hidden />
          ) : null}

          <div className="dt-cover-box">
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverUrl} alt={`《${card.title}》封面`} onError={() => setCoverFailed(true)} />
            ) : (
              <CoverArt title={card.title} />
            )}
          </div>

          <div className="dt-meta">
            <h1>{card.title}</h1>
            {(card.author || card.year || douban?.publisher) && (
              <p className="dt-sub">
                {[card.author, card.year, douban?.publisher].filter(Boolean).join(" · ")}
              </p>
            )}

            {douban?.rating ? (
              <div className="dt-rating">
                <b>{douban.rating}</b>
                <div>
                  <Stars rating={douban.rating} />
                  {douban.votes ? (
                    <span className="dt-votes">
                      {Number(douban.votes).toLocaleString("zh-CN")} 人评
                    </span>
                  ) : null}
                </div>
              </div>
            ) : loading ? (
              <span className="sk w70" style={{ marginTop: 12 }} />
            ) : (
              <p className="dt-norating">豆瓣还没有这本书的评分</p>
            )}
          </div>
        </div>

        {/* 卡片上最抓人的那几句，原样带进来并做出字号层级 */}
        {(card.hook || card.intro || card.vibe.length > 0 || card.tags.length > 0) && (
          <div className="dt-lede">
            {(card.vibe.length > 0 || card.grade) && (
              <div className="dt-chips">
                {card.vibe.map((v, i) => (
                  <span key={`${v}-${i}`} className={`dt-mood ${i === 0 ? "hot" : ""}`}>
                    {v}
                  </span>
                ))}
                {card.grade ? <span className="dt-mood grade">{card.grade}</span> : null}
              </div>
            )}

            {card.hook ? <p className="dt-hook">{card.hook}</p> : null}
            {card.intro ? <p className="dt-lede-text">{card.intro}</p> : null}

            {card.tags.length > 0 && (
              <div className="dt-chips">
                {card.tags.map((t, i) => (
                  <span key={`${t}-${i}`} className="dt-tag">
                    {t}
                  </span>
                ))}
              </div>
            )}

            {card.similar ? <p className="dt-similar">{card.similar}</p> : null}
          </div>
        )}

        {error ? <div className="banner">{error}</div> : null}

        {loading ? (
          <div style={{ display: "grid", gap: 12, padding: "18px 0" }}>
            <span className="sk w50" />
            <span className="sk w90" />
            <span className="sk w90" />
            <span className="sk w70" />
          </div>
        ) : null}

        {fitTone(card.fit) ? (
          <div className={`dt-fit fit-${fitTone(card.fit)}`}>
            <span className="dt-fit-badge">{fitLabel(card.fit)}</span>
            {card.reason ? <p>{card.reason}</p> : null}
          </div>
        ) : null}

        {ai ? (
          <div className="dt-body">
            {ai.what ? <Sec n="01" title="这本书讲什么" text={ai.what} /> : null}
            {ai.why ? <Sec n="02" title="为什么值得读" text={ai.why} /> : null}
            {ai.before ? <Sec n="03" title="读之前要知道" text={ai.before} /> : null}
            {ai.bestFor ? <Sec n="04" title="最适合谁" text={ai.bestFor} /> : null}
          </div>
        ) : null}

        {douban?.summary ? (
          <div className="dt-body">
            <Sec n="05" title="豆瓣简介" text={douban.summary} />
          </div>
        ) : null}

        {douban?.comments?.length ? (
          <div className="dt-body">
            <div className="dt-sec">
              <h3>
                <span className="dt-num">06</span>读者怎么说
              </h3>
              <ul className="dt-quotes">
                {douban.comments.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {douban?.url ? (
          <a className="detail-link" href={douban.url} target="_blank" rel="noreferrer noopener">
            去豆瓣看这本书的完整页面 ↗
          </a>
        ) : null}

        <p className="detail-foot-note">评分、简介与短评来自豆瓣图书，仅用于本作品展示。</p>
      </div>

      <div className="detail-actions">
        <button className={`btn ${saved ? "btn-saved" : "btn-save"}`} type="button" onClick={onToggleSave}>
          {saved ? "✓ 已收藏" : "＋ 收藏"}
        </button>
      </div>
    </section>
  );
}

function Sec({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <div className="dt-sec">
      <h3>
        <span className="dt-num" aria-hidden>
          {n}
        </span>
        {title}
      </h3>
      <p>{text}</p>
    </div>
  );
}
