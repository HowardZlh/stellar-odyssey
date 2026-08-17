/**
 * 昵称/留言敏感词过滤（Z 迭代 M2，REQUIREMENTS_ALIPAY_UNLOCK.md D4/E3/D-z7；
 * 归一化 + 子串匹配算法自 stock_analysis `functions/_filter.js` 直译）。
 *
 * D-z7 偏离登记（相对 stock 词库内置数组）：本仓库公开，词库明文入库 =
 * 暴露 + 可绕过——词库存 D1 `kv_state('filter:words')`（JSON 字符串数组，
 * 管理台维护，不入库），本模块只含归一化 + 匹配纯函数；
 * **词库为空/未配置/解析失败时仅做长度校验放行**（E3：昵称 ≤20 / 留言 ≤50，
 * 去首尾空白，空存 NULL）。
 */
import { getStateJson, type UnlockDbLike } from "./db";

/** kv_state 键：敏感词词库（JSON 字符串数组，归一化形态存储为宜） */
export const FILTER_WORDS_STATE_KEY = "filter:words";

/** E3 长度上限（字符数按 code point 计） */
export const NICKNAME_MAX_LEN = 20;
export const MESSAGE_MAX_LEN = 50;

/** 归一化：全角→半角，去空白与零宽字符，转小写（stock 口径） */
export function normalizeText(raw: unknown): string {
  let out = "";
  for (const ch of String(raw ?? "")) {
    const cp = ch.codePointAt(0) as number;
    if (cp === 0x3000) continue; // 全角空格按空白丢弃
    let c = ch;
    if (cp >= 0xff01 && cp <= 0xff5e) c = String.fromCodePoint(cp - 0xfee0); // 全角→半角
    if (/[\s\u200b-\u200f\ufeff]/.test(c)) continue; // 空白/零宽
    out += c;
  }
  return out.toLowerCase();
}

/** 命中返回词条，未命中返回 null（词条与输入均先归一化） */
export function containsBlocked(
  raw: unknown,
  words: readonly string[],
): string | null {
  const norm = normalizeText(raw);
  if (!norm) return null;
  for (const w of words) {
    const nw = normalizeText(w);
    if (nw !== "" && norm.includes(nw)) return w;
  }
  return null;
}

/**
 * 词库装载（D-z7）：kv_state('filter:words') → 字符串数组；
 * 无记录/非法 JSON/非数组一律返回空词库（仅长度校验放行）。
 */
export async function loadFilterWords(db: UnlockDbLike): Promise<string[]> {
  const raw = await getStateJson(db, FILTER_WORDS_STATE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((w): w is string => typeof w === "string" && w !== "");
}

/** 字段校验结果：ok 时 value 为去首尾空白后的值（空 → null，名单显示「匿名用户」） */
export type FieldValidation =
  | { readonly ok: true; readonly value: string | null }
  | {
      readonly ok: false;
      readonly error: "too_long" | "blocked";
      readonly message: string;
    };

function validateField(
  raw: unknown,
  label: string,
  maxLen: number,
  words: readonly string[],
): FieldValidation {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: true, value: null };
  if ([...value].length > maxLen) {
    return {
      ok: false,
      error: "too_long",
      message: `${label}过长，请控制在 ${maxLen} 个字符以内。`,
    };
  }
  if (containsBlocked(value, words) !== null) {
    return {
      ok: false,
      error: "blocked",
      message: `${label}包含不适宜公开展示的内容，请修改后重试。`,
    };
  }
  return { ok: true, value };
}

export function validateNickname(
  raw: unknown,
  words: readonly string[],
): FieldValidation {
  return validateField(raw, "昵称", NICKNAME_MAX_LEN, words);
}

export function validateMessage(
  raw: unknown,
  words: readonly string[],
): FieldValidation {
  return validateField(raw, "留言", MESSAGE_MAX_LEN, words);
}
