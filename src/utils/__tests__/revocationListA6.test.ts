/**
 * 吊销名单纯逻辑测试（A6-1，REQUIREMENTS_UNLOCK.md §A6-1 / §0.15 契约）：
 * 1) sanitizeRevocationList 消毒矩阵（合法/空/v≠1/条目字段逐项非法/
 *    null/数组/字符串/去重）
 * 2) unlockTokenHash 确定性与已知向量（NIST sha256("abc")）
 * 3) revocationHit 命中/未命中/空名单
 * 4) prunedRevocationList 边界（exp = now **含端点**清理，口径登记）
 */
import {
  emptyRevocationList,
  prunedRevocationList,
  revocationHit,
  sanitizeRevocationList,
  unlockTokenHash,
  type RevocationListV1,
} from "@/utils/revocationList";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function makeList(
  entries: RevocationListV1["entries"],
): RevocationListV1 {
  return { v: 1, entries };
}

describe("A6-1 sanitizeRevocationList 消毒矩阵", () => {
  it("合法名单：原样保留（含可选 reason）", () => {
    const raw = {
      v: 1,
      entries: [
        { h: HASH_A, exp: 100, at: "2026-08-14T00:00:00Z", reason: "refund" },
        { h: HASH_B, exp: 200, at: "2026-08-14T01:00:00Z" },
      ],
    };
    expect(sanitizeRevocationList(raw)).toEqual(raw);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["字符串", "junk"],
    ["数字", 42],
    ["数组", [{ h: HASH_A, exp: 1, at: "x" }]],
    ["v ≠ 1", { v: 2, entries: [] }],
    ["v 缺失", { entries: [] }],
    ["entries 非数组", { v: 1, entries: "nope" }],
    ["entries 缺失", { v: 1 }],
  ])("形状不符（%s）→ 空名单", (_name, raw) => {
    expect(sanitizeRevocationList(raw)).toEqual({ v: 1, entries: [] });
  });

  it.each([
    ["条目非对象", "junk"],
    ["条目为 null", null],
    ["h 缺失", { exp: 1, at: "x" }],
    ["h 非字符串", { h: 123, exp: 1, at: "x" }],
    ["h 长度不符", { h: "abc", exp: 1, at: "x" }],
    ["h 含大写（非法形状）", { h: "A".repeat(64), exp: 1, at: "x" }],
    ["h 含非 hex 字符", { h: "g".repeat(64), exp: 1, at: "x" }],
    ["exp 非数字", { h: HASH_A, exp: "1", at: "x" }],
    ["exp 非有限（NaN）", { h: HASH_A, exp: NaN, at: "x" }],
    ["exp 非有限（Infinity）", { h: HASH_A, exp: Infinity, at: "x" }],
    ["at 非字符串", { h: HASH_A, exp: 1, at: 42 }],
  ])("条目级非法（%s）→ 丢弃该条保留其余", (_name, bad) => {
    const good = { h: HASH_B, exp: 200, at: "2026-08-14T01:00:00Z" };
    expect(
      sanitizeRevocationList({ v: 1, entries: [bad, good] }),
    ).toEqual({ v: 1, entries: [good] });
  });

  it("reason 非字符串 → 略去该字段但保留条目", () => {
    const raw = {
      v: 1,
      entries: [{ h: HASH_A, exp: 1, at: "x", reason: 42 }],
    };
    expect(sanitizeRevocationList(raw)).toEqual({
      v: 1,
      entries: [{ h: HASH_A, exp: 1, at: "x" }],
    });
  });

  it("同哈希重复条目：按首现去重", () => {
    const first = { h: HASH_A, exp: 100, at: "first" };
    const dup = { h: HASH_A, exp: 999, at: "dup" };
    expect(sanitizeRevocationList({ v: 1, entries: [first, dup] })).toEqual({
      v: 1,
      entries: [first],
    });
  });

  it("emptyRevocationList：每次新实例（防共享可变引用）", () => {
    const a = emptyRevocationList();
    const b = emptyRevocationList();
    expect(a).toEqual({ v: 1, entries: [] });
    expect(a).not.toBe(b);
    expect(a.entries).not.toBe(b.entries);
  });
});

describe("A6-1 unlockTokenHash（sha256 hex 64 位小写）", () => {
  it("已知向量：sha256('abc')（NIST FIPS 180-2 测试向量）", () => {
    expect(unlockTokenHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("确定性：同输入恒同输出；形状 = hex 64 位小写", () => {
    const token = "SO1.eyJ2IjoxfQ.c2ln";
    const h1 = unlockTokenHash(token);
    expect(unlockTokenHash(token)).toBe(h1);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    // 不同输入不同哈希（雪崩性冒烟）
    expect(unlockTokenHash(`${token}x`)).not.toBe(h1);
  });

  it("非 ASCII 输入（UTF-8 编码路径）不抛异常且形状合法", () => {
    expect(unlockTokenHash("星海奥德赛✨")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("A6-1 revocationHit", () => {
  const list = makeList([
    { h: HASH_A, exp: 100, at: "x" },
    { h: HASH_B, exp: 200, at: "y" },
  ]);

  it("命中 / 未命中 / 空名单", () => {
    expect(revocationHit(list, HASH_A)).toBe(true);
    expect(revocationHit(list, HASH_B)).toBe(true);
    expect(revocationHit(list, "c".repeat(64))).toBe(false);
    expect(revocationHit(emptyRevocationList(), HASH_A)).toBe(false);
  });
});

describe("A6-1 prunedRevocationList（exp <= now 含端点清理）", () => {
  it("过期条目清理：exp < now 与 exp = now 均清理，exp > now 保留", () => {
    const list = makeList([
      { h: HASH_A, exp: 99, at: "past" },
      { h: HASH_B, exp: 100, at: "boundary" },
      { h: "c".repeat(64), exp: 101, at: "future" },
    ]);
    expect(prunedRevocationList(list, 100)).toEqual({
      v: 1,
      entries: [{ h: "c".repeat(64), exp: 101, at: "future" }],
    });
  });

  it("空名单：幂等返回空", () => {
    expect(prunedRevocationList(emptyRevocationList(), 0)).toEqual({
      v: 1,
      entries: [],
    });
  });
});
