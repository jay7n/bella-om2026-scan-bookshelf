"use client";

import { useEffect, useState } from "react";
import { clearStats, exportJSON, readStats, summarize, trackOpen, type StatEvent } from "@/lib/analytics";

type ServerStats = {
  total: number;
  sessions: number;
  events: Array<{ n: string; count: number }>;
  days: Array<{ d: string; count: number }>;
  since: string | null;
};

const LABEL: Record<string, string> = {
  app_open: "打开应用",
  scan_start: "开始扫描",
  scan_done: "扫描完成",
  card_swipe: "翻卡片",
  open_detail: "看详情",
  save_book: "收藏",
  filter_recommend: "只看推荐",
  profile_save: "填画像",
};

const cn = (n: string) => LABEL[n] ?? n;

/**
 * 只在地址带 ?stats=1 时出现。
 * 把本机记录的使用数据列出来，可以复制或下载，方便看真实使用情况。
 */
export default function StatsPanel() {
  const [on, setOn] = useState(false);
  const [events, setEvents] = useState<StatEvent[]>([]);
  const [copied, setCopied] = useState(false);
  const [server, setServer] = useState<ServerStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("stats")) return;
    setOn(true);
    trackOpen();
    setEvents(readStats().events);
  }, []);

  const loadServer = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stat", { cache: "no-store" });
      const data = (await res.json()) as ServerStats & { ok?: boolean };
      if (data?.ok) setServer(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

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
        {server ? (
          <div className="stats-server">
            <div className="stats-server-head">
              <b>所有人合计</b>
              <span>
                {server.total} 条 · {server.sessions} 个设备
              </span>
            </div>
            {server.events.slice(0, 8).map((r) => (
              <div className="stats-row" key={`s-${r.n}`}>
                <span className="stats-name">{cn(r.n)}</span>
                <span className="stats-count">{r.count}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="stats-sec-title">这台设备</div>

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
        <button type="button" onClick={loadServer}>
          {loading ? "读取中…" : server ? "刷新合计" : "看合计"}
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

      <p className="stats-note">
        「这台设备」只存在本机；「所有人合计」来自服务端，只有次数，不含书名和照片。
      </p>
    </div>
  );
}
