import type { CSSProperties } from "react";

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** 按书名长度挑字号，2 个字放到很大，长书名缩到能放下 */
const SIZE_STEPS: Array<[number, string]> = [
  [3, "2.5rem"],
  [4, "2.1rem"],
  [6, "1.8rem"],
  [9, "1.45rem"],
  [14, "1.18rem"],
  [99, "0.98rem"],
];

/** 历史书架里只有 70~90px 宽，字号要另配一套 */
const SIZE_STEPS_SMALL: Array<[number, string]> = [
  [3, "1.05rem"],
  [5, "0.86rem"],
  [9, "0.7rem"],
  [99, "0.6rem"],
];

/**
 * 柔和双色渐变。刻意选偏暗、偏浊的颜色 ——
 * 暗底上放白字才立得住，也不会和米白卡片打架。
 */
const PALETTES: Array<{ c1: string; c2: string }> = [
  { c1: "#1f5f52", c2: "#2f8f79" }, // 深绿 → 青
  { c1: "#25406b", c2: "#4272a8" }, // 藏青 → 蓝
  { c1: "#8a5a22", c2: "#c99a3f" }, // 赭石 → 金
  { c1: "#5b2f4e", c2: "#99557a" }, // 梅紫 → 玫瑰
  { c1: "#2d4a4f", c2: "#4d8085" }, // 墨青 → 灰青
];

/**
 * 程序化封面：没有任何网络依赖。
 * 同一本书永远得到同一组配色 —— 这是「专属感」的来源。
 */
export default function CoverArt({ title, compact = false }: { title: string; compact?: boolean }) {
  const h = hashString(title);
  const palette = PALETTES[h % PALETTES.length];
  const steps = compact ? SIZE_STEPS_SMALL : SIZE_STEPS;
  const fontSize = steps.find(([n]) => title.length <= n)?.[1] ?? "0.98rem";

  const style = { "--c1": palette.c1, "--c2": palette.c2 } as CSSProperties;

  return (
    <div className={`cover-art v${h % 3}`} style={style}>
      <span className="cover-spine" />
      <span className="cover-art-title" style={{ fontSize }}>
        {title}
      </span>
    </div>
  );
}
