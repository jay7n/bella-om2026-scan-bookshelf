"use client";

import { useEffect, useState } from "react";
import { clearStats, exportJSON, readStats, summarize, trackOpen, type StatEvent } from "@/lib/analytics";

/**
 * 只在地址带 ?stats=1 时出现。
 * 把本机记录的使用数据列出来，可以复制或下载，方便看真实使用情况。
 */
export default function StatsPanel() {
  const [on, setOn] = useState(false);
  const [events, setEvents] = useState<StatEvent[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("stats")) return;
    setOn(true);
    trackOpen();
    setEvents(readStats().events);
  }, []);

  if (!on) return null;

  const rows = summarize(events).slice(0, 12);

  const download = () => {
    const blob = new Blob([exportJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `saoshu-stats-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportJSON());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="stats-panel">
      <div className="stats-head">
        <b>使用记录</b>
        <span>{events.length} 条</span>
      </div>

      <div className="stats-body">
        {rows.length === 0 ? (
          <p className="stats-empty">还没有记录。用一下再来。</p>
        ) : (
          rows.map((r) => (
            <div className="stats-row" key={r.n}>
              <span className="stats-name">{r.n}</span>
              <span className="stats-count">{r.count}</span>
            </div>
          ))
        )}
      </div>

      <div className="stats-actions">
        <button type="button" onClick={download}>
          下载 JSON
        </button>
        <button type="button" onClick={copy}>
          {copied ? "已复制" : "复制"}
        </button>
        <button
          type="button"
          className="stats-clear"
          onClick={() => {
            clearStats();
            setEvents([]);
          }}
        >
          清空
        </button>
      </div>

      <p className="stats-note">只记录动作次数，不记录书名和照片；数据只存在这台设备上。</p>
    </div>
  );
}
