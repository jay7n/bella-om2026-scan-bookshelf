"use client";

import { formatWhen } from "@/lib/albums";
import type { Album } from "@/lib/types";

/** 历史：所有拍照记录，按时间倒序 */
export default function HistoryList({
  albums,
  onBack,
  onOpen,
}: {
  albums: Album[];
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="history-view">
      <header className="sub-bar">
        <button className="sub-back" type="button" onClick={onBack}>
          ‹ 返回
        </button>
        <span className="sub-title">历史</span>
        <span className="sub-count">{albums.length} 册</span>
      </header>

      <div className="history-scroll">
        {albums.length === 0 ? (
          <div className="history-empty">
            <p>还没有拍过书架。</p>
            <p className="dim">拍一次，这里就会多一册。</p>
          </div>
        ) : (
          <div className="history-list">
            {albums.map((a) => (
              <button className="history-card" type="button" key={a.id} onClick={() => onOpen(a.id)}>
                <span
                  className="history-thumb"
                  style={a.thumb ? { backgroundImage: `url(${a.thumb})` } : undefined}
                />
                <span className="history-info">
                  <b>{a.name || formatWhen(a.at)}</b>
                  <span className="history-stat">
                    {a.name ? `${formatWhen(a.at)} · ` : ""}
                    {a.books.length} 本{a.saved.length > 0 ? ` · 收藏 ${a.saved.length} 本` : ""}
                  </span>
                  <span className="history-titles">
                    {a.books
                      .slice(0, 3)
                      .map((b) => b.title)
                      .join(" · ")}
                    {a.books.length > 3 ? " …" : ""}
                  </span>
                </span>
                <span className="history-arrow">›</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
