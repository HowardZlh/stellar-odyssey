/**
 * 内存版 D1 测试替身（Z 迭代 M1；自 stock_analysis
 * `tests/js/helpers/fake_d1.mjs`（提交 6d147cd，264 行）直译为 TS，
 * 勿重设计——引擎自检见同目录 `fakeD1.test.ts`）。
 *
 * 实现 D1 客户端最小面（lib/db.ts `UnlockDbLike`）：
 * prepare().bind().first()/all()/run() 与 batch()。
 * 只支持本项目实际使用的 SQL 子集（全部参数绑定，不支持字面量条件）：
 *   INSERT [OR REPLACE] INTO t (c1, ...) VALUES (?, ...)
 *     [ON CONFLICT(pk) DO UPDATE SET c1 = c1 + excluded.c1, ...]
 *     （G8 漏斗宽行原子累加专用形态，仅支持"自身 + excluded 同列"累加）
 *   SELECT <cols|*> FROM t [a] [LEFT JOIN t2 [b] ON a.c = b.c]
 *     [WHERE c <op> ? AND ...] [ORDER BY c [DESC|ASC]] [LIMIT n]
 *   UPDATE t SET c1 = ?, ... WHERE c <op> ? AND ...
 *   DELETE FROM t WHERE c <op> ? AND ...
 * 约束仿真：主键/UNIQUE 冲突抛错（OR REPLACE 覆盖），AUTOINCREMENT 主键
 * 自增；batch() 具备事务语义（任一失败整体回滚），与真实 D1 对齐。
 */
import type {
  UnlockDbLike,
  UnlockDbRunResult,
  UnlockDbStatement,
} from "../../db";

/** 行类型（内存表存储单元） */
export type FakeRow = Record<string, unknown>;

/** 表约束元数据 */
export interface FakeTableMeta {
  readonly pk?: string;
  readonly unique?: readonly string[];
  readonly autoincrement?: boolean;
}

export type FakeSchema = Record<string, FakeTableMeta>;

/** 与 migrations/0001_init.sql + 0002_funnel.sql 对齐的表约束 */
export const SCHEMA: FakeSchema = {
  orders: { pk: "id", unique: ["ext_order_no"] },
  contributors: { pk: "id", unique: [] },
  revocations: { pk: "token_hash", unique: [] },
  kv_state: { pk: "k", unique: [] },
  funnel_daily: { pk: "d", unique: [] },
};

function normalizeSql(sql: string): string {
  return String(sql).replace(/\s+/g, " ").trim().replace(/;$/, "");
}

type CondOp = "=" | "!=" | "<>" | "<" | "<=" | ">" | ">=";

const OPS: Record<CondOp, (a: unknown, b: unknown) => boolean> = {
  "=": (a, b) => a === b,
  "!=": (a, b) => a !== b,
  "<>": (a, b) => a !== b,
  "<": (a, b) => (a as number) < (b as number),
  "<=": (a, b) => (a as number) <= (b as number),
  ">": (a, b) => (a as number) > (b as number),
  ">=": (a, b) => (a as number) >= (b as number),
};

interface Cond {
  readonly col: string;
  readonly op: CondOp;
}

function parseConds(text: string): Cond[] {
  return text.split(/ AND /i).map((c) => {
    const m = /^([\w.]+)\s*(=|!=|<>|<=|>=|<|>)\s*\?$/.exec(c.trim());
    if (!m) throw new Error(`FakeD1: 不支持的条件（只允许参数绑定）: ${c}`);
    return { col: m[1], op: m[2] as CondOp };
  });
}

class FakeStatement implements UnlockDbStatement {
  private readonly db: FakeD1;
  private readonly sql: string;
  private params: readonly unknown[] = [];

  constructor(db: FakeD1, sql: string) {
    this.db = db;
    this.sql = normalizeSql(sql);
  }

  bind(...params: readonly unknown[]): UnlockDbStatement {
    this.params = params;
    return this;
  }

  async first<T = FakeRow>(): Promise<T | null> {
    const rows = this.db._select(this.sql, this.params);
    return rows.length > 0 ? (rows[0] as T) : null;
  }

  async all<T = FakeRow>(): Promise<{ results: T[] }> {
    return { results: this.db._select(this.sql, this.params) as T[] };
  }

  async run(): Promise<UnlockDbRunResult> {
    if (/^SELECT /i.test(this.sql)) {
      this.db._select(this.sql, this.params);
      return { success: true };
    }
    const changes = this.db._write(this.sql, this.params);
    return { success: true, meta: { changes } };
  }
}

export class FakeD1 implements UnlockDbLike {
  private readonly schema: FakeSchema;
  private tables: Record<string, FakeRow[]>;

  constructor(schema: FakeSchema = SCHEMA) {
    this.schema = schema;
    this.tables = {};
    for (const t of Object.keys(schema)) this.tables[t] = [];
  }

