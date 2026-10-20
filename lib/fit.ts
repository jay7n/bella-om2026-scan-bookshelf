/** 推荐结论的统一叫法和色调 */
export type FitTone = "yes" | "maybe" | "no";

export function fitTone(fit?: string): FitTone | null {
  if (fit === "很合适") return "yes";
  if (fit === "可以试试") return "maybe";
  if (fit === "不太合") return "no";
  return null;
}

/** 对外一律说「推荐」，不再暴露「很合适」这种内部措辞 */
export function fitLabel(fit?: string): string {
  if (fit === "很合适") return "👍 推荐";
  if (fit === "可以试试") return "可以试试";
  if (fit === "不太合") return "不太合";
  return "";
}

/** 是否算「被推荐」（筛选和角标都用这个判断） */
export function isRecommended(fit?: string): boolean {
  return fit === "很合适";
}
