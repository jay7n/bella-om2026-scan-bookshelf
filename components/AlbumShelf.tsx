"use client";

import { useState } from "react";
import CoverArt from "./CoverArt";
import { formatWhen } from "@/lib/albums";
import { getCachedCover } from "@/lib/coverCache";
import type { Album, AlbumBook } from "@/lib/types";

const PRESETS = ["社区图书角", "学校图书馆", "家里书架", "书店"];

function ShelfBook({ book, saved, onOpen }: { book: AlbumBook; saved: boolean; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  // 本地缓存优先：豆瓣抓下来的、或 AI 画的，都在这里
  const cached = getCachedCover(book.title);
  const showReal = !cached && Boolean(book.cover) && !failed;

  return (
    // 用 div + role 而不是 button：封面里是 div，放 button 里属于非法嵌套
    <div
      className={`shelf-item ${book.fit === "很合适" ? "picked" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <span className="shelf-cover">
        {/* 程序化封面永远垫在底下：真封面挂了也不会露出空白格子 */}
        <CoverArt title={book.title} compact />
        {cached ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cached} alt="" loading="lazy" />
        ) : showReal ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={book.cover ?? ""} alt="" loading="lazy" onError={() => setFailed(true)} />
        ) : null}
        {book.fit === "很合适" ? (
          <i className="shelf-pick" aria-label="推荐">
            👍
          </i>
        ) : null}
        {saved ? <i className="shelf-dot" aria-label="已收藏" /> : null}
      </span>
      <span className="shelf-plank" />
      <span className="shelf-title">{book.title}</span>
    </div>
  );
}

/**
 * 一次拍照的合集：顶上一条这次拍的照片，下面把书平铺成一排排书架。
 */
export default function AlbumShelf({
  album,
  onBack,
  onOpenBook,
  onDelete,
  onRename,
  onPlay,
}: {
  album: Album;
  onBack: () => void;
  onOpenBook: (book: AlbumBook) => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onPlay: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState(album.name ?? "");

  const openNaming = () => {
    setDraft(album.name ?? "");
    setNaming(true);
  };

  const saveName = () => {
    onRename(draft.trim());
    setNaming(false);
  };

  return (
    <section className="album-view">
      <header className="sub-bar">
        <button className="sub-back" type="button" onClick={onBack}>
          ‹ 返回
        </button>
        <span className="sub-title">{album.name || "这次拍的"}</span>
        <button className="sub-action" type="button" onClick={() => setConfirming(true)}>
          删除
        </button>
      </header>

      <div className="album-scroll">
        <div className="album-head">
          <span
            className="album-thumb"
            style={album.thumb ? { backgroundImage: `url(${album.thumb})` } : undefined}
          />
          <div className="album-meta">
            <b>{album.name || "还没起名"}</b>
            <span>
              {formatWhen(album.at)} · 共 {album.books.length} 本 · 收藏 {album.saved.length} 本
            </span>
          </div>
          <button className="album-edit" type="button" onClick={openNaming}>
            {album.name ? "改名" : "起名"}
          </button>
        </div>

        {naming && (
          <div className="rename-panel">
            <p className="rename-label">这一册是在哪儿拍的？</p>
            <div className="rename-chips">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`rename-chip ${draft === p ? "on" : ""}`}
                  onClick={() => setDraft(p)}
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="rename-row">
              <input
                className="rename-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                }}
                placeholder="也可以自己写一个"
                maxLength={16}
                autoFocus
              />
              <button className="rename-save" type="button" onClick={saveName}>
                保存
              </button>
            </div>
            <button className="rename-cancel" type="button" onClick={() => setNaming(false)}>
              先不起名
            </button>
          </div>
        )}

        {confirming && (
          <div className="confirm-bar">
            <span>删掉这次记录？</span>
            <button
              type="button"
              className="confirm-yes"
              onClick={() => {
                setConfirming(false);
                onDelete();
              }}
            >
              删掉
            </button>
            <button type="button" className="confirm-no" onClick={() => setConfirming(false)}>
              算了
            </button>
          </div>
        )}

        {album.books.length === 0 ? (
          <p className="album-empty">这一册是空的。</p>
        ) : (
          <div className="shelf-grid">
            {album.books.map((b) => (
              <ShelfBook
                key={b.key}
                book={b}
                saved={album.saved.includes(b.key)}
                onOpen={() => onOpenBook(b)}
              />
            ))}
          </div>
        )}
      </div>

      {album.books.length > 0 ? (
        <div className="album-actions">
          <button className="album-play" type="button" onClick={onPlay}>
            ▶ 用闪卡看这 {album.books.length} 本
          </button>
        </div>
      ) : null}
    </section>
  );
}
