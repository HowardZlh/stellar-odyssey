/**
 * @jest-environment node
 *
 * workers/unlock/lib/textFilter.ts — 敏感词过滤单测（Z 迭代 M2；
 * 归一化/匹配用例对照 stock `tests/js/filter.test.mjs`；词库装载为
 * D-z7 偏离设计：kv_state('filter:words')，空词库仅长度校验）。
 */
import { putStateRaw } from "../db";
import {
  containsBlocked,
  FILTER_WORDS_STATE_KEY,
  loadFilterWords,
  MESSAGE_MAX_LEN,
  NICKNAME_MAX_LEN,
  normalizeText,
  validateMessage,
  validateNickname,
} from "../textFilter";
import { FakeD1 } from "./helpers/fakeD1";

/** 测试词库（仅测试 fixture，生产词库存 D1 不入库） */
const WORDS = ["测试屏蔽词", "blockedword"];

describe("normalizeText 归一化", () => {
  it("全角→半角 / 去空白零宽 / 转小写", () => {
    expect(normalizeText("ＡＢＣ　ｄｅｆ")).toBe("abcdef");
    expect(normalizeText(" A b\tC\n")).toBe("abc");
    expect(normalizeText("a\u200bb\u200cc\ufeffd")).toBe("abcd");
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
  });
});

describe("containsBlocked 子串匹配", () => {
  it("原文/插空格/全角变体均命中；未命中与空串返回 null", () => {
    expect(containsBlocked("我是测试屏蔽词啊", WORDS)).toBe("测试屏蔽词");
    expect(containsBlocked("测 试 屏 蔽 词", WORDS)).toBe("测试屏蔽词");
    expect(containsBlocked("BlockedWord", WORDS)).toBe("blockedword");
    expect(containsBlocked("ｂｌｏｃｋｅｄｗｏｒｄ", WORDS)).toBe("blockedword");
    expect(containsBlocked("正常昵称", WORDS)).toBeNull();
    expect(containsBlocked("", WORDS)).toBeNull();
    expect(containsBlocked("   ", WORDS)).toBeNull();
  });

  it("空词条防御：词库含空串不误伤", () => {
    expect(containsBlocked("正常", ["", "  "])).toBeNull();
  });
});

describe("validateNickname / validateMessage（E3 长度 + 命中拒绝）", () => {
  it("空值 → ok + null（名单显示匿名）；去首尾空白", () => {
    expect(validateNickname("", WORDS)).toEqual({ ok: true, value: null });
    expect(validateNickname("  ", WORDS)).toEqual({ ok: true, value: null });
    expect(validateNickname(" 老王 ", WORDS)).toEqual({ ok: true, value: "老王" });
    expect(validateMessage(undefined, WORDS)).toEqual({ ok: true, value: null });
  });

  it("超长拒绝（昵称 20 / 留言 50，code point 计数）", () => {
    const nick = validateNickname("x".repeat(NICKNAME_MAX_LEN + 1), WORDS);
    expect(nick.ok).toBe(false);
    if (!nick.ok) {
      expect(nick.error).toBe("too_long");
      expect(nick.message).toMatch(/20 个字符/);
    }
    expect(validateNickname("x".repeat(NICKNAME_MAX_LEN), WORDS).ok).toBe(true);
    const msg = validateMessage("y".repeat(MESSAGE_MAX_LEN + 1), WORDS);
    expect(msg.ok).toBe(false);
    if (!msg.ok) expect(msg.message).toMatch(/50 个字符/);
  });

  it("命中拒绝并提示修改（昵称与留言都过滤）", () => {
    const nick = validateNickname("我是测试屏蔽词", WORDS);
    expect(nick.ok).toBe(false);
    if (!nick.ok) {
      expect(nick.error).toBe("blocked");
      expect(nick.message).toMatch(/不适宜/);
    }
    const msg = validateMessage("来 blockedword 一下", WORDS);
    expect(msg.ok).toBe(false);
  });

  it("空词库（D-z7 未配置态）：仅长度校验放行", () => {
    expect(validateNickname("我是测试屏蔽词", []).ok).toBe(true);
    expect(validateNickname("x".repeat(21), []).ok).toBe(false);
  });
});

describe("loadFilterWords（kv_state 词库装载）", () => {
  it("正常数组装载；过滤非字符串/空串条目", async () => {
    const db = new FakeD1();
    await putStateRaw(
      db,
      FILTER_WORDS_STATE_KEY,
      JSON.stringify(["词一", "", 42, "词二"]),
      "2026-08-17T00:00:00Z",
    );
    expect(await loadFilterWords(db)).toEqual(["词一", "词二"]);
  });

  it("无记录 / 非法 JSON / 非数组 → 空词库降级", async () => {
    const db = new FakeD1();
    expect(await loadFilterWords(db)).toEqual([]);
    await putStateRaw(db, FILTER_WORDS_STATE_KEY, "not json", "x");
    expect(await loadFilterWords(db)).toEqual([]);
    await putStateRaw(db, FILTER_WORDS_STATE_KEY, '{"a":1}', "x");
    expect(await loadFilterWords(db)).toEqual([]);
  });
});
