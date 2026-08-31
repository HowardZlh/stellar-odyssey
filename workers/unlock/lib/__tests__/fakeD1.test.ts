/**
 * @jest-environment node
 *
 * FakeD1 引擎自检（对照 stock_analysis `tests/js/fake_d1.test.mjs` 移植）：
 * 约束仿真与 batch 事务语义是 Worker 接口测试可信度的前提。
 */
import { FakeD1, type FakeSchema } from "./helpers/fakeD1";

describe("FakeD1 引擎自检", () => {
  it("INSERT + SELECT 主键查询", async () => {
    const db = new FakeD1();
    await db
      .prepare(
        `INSERT INTO kv_state (k, v, updated_at) VALUES (?, ?, ?)`,
      )
      .bind("gate:config", '{"v":1}', "t1")
      .run();
    const row = await db
      .prepare("SELECT v, updated_at FROM kv_state WHERE k = ?")
      .bind("gate:config")
      .first();
    expect(row).toEqual({ v: '{"v":1}', updated_at: "t1" });
    expect(
      await db.prepare("SELECT * FROM kv_state WHERE k = ?").bind("X").first(),
    ).toBeNull();
  });

  it("主键/UNIQUE 冲突抛错", async () => {
    const db = new FakeD1();
    db.seed("orders", { id: "o1", ext_order_no: "e1" });
    await expect(
      db
        .prepare("INSERT INTO orders (id, ext_order_no) VALUES (?, ?)")
        .bind("o1", "e2")
        .run(),
    ).rejects.toThrow("UNIQUE constraint failed: orders.id");
    await expect(
      db
        .prepare("INSERT INTO orders (id, ext_order_no) VALUES (?, ?)")
        .bind("o2", "e1")
        .run(),
    ).rejects.toThrow("UNIQUE constraint failed: orders.ext_order_no");
  });

  it("INSERT OR REPLACE 覆盖同主键", async () => {
    const db = new FakeD1();
    await db
      .prepare("INSERT OR REPLACE INTO kv_state (k, v, updated_at) VALUES (?, ?, ?)")
      .bind("a", "1", "t1")
      .run();
    await db
      .prepare("INSERT OR REPLACE INTO kv_state (k, v, updated_at) VALUES (?, ?, ?)")
      .bind("a", "2", "t2")
      .run();
    expect(db.rows("kv_state")).toHaveLength(1);
    const row = await db
      .prepare("SELECT v FROM kv_state WHERE k = ?")
      .bind("a")
      .first<{ v: string }>();
    expect(row?.v).toBe("2");
  });

  it("UPDATE 条件更新并返回 changes", async () => {
    const db = new FakeD1();
    db.seed("revocations", { token_hash: "h1", restored: 0 });
    const r = await db
      .prepare(
        "UPDATE revocations SET restored = ?, reason = ? WHERE token_hash = ? AND restored = ?",
      )
      .bind(1, "undo", "h1", 0)
      .run();
    expect(r.meta?.changes).toBe(1);
    expect(db.rows("revocations")[0].reason).toBe("undo");
    const r2 = await db
      .prepare("UPDATE revocations SET restored = ? WHERE token_hash = ? AND restored = ?")
      .bind(1, "h1", 0)
      .run();
    expect(r2.meta?.changes).toBe(0); // 状态已变化，不再命中
  });

  it("DELETE 按条件删除", async () => {
    const db = new FakeD1();
    db.seed("kv_state", { k: "k1", v: "1", updated_at: "t" });
    db.seed("kv_state", { k: "k2", v: "2", updated_at: "t" });
    const r = await db.prepare("DELETE FROM kv_state WHERE k = ?").bind("k1").run();
    expect(r.meta?.changes).toBe(1);
    expect(db.rows("kv_state")).toHaveLength(1);
    expect(db.rows("kv_state")[0].k).toBe("k2");
  });

  it("AUTOINCREMENT 主键自动分配（自定义 schema，unique 缺省）", async () => {
    const schema: FakeSchema = {
      audit_log: { pk: "id", autoincrement: true },
    };
    const db = new FakeD1(schema);
    await db.prepare("INSERT INTO audit_log (kh, ts) VALUES (?, ?)").bind("k1", 1).run();
    await db.prepare("INSERT INTO audit_log (kh, ts) VALUES (?, ?)").bind("k2", 2).run();
    expect(db.rows("audit_log").map((r) => r.id)).toEqual([1, 2]);
    // 存量行主键非数字 → Number() 回退 0，不影响自增序列
    db.seed("audit_log", { id: "legacy", kh: "k0", ts: 0 });
    await db.prepare("INSERT INTO audit_log (kh, ts) VALUES (?, ?)").bind("k3", 3).run();
    expect(db.rows("audit_log").at(-1)?.id).toBe(3);
  });

  it("LEFT JOIN + ORDER BY DESC + LIMIT（M2 contributors 联查预置能力）", async () => {
    const db = new FakeD1();
    db.seed("orders", { id: "o1", ext_order_no: "e1", amount_cny: 6 });
    db.seed("contributors", {
      id: "c1",
      nickname: "A",
      channel: "afdian",
      created_at: "2026-08-01",
    });
    db.seed("contributors", {
      id: "c2",
      nickname: "B",
      channel: "alipay",
      created_at: "2026-08-02",
    });
    // contributors.id 无订单关联 → LEFT JOIN 右侧 NULL
    const { results } = await db
      .prepare(
        `SELECT c.nickname, c.created_at, o.amount_cny FROM contributors c
         LEFT JOIN orders o ON c.id = o.contributor_id
         ORDER BY c.created_at DESC LIMIT 500`,
      )
      .all();
    expect(results).toHaveLength(2);
    expect(results[0].nickname).toBe("B");
    expect(results[0].amount_cny).toBeNull();
  });

  it("LEFT JOIN 命中行取回联表字段", async () => {
    const db = new FakeD1();
    db.seed("contributors", { id: "c1", nickname: "A", created_at: "2026-08-01" });
    db.seed("orders", {
      id: "o1",
      ext_order_no: "e1",
      contributor_id: "c1",
      amount_cny: 15,
    });
    const { results } = await db
      .prepare(
        `SELECT c.nickname, o.amount_cny FROM contributors c
         LEFT JOIN orders o ON o.contributor_id = c.id`,
      )
      .all();
    expect(results).toEqual([{ nickname: "A", amount_cny: 15 }]);
  });

  it("ORDER BY 升序（缺省方向）与 SELECT *；相同排序键保持稳定", async () => {
    const db = new FakeD1();
    db.seed("revocations", { token_hash: "h2", revoked_at: "2026-08-02", restored: 0 });
    db.seed("revocations", { token_hash: "h1", revoked_at: "2026-08-01", restored: 0 });
    db.seed("revocations", { token_hash: "h3", revoked_at: "2026-08-02", restored: 0 });
    const { results } = await db
      .prepare("SELECT * FROM revocations ORDER BY revoked_at")
      .all();
    expect(results.map((r) => r.token_hash)).toEqual(["h1", "h2", "h3"]);
  });

  it("LEFT JOIN 无别名 + 裸列取自联表", async () => {
    const db = new FakeD1();
    db.seed("contributors", { id: "c1", nickname: "A", created_at: "t" });
    db.seed("contributors", { id: "c2", nickname: "B", created_at: "t" });
    db.seed("orders", { id: "o1", ext_order_no: "e1", contributor_id: "c1", amount_cny: 88 });
    const { results } = await db
      .prepare(
        `SELECT nickname, amount_cny FROM contributors
         LEFT JOIN orders ON orders.contributor_id = contributors.id`,
      )
      .all();
    // amount_cny 不在 contributors 行内 → 经联表行解析；无匹配 → NULL
    expect(results).toEqual([
      { nickname: "A", amount_cny: 88 },
      { nickname: "B", amount_cny: null },
    ]);
  });

  it("写路径 WHERE 支持表限定列名（a.b 形态）", async () => {
    const db = new FakeD1();
    db.seed("kv_state", { k: "a", v: "1", updated_at: "t" });
    const r = await db
      .prepare("DELETE FROM kv_state WHERE kv_state.k = ?")
      .bind("a")
      .run();
    expect(r.meta?.changes).toBe(1);
  });

  it("batch 事务语义：任一失败整体回滚", async () => {
    const db = new FakeD1();
    db.seed("revocations", { token_hash: "DUP" });
    await expect(
      db.batch([
        db.prepare("INSERT INTO orders (id, ext_order_no) VALUES (?, ?)").bind("o1", "e1"),
        db.prepare("INSERT INTO revocations (token_hash) VALUES (?)").bind("DUP"), // 冲突
      ]),
    ).rejects.toThrow(/UNIQUE constraint failed/);
    expect(db.rows("orders")).toHaveLength(0); // 第一条插入必须回滚
  });

  it("batch 成功：逐条结果返回", async () => {
    const db = new FakeD1();
    const out = await db.batch([
      db.prepare("INSERT INTO kv_state (k, v, updated_at) VALUES (?, ?, ?)").bind("a", "1", "t"),
      db.prepare("SELECT v FROM kv_state WHERE k = ?").bind("a"),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ success: true, meta: { changes: 1 } });
    expect(out[1]).toEqual({ success: true });
    expect(db.rows("kv_state")).toHaveLength(1);
  });

  it("拒绝字面量条件（强制参数绑定）", async () => {
    const db = new FakeD1();
    await expect(
      db.prepare("SELECT * FROM revocations WHERE restored = 0").all(),
    ).rejects.toThrow(/只允许参数绑定/);
  });

  it.each([
    ["未知写语句", "TRUNCATE TABLE orders", /不支持的写语句/],
    ["INSERT 值含字面量", "INSERT INTO kv_state (k, v) VALUES (?, 'x')", /只允许 \? 占位/],
    ["INSERT 列/参数不匹配", "INSERT INTO kv_state (k, v) VALUES (?)", /数量不匹配/],
    ["不支持的 SET 子句", "UPDATE kv_state SET v = v WHERE k = ?", /不支持的 SET 子句/],
  ])("非法语句防御（%s）→ 抛错", async (_l, sql, re) => {
    const db = new FakeD1();
    await expect(db.prepare(sql).bind("a").run()).rejects.toThrow(re);
  });

  it("不支持的查询形态 / 未知表 → 抛错", async () => {
    const db = new FakeD1();
    await expect(
      db.prepare("SELECT k FROM kv_state GROUP BY k").all(),
    ).rejects.toThrow(/不支持的查询/);
    await expect(db.prepare("SELECT * FROM nope").all()).rejects.toThrow(/未知表/);
  });

  it("比较运算符矩阵（<、<=、>、>=、!=、<>）", async () => {
    const db = new FakeD1();
    db.seed("revocations", { token_hash: "h1", exp: 100 });
    db.seed("revocations", { token_hash: "h2", exp: 200 });
    const count = async (sql: string, param: unknown): Promise<number> =>
      (await db.prepare(sql).bind(param).all()).results.length;
    expect(await count("SELECT * FROM revocations WHERE exp < ?", 150)).toBe(1);
    expect(await count("SELECT * FROM revocations WHERE exp <= ?", 200)).toBe(2);
    expect(await count("SELECT * FROM revocations WHERE exp > ?", 100)).toBe(1);
    expect(await count("SELECT * FROM revocations WHERE exp >= ?", 100)).toBe(2);
    expect(await count("SELECT * FROM revocations WHERE exp != ?", 100)).toBe(1);
    expect(await count("SELECT * FROM revocations WHERE exp <> ?", 100)).toBe(1);
  });

  it("ON CONFLICT DO UPDATE 原子累加：首插 → 建行，再插 → 逐列累加（G8）", async () => {
    const db = new FakeD1();
    const upsert =
      "INSERT INTO funnel_daily (d, lock_shown, lock_cta) VALUES (?, ?, ?) " +
      "ON CONFLICT(d) DO UPDATE SET lock_shown = lock_shown + excluded.lock_shown, " +
      "lock_cta = lock_cta + excluded.lock_cta";
    await db.prepare(upsert).bind("2026-08-31", 2, 1).run();
    expect(db.rows("funnel_daily")).toEqual([
      { d: "2026-08-31", lock_shown: 2, lock_cta: 1 },
    ]);
    await db.prepare(upsert).bind("2026-08-31", 3, 0).run();
    expect(db.rows("funnel_daily")).toEqual([
      { d: "2026-08-31", lock_shown: 5, lock_cta: 1 },
    ]);
    // 不同主键 → 新行互不影响
    await db.prepare(upsert).bind("2026-09-01", 1, 1).run();
    expect(db.rows("funnel_daily")).toHaveLength(2);
  });

  it.each([
    [
      "OR REPLACE 与 ON CONFLICT 同用",
      "INSERT OR REPLACE INTO funnel_daily (d, lock_shown) VALUES (?, ?) ON CONFLICT(d) DO UPDATE SET lock_shown = lock_shown + excluded.lock_shown",
      /OR REPLACE 与 ON CONFLICT 不可同用/,
    ],
    [
      "冲突列非主键",
      "INSERT INTO funnel_daily (d, lock_shown) VALUES (?, ?) ON CONFLICT(lock_shown) DO UPDATE SET lock_shown = lock_shown + excluded.lock_shown",
      /ON CONFLICT 列必须是主键/,
    ],
    [
      "SET 子句非同列自加",
      "INSERT INTO funnel_daily (d, lock_shown) VALUES (?, ?) ON CONFLICT(d) DO UPDATE SET lock_shown = lock_cta + excluded.lock_shown",
      /不支持的 DO UPDATE SET 子句/,
    ],
  ])("ON CONFLICT 防御（%s）→ 抛错", async (_l, sql, re) => {
    const db = new FakeD1();
    await expect(db.prepare(sql).bind("2026-08-31", 1).run()).rejects.toThrow(re);
  });

  it("run() 对 SELECT 语句也可执行（D1 行为对齐）", async () => {
    const db = new FakeD1();
    db.seed("kv_state", { k: "a", v: "1", updated_at: "t" });
    const r = await db.prepare("SELECT * FROM kv_state WHERE k = ?").bind("a").run();
    expect(r.success).toBe(true);
  });
});
