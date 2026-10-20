/**
 * 使用者画像。
 * 现在只负责「填 + 存 + 在首页显示摘要」，
 * 之后接推荐时，把这份数据塞进 /api/enrich 或 /api/detail 的提示词即可。
 */

const KEY = "bs.profile.v1";

export type Profile = {
  grade?: string;
  gender?: string;
  /** 我是什么样的 */
  traits: string[];
  /** 我喜欢看什么 */
  interests: string[];
  /** 自由补充 */
  note?: string;
  updatedAt?: number;
};

export const GRADES = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级"];
export const GENDERS = ["男生", "女生", "先不说"];

export const TRAITS = [
  "好奇",
  "安静",
  "爱笑",
  "爱动",
  "认真",
  "爱问为什么",
  "怕吓人",
  "喜欢动手",
];

export const INTERESTS = [
  "科普",
  "故事",
  "漫画",
  "动物",
  "太空",
  "历史",
  "实验",
  "神话",
  "侦探",
  "搞笑",
];

export const EMPTY_PROFILE: Profile = { traits: [], interests: [] };

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Profile;
    if (!p || typeof p !== "object") return null;
    return {
      grade: p.grade,
      gender: p.gender,
      traits: Array.isArray(p.traits) ? p.traits : [],
      interests: Array.isArray(p.interests) ? p.interests : [],
      note: p.note,
      updatedAt: p.updatedAt,
    };
  } catch {
    return null;
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...p, updatedAt: Date.now() }));
  } catch {
    // 配额满了就放弃，不影响主流程
  }
}

export function clearProfile(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** 有没有填过有意义的东西 */
export function hasProfile(p: Profile | null): boolean {
  if (!p) return false;
  return Boolean(p.grade || p.gender || p.traits.length || p.interests.length || p.note?.trim());
}

/** 首页那一行摘要 */
export function profileSummary(p: Profile | null): string {
  if (!p) return "";
  const bits: string[] = [];
  if (p.grade) bits.push(p.grade);
  if (p.gender && p.gender !== "先不说") bits.push(p.gender);
  if (p.interests.length) bits.push(`爱看${p.interests.slice(0, 2).join("、")}`);
  else if (p.traits.length) bits.push(p.traits.slice(0, 2).join("、"));
  return bits.join(" · ") || "已填写";
}
