"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    __ERRS__?: string[];
  }
}

/**
 * 只在地址里带 ?debug=1 时出现。
 * 手机上打不开东西的时候，加上这个参数就能把 JS 报错直接显示在屏幕上，
 * 不用连电脑看控制台。
 */
export default function DebugOverlay() {
  const [lines, setLines] = useState<string[]>([]);
  const [storage, setStorage] = useState<string[]>([]);
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("debug")) return;
    setOn(true);

    const readStorage = () => {
      const rows: string[] = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || !k.startsWith("bs.")) continue;
          const v = localStorage.getItem(k) ?? "";
          rows.push(`${k}  ${(v.length / 1024).toFixed(1)}KB`);
        }
      } catch {
        rows.push("(localStorage 读不到，可能是无痕模式)");
      }
      setStorage(rows.length ? rows.sort() : ["(还没有任何缓存)"]);
    };

    const read = () => setLines([...(window.__ERRS__ ?? [])]);
    read();
    readStorage();
    const timer = window.setInterval(() => {
      read();
      readStorage();
    }, 800);

    const log = (msg: string) => {
      window.__ERRS__ = window.__ERRS__ ?? [];
      window.__ERRS__.push(msg);
      read();
    };

    log(`[info] ${navigator.userAgent}`);

    const onError = (e: ErrorEvent) =>
      log(`[error] ${e.message} @ ${String(e.filename).split("/").pop()}:${e.lineno}`);
    const onReject = (e: PromiseRejectionEvent) =>
      log(`[reject] ${String((e.reason as { message?: string })?.message ?? e.reason)}`);

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onReject);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onReject);
    };
  }, []);

  if (!on) return null;

  return (
    <div className="debug-overlay">
      <div className="debug-head">调试 · {lines.length} 条（把这张截图发我）</div>
      <div className="debug-body">
        <div className="debug-sec">本地存储</div>
        {storage.map((s) => (
          <div key={s}>{s}</div>
        ))}
        <div className="debug-sec">报错</div>
        {lines.length === 0 ? <div>[无报错]</div> : lines.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}