  prepare(sql: string): UnlockDbStatement {
    return new FakeStatement(this, sql);
  }

  async batch(
    statements: readonly UnlockDbStatement[],
  ): Promise<UnlockDbRunResult[]> {
    // 事务语义：快照 → 逐条执行 → 失败回滚
    const snapshot = JSON.parse(JSON.stringify(this.tables)) as Record<
      string,
      FakeRow[]
    >;
    const out: UnlockDbRunResult[] = [];
    try {
      for (const s of statements) out.push(await s.run());
    } catch (e) {
      this.tables = snapshot;
      throw e;
    }
    return out;
  }

  // 测试直连读写
  rows(table: string): FakeRow[] {
    return this._table(table);
  }

  seed(table: string, row: FakeRow): void {
    this._insert(table, { ...row }, false);
  }

  // -- 内部：写路径 ---------------------------------------------------------
  _write(sql: string, params: readonly unknown[]): number {
    let m =
      /^INSERT (OR REPLACE )?INTO (\w+) \(([^)]*)\) VALUES \(([^)]*)\)(?: ON CONFLICT\((\w+)\) DO UPDATE SET (.+))?$/i.exec(
        sql,
      );
    if (m) {
      const orReplace = Boolean(m[1]);
      const table = m[2];
      const cols = m[3].split(",").map((s) => s.trim());
      const slots = m[4].split(",").map((s) => s.trim());
      if (slots.some((s) => s !== "?")) {
        throw new Error(`FakeD1: INSERT VALUES 只允许 ? 占位: ${sql}`);
      }
      if (slots.length !== cols.length || params.length !== cols.length) {
        throw new Error(`FakeD1: INSERT 列/参数数量不匹配: ${sql}`);
      }
      const row: FakeRow = {};
      cols.forEach((c, i) => {
        row[c] = params[i];
      });
      if (m[5] !== undefined) {
        if (orReplace) {
          throw new Error(`FakeD1: OR REPLACE 与 ON CONFLICT 不可同用: ${sql}`);
        }
        this._upsertIncrement(table, row, m[5], m[6]);
        return 1;
      }
      this._insert(table, row, orReplace);
      return 1;
    }
    m = /^UPDATE (\w+) SET (.+?) WHERE (.+)$/i.exec(sql);
    if (m) {
      const table = this._table(m[1]);
      const sets = m[2].split(",").map((s) => {
        const sm = /^(\w+)\s*=\s*\?$/.exec(s.trim());
        if (!sm) throw new Error(`FakeD1: 不支持的 SET 子句: ${s}`);
        return sm[1];
      });
      const conds = parseConds(m[3]);
      const setParams = params.slice(0, sets.length);
      const condParams = params.slice(sets.length);
      let changes = 0;
      for (const row of table) {
        if (this._match(row, null, conds, condParams)) {
          sets.forEach((c, i) => {
            row[c] = setParams[i];
          });
          changes++;
        }
      }
      return changes;
    }
    m = /^DELETE FROM (\w+) WHERE (.+)$/i.exec(sql);
    if (m) {
      const name = m[1];
      const table = this._table(name);
      const conds = parseConds(m[2]);
      const keep = table.filter((row) => !this._match(row, null, conds, params));
      const changes = table.length - keep.length;
      this.tables[name] = keep;
      return changes;
    }
    throw new Error(`FakeD1: 不支持的写语句: ${sql}`);
  }

  private _insert(name: string, row: FakeRow, orReplace: boolean): void {
    const table = this._table(name); // 未知表已在此抛错 → schema 必有该表
    const meta: FakeTableMeta = this.schema[name];
    const pk = meta.pk;
    if (pk !== undefined && row[pk] == null && meta.autoincrement === true) {
      row[pk] =
        table.reduce((mx, r) => Math.max(mx, Number(r[pk]) || 0), 0) + 1;
    }
    if (pk !== undefined && row[pk] != null) {
      const idx = table.findIndex((r) => r[pk] === row[pk]);
      if (idx >= 0) {
        if (!orReplace) throw new Error(`UNIQUE constraint failed: ${name}.${pk}`);
        table[idx] = row;
        return;
      }
    }
    for (const u of meta.unique ?? []) {
      if (row[u] != null && table.some((r) => r[u] === row[u])) {
        throw new Error(`UNIQUE constraint failed: ${name}.${u}`);
      }
    }
    table.push(row);
  }

  /**
   * ON CONFLICT(pk) DO UPDATE 原子累加（G8 漏斗宽行专用形态）：
   * SET 子句只允许 `col = col + excluded.col`（同列自加，防语义漂移）；
   * 冲突列必须是 schema 声明的主键（与真实 D1 的冲突目标约束对齐）。
   */
  private _upsertIncrement(
    name: string,
    row: FakeRow,
    conflictCol: string,
    setText: string,
  ): void {
    const meta: FakeTableMeta | undefined = this.schema[name];
    if (meta?.pk !== conflictCol) {
      throw new Error(`FakeD1: ON CONFLICT 列必须是主键: ${name}.${conflictCol}`);
    }
    const incCols = setText.split(",").map((clause) => {
      const cm = /^(\w+)\s*=\s*(\w+)\s*\+\s*excluded\.(\w+)$/.exec(clause.trim());
      if (!cm || cm[1] !== cm[2] || cm[1] !== cm[3]) {
        throw new Error(`FakeD1: 不支持的 DO UPDATE SET 子句: ${clause}`);
      }
      return cm[1];
    });
    const table = this._table(name);
    const existing = table.find((r) => r[conflictCol] === row[conflictCol]);
    if (existing === undefined) {
      this._insert(name, row, false);
      return;
    }
    for (const col of incCols) {
      existing[col] = (Number(existing[col]) || 0) + (Number(row[col]) || 0);
    }
  }

  // -- 内部：读路径 ---------------------------------------------------------
  _select(sql: string, params: readonly unknown[]): FakeRow[] {
    const m = new RegExp(
      "^SELECT (.+?) FROM (\\w+)(?: (?!LEFT|WHERE|ORDER|LIMIT)(\\w+))?" +
        "(?: LEFT JOIN (\\w+)(?: (?!ON)(\\w+))? ON ([\\w.]+) = ([\\w.]+))?" +
        "(?: WHERE (.+?))?" +
        "(?: ORDER BY ([\\w.]+)( DESC| ASC)?)?" +
        "(?: LIMIT (\\d+))?$",
      "i",
    ).exec(sql);
    if (!m) throw new Error(`FakeD1: 不支持的查询: ${sql}`);
    const [
      ,
      colsText,
      baseName,
      baseAlias,
      joinName,
      joinAlias,
      onLeft,
      onRight,
      whereText,
      orderCol,
      orderDir,
      limit,
    ] = m;
    const aliases: Record<string, string> = { [baseAlias || baseName]: baseName };
    if (joinName) aliases[joinAlias || joinName] = joinName;

    const resolve = (
      qcol: string,
      baseRow: FakeRow,
      joinRow: FakeRow | null,
    ): unknown => {
      if (qcol.includes(".")) {
        const [a, c] = qcol.split(".");
        const t = aliases[a];
        if (t === baseName) return baseRow[c];
        return joinRow ? joinRow[c] : null;
      }
      if (qcol in baseRow) return baseRow[qcol];
      return joinRow ? joinRow[qcol] : null;
    };

    // 组装行（LEFT JOIN）
    let pairs: [FakeRow, FakeRow | null][] = this._table(baseName).map((r) => [
      r,
      null,
    ]);
    if (joinName) {
      const joinRows = this._table(joinName);
      pairs = pairs.map(([base]) => {
        const found = joinRows.find(
          (j) =>
            resolve(onLeft, base, j) === resolve(onRight, base, j) &&
            resolve(onLeft, base, j) != null,
        );
        return [base, found ?? null];
      });
    }

    // WHERE
    if (whereText) {
      const conds = parseConds(whereText);
      pairs = pairs.filter(([b, j]) => this._match(b, j, conds, params, resolve));
    }

    // ORDER BY
    if (orderCol) {
      const desc = /DESC/i.test(orderDir || "");
      pairs.sort((x, y) => {
        const a = resolve(orderCol, x[0], x[1]);
        const b = resolve(orderCol, y[0], y[1]);
        if (a === b) return 0;
        const cmp = (a as number) < (b as number) ? -1 : 1;
        return desc ? -cmp : cmp;
      });
    }

    // LIMIT
    if (limit) pairs = pairs.slice(0, parseInt(limit, 10));

    // 投影
    if (colsText.trim() === "*") {
      return pairs.map(([b]) => ({ ...b }));
    }
    const cols = colsText.split(",").map((s) => s.trim());
    return pairs.map(([b, j]) => {
      const out: FakeRow = {};
      for (const qc of cols) {
        const bare = qc.includes(".") ? qc.split(".")[1] : qc;
        out[bare] = resolve(qc, b, j) ?? null;
      }
      return out;
    });
  }

  private _match(
    baseRow: FakeRow,
    joinRow: FakeRow | null,
    conds: readonly Cond[],
    params: readonly unknown[],
    resolve?: (qcol: string, b: FakeRow, j: FakeRow | null) => unknown,
  ): boolean {
    return conds.every((c, i) => {
      const v = resolve
        ? resolve(c.col, baseRow, joinRow)
        : baseRow[c.col.includes(".") ? c.col.split(".")[1] : c.col];
      return OPS[c.op](v, params[i]);
    });
  }

  private _table(name: string): FakeRow[] {
    const table = this.tables[name];
    if (!table) throw new Error(`FakeD1: 未知表 ${name}`);
    return table;
  }
}
