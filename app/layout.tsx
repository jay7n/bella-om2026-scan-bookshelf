import type { Metadata, Viewport } from "next";
import DebugOverlay from "@/components/DebugOverlay";
import "./skin.css";

export const metadata: Metadata = {
  title: "扫书 · AI 书架速览器",
  description: "扫书 · AI 书架速览器：拍一张书架照片，就能像刷卡片一样速览整排书。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FAF6EE",
};

/**
 * 在 hydration 之前就把错误收集起来。
 * 手机上没有控制台，加 ?debug=1 就能在屏幕上看到真实报错。
 */
const EARLY_ERROR_HOOK = `
window.__ERRS__ = window.__ERRS__ || [];
addEventListener('error', function (e) {
  var m = e && e.message ? e.message : ('资源加载失败: ' + ((e.target && (e.target.src || e.target.href)) || ''));
  window.__ERRS__.push('[early] ' + m);
}, true);
addEventListener('unhandledrejection', function (e) {
  window.__ERRS__.push('[early-reject] ' + ((e.reason && e.reason.message) || e.reason));
});
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-skin="night" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: EARLY_ERROR_HOOK }} />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=new URLSearchParams(location.search).get('skin');if(s)document.documentElement.dataset.skin=s;}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        {children}
        <DebugOverlay />
      </body>
    </html>
  );
}
