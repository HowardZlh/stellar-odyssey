/**
 * 纯 TS QR 编码器（自包含，零依赖）——支付宝当面付 qr_code 码串前端渲染用
 * （Z 迭代 M2，裁决 D7：自 stock_analysis `assets/js/qr.js`（417 行，提交
 * 126eabe，真机扫码验收）机械翻译为 TS，算法勿优化勿重写）。
 *
 * 范围：byte 模式 / 纠错级 M / 版本 1~10 自动选择 / 8 种掩码按标准罚分择优。
 * 算法为 ISO/IEC 18004 标准实现（参照 MIT 许可的 qrcode-generator 结构重写）；
 * 结构自检测试见 `__tests__/qrEncoder.test.ts`（RS 校验多项式求值归零 +
 * 位流回读，向量对照 stock `tests/js/qr.test.mjs`）。
 *
 * 环境无关纪律：除 render 的 canvas 参数（最小结构化接口，jsdom 下
 * getContext 为 null 时静默跳过）外无浏览器专属 API；UTF-8 编码复用
 * unlockToken 的自实现纯函数（偏离 stock 的 TextEncoder 登记：jsdom
 * 测试环境无 TextEncoder，与本项目环境无关纪律一致）。
 */
import { utf8Encode } from "./unlockToken";

// ── GF(256)，本原多项式 0x11d ──
const EXP: number[] = new Array(512);
const LOG: number[] = new Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
})();

function gmul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** RS 生成多项式 Π(x - α^i), i=0..ec-1（系数高次在前） */
function rsPoly(ec: number): number[] {
  let p = [1];
  for (let i = 0; i < ec; i++) {
    const np: number[] = new Array(p.length + 1).fill(0);
    for (let j = 0; j < p.length; j++) {
      np[j] ^= p[j];
      np[j + 1] ^= gmul(p[j], EXP[i]);
    }
    p = np;
  }
  return p;
}

/** RS 纠错码：data · x^ec mod gen */
function rsRemainder(data: readonly number[], ec: number): number[] {
  const gen = rsPoly(ec);
  const res = data.slice();
  for (let k = 0; k < ec; k++) res.push(0);
  for (let i = 0; i < data.length; i++) {
    const factor = res[i];
    if (factor === 0) continue;
    for (let j = 1; j < gen.length; j++) {
      res[i + j] ^= gmul(gen[j], factor);
    }
    res[i] = 0;
  }
  return res.slice(data.length);
}

// ── 纠错级 M 的 RS 分块表 v1~10：[块数, 块总码字, 块数据码字, ...] ──
const RS_BLOCKS_M: Record<number, readonly number[]> = {
  1: [1, 26, 16],
  2: [1, 44, 28],
  3: [1, 70, 44],
  4: [2, 50, 32],
  5: [2, 67, 43],
  6: [4, 43, 27],
  7: [4, 49, 31],
  8: [2, 60, 38, 2, 61, 39],
  9: [3, 58, 36, 2, 59, 37],
  10: [4, 69, 43, 1, 70, 44],
};

/** 对齐图形中心坐标 v1~10 */
const ALIGN_POS: Record<number, readonly number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

interface RsBlockSpec {
  readonly total: number;
  readonly data: number;
}

function rsBlocksOf(version: number): RsBlockSpec[] {
  const raw = RS_BLOCKS_M[version];
  const out: RsBlockSpec[] = [];
  for (let i = 0; i < raw.length; i += 3) {
    for (let c = 0; c < raw[i]; c++) {
      out.push({ total: raw[i + 1], data: raw[i + 2] });
    }
  }
  return out;
}

function dataCapacityBytes(version: number): number {
  let bits = 0;
  const blocks = rsBlocksOf(version);
  for (const blk of blocks) bits += blk.data * 8;
  const cci = version < 10 ? 8 : 16; // byte 模式字符计数位：v1-9 为 8 位
  return Math.floor((bits - 4 - cci) / 8);
}

function utf8Bytes(text: string): number[] {
  return Array.from(utf8Encode(text));
}

// ── 位流缓冲 ──
class BitBuffer {
  buffer: number[] = [];
  length = 0;

  put(num: number, len: number): void {
    for (let i = len - 1; i >= 0; i--) this.putBit(((num >>> i) & 1) === 1);
  }

  putBit(bit: boolean): void {
    if (this.length === this.buffer.length * 8) this.buffer.push(0);
    if (bit) {
      this.buffer[Math.floor(this.length / 8)] |= 0x80 >>> this.length % 8;
    }
    this.length++;
  }
}

/** 单 RS 块（结构自检测试消费） */
export interface QrBlock {
  readonly data: readonly number[];
  readonly ec: readonly number[];
}

/** 编码结果：版本 / 分块 / 交织后的全部码字 */
export interface QrCodewords {
  readonly version: number;
  readonly blocks: readonly QrBlock[];
  readonly interleaved: readonly number[];
}

/** 编码：文本 → 交织后的全部码字 */
export function qrCodewords(text: string): QrCodewords {
  const bytes = utf8Bytes(text);
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    if (bytes.length <= dataCapacityBytes(v)) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error("QR: 内容过长 (超出版本 10 / ECC M 容量)");

  const blocks = rsBlocksOf(version);
  let totalData = 0;
  for (const blk of blocks) totalData += blk.data;

  const bb = new BitBuffer();
  bb.put(4, 4); // byte 模式指示符 0100
  bb.put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) bb.put(b, 8);
  // 终止符（最多 4 个 0）
  const maxBits = totalData * 8;
  bb.put(0, Math.min(4, maxBits - bb.length));
  if (bb.length % 8 !== 0) bb.put(0, 8 - (bb.length % 8));
  // 填充码字 0xEC / 0x11 交替
  let pad = true;
  while (bb.length < maxBits) {
    bb.put(pad ? 0xec : 0x11, 8);
    pad = !pad;
  }

  // 分块 + RS 纠错
  let offset = 0;
  const dc: number[][] = [];
  const ec: number[][] = [];
  let maxDc = 0;
  let maxEc = 0;
  for (const blk of blocks) {
    const dLen = blk.data;
    const eLen = blk.total - dLen;
    const data = bb.buffer.slice(offset, offset + dLen);
    offset += dLen;
    dc.push(data);
    ec.push(rsRemainder(data, eLen));
    maxDc = Math.max(maxDc, dLen);
    maxEc = Math.max(maxEc, eLen);
  }

  // 交织
  const all: number[] = [];
  for (let di = 0; di < maxDc; di++) {
    for (let bi = 0; bi < dc.length; bi++) {
      if (di < dc[bi].length) all.push(dc[bi][di]);
    }
  }
  for (let ei = 0; ei < maxEc; ei++) {
    for (let bj = 0; bj < ec.length; bj++) {
      if (ei < ec[bj].length) all.push(ec[bj][ei]);
    }
  }
  return {
    version,
    blocks: blocks.map((_, idx) => ({ data: dc[idx], ec: ec[idx] })),
    interleaved: all,
  };
}

// ── BCH：格式信息 (15,5) 与版本信息 (18,6) ──
const G15 = 0x537;
const G15_MASK = 0x5412;
const G18 = 0x1f25;

function bchDigit(d: number): number {
  let n = 0;
  while (d !== 0) {
    n++;
    d >>>= 1;
  }
  return n;
}

/** data5 = (纠错级位 << 3) | 掩码号；M 级位 = 00 */
function formatBits(data5: number): number {
  let d = data5 << 10;
  while (bchDigit(d) - bchDigit(G15) >= 0) {
    d ^= G15 << (bchDigit(d) - bchDigit(G15));
  }
  return ((data5 << 10) | d) ^ G15_MASK;
}

function versionBits(version: number): number {
  let d = version << 12;
  while (bchDigit(d) - bchDigit(G18) >= 0) {
    d ^= G18 << (bchDigit(d) - bchDigit(G18));
  }
  return (version << 12) | d;
}

// ── 掩码函数（标准 8 种）──
const MASKS: readonly ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** 组装中矩阵单元：null = 未着色 */
type Cell = boolean | null;

// ── 矩阵组装 ──
function buildMatrix(
  version: number,
  codewords: readonly number[],
  maskIdx: number,
): boolean[][] {
  const size = version * 4 + 17;
  const m: Cell[][] = [];
  for (let r = 0; r < size; r++) {
    m.push(new Array<Cell>(size).fill(null));
  }

  function setFinder(row: number, col: number): void {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = row + dr;
        const cc = col + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const dark =
          (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
          (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
          (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
        m[rr][cc] = dark;
      }
    }
  }
  setFinder(0, 0);
  setFinder(size - 7, 0);
  setFinder(0, size - 7);

  // 对齐图形
  const pos = ALIGN_POS[version];
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      const row = pos[i];
      const col = pos[j];
      if (m[row][col] !== null) continue; // 与探测图形重叠处跳过
      for (let ar = -2; ar <= 2; ar++) {
        for (let ac = -2; ac <= 2; ac++) {
          m[row + ar][col + ac] = Math.max(Math.abs(ar), Math.abs(ac)) !== 1;
        }
      }
    }
  }

  // 时序图形
  for (let t = 8; t < size - 8; t++) {
    if (m[t][6] === null) m[t][6] = t % 2 === 0;
    if (m[6][t] === null) m[6][t] = t % 2 === 0;
  }

  // 格式信息（纠错级 M = 00）
  const fbits = formatBits((0 << 3) | maskIdx);
  for (let fi = 0; fi < 15; fi++) {
    const fbit = ((fbits >> fi) & 1) === 1;
    // 竖排（列 8）
    if (fi < 6) m[fi][8] = fbit;
    else if (fi < 8) m[fi + 1][8] = fbit;
    else m[size - 15 + fi][8] = fbit;
    // 横排（行 8）
    if (fi < 8) m[8][size - fi - 1] = fbit;
    else if (fi < 9) m[8][15 - fi - 1 + 1] = fbit;
    else m[8][15 - fi - 1] = fbit;
  }
  m[size - 8][8] = true; // 固定暗模块

  // 版本信息（v>=7）
  if (version >= 7) {
    const vbits = versionBits(version);
    for (let vi = 0; vi < 18; vi++) {
      const vbit = ((vbits >> vi) & 1) === 1;
      m[Math.floor(vi / 3)][(vi % 3) + size - 8 - 3] = vbit;
      m[(vi % 3) + size - 8 - 3][Math.floor(vi / 3)] = vbit;
    }
  }

  // 数据布设（右下起之字形，跳过第 6 列）
  let inc = -1;
  let drow = size - 1;
  let bitIndex = 7;
  let byteIndex = 0;
  const mask = MASKS[maskIdx];
  for (let dcol = size - 1; dcol > 0; dcol -= 2) {
    if (dcol === 6) dcol--;
    for (;;) {
      for (let cc2 = 0; cc2 < 2; cc2++) {
        const col2 = dcol - cc2;
        if (m[drow][col2] === null) {
          let dark2 = false;
          if (byteIndex < codewords.length) {
            dark2 = ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
          }
          if (mask(drow, col2)) dark2 = !dark2;
          m[drow][col2] = dark2;
          bitIndex--;
          if (bitIndex === -1) {
            byteIndex++;
            bitIndex = 7;
          }
        }
      }
      drow += inc;
      if (drow < 0 || drow >= size) {
        drow -= inc;
        inc = -inc;
        break;
      }
    }
  }
  return m as boolean[][];
}

// ── 掩码罚分（标准 N1~N4）──
function penalty(m: readonly (readonly boolean[])[]): number {
  const size = m.length;
  let score = 0;
  let r: number;
  let c: number;
  // N1：行/列连续同色 >=5
  for (let dir = 0; dir < 2; dir++) {
    for (r = 0; r < size; r++) {
      let run = 1;
      for (c = 1; c < size; c++) {
        const cur = dir ? m[c][r] : m[r][c];
        const prev = dir ? m[c - 1][r] : m[r][c - 1];
        if (cur === prev) {
          run++;
          if (c === size - 1 && run >= 5) score += 3 + run - 5;
        } else {
          if (run >= 5) score += 3 + run - 5;
          run = 1;
        }
      }
    }
  }
  // N2：2x2 同色块
  for (r = 0; r < size - 1; r++) {
    for (c = 0; c < size - 1; c++) {
      if (
        m[r][c] === m[r][c + 1] &&
        m[r][c] === m[r + 1][c] &&
        m[r][c] === m[r + 1][c + 1]
      ) {
        score += 3;
      }
    }
  }
  // N3：1011101 前/后带 0000 的类探测图形
  const pat1 = [
    true,
    false,
    true,
    true,
    true,
    false,
    true,
    false,
    false,
    false,
    false,
  ];
  const pat2 = pat1.slice().reverse();
  function hasPattern(
    get: (a: number, i: number) => boolean,
    len: number,
  ): void {
    for (let a = 0; a < size; a++) {
      for (let s = 0; s + len <= size; s++) {
        let hit1 = true;
        let hit2 = true;
        for (let p = 0; p < len; p++) {
          if (get(a, s + p) !== pat1[p]) hit1 = false;
          if (get(a, s + p) !== pat2[p]) hit2 = false;
        }
        if (hit1 || hit2) score += 40;
      }
    }
  }
  hasPattern((a, i) => m[a][i], pat1.length);
  hasPattern((a, i) => m[i][a], pat1.length);
  // N4：暗模块占比偏离 50%
  let dark = 0;
  for (r = 0; r < size; r++) {
    for (c = 0; c < size; c++) if (m[r][c]) dark++;
  }
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

/** 文本 → 最优掩码矩阵（true = 暗模块） */
export function qrMatrix(text: string): boolean[][] {
  const cw = qrCodewords(text);
  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mi = 0; mi < 8; mi++) {
    const m = buildMatrix(cw.version, cw.interleaved, mi);
    const s = penalty(m);
    if (s < bestScore) {
      bestScore = s;
      best = m;
    }
  }
  return best as boolean[][];
}

/** 2D 上下文最小面（fillStyle 放宽 DOM 联合类型，与 HTMLCanvasElement 兼容） */
export interface QrCanvasContextLike {
  fillStyle: unknown;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/** canvas 最小结构化接口（测试可注入 mock；jsdom 下 getContext 为 null） */
export interface QrCanvasLike {
  width: number;
  height: number;
  getContext(id: "2d"): QrCanvasContextLike | null;
}

/**
 * canvas 渲染（含 4 模块静区），pixelSize 为目标边长像素；
 * getContext 返回 null（jsdom/受限环境）时静默跳过（尺寸已设置）。
 */
export function renderQrToCanvas(
  canvas: QrCanvasLike,
  text: string,
  pixelSize?: number,
): void {
  const m = qrMatrix(text);
  const quiet = 4;
  const n = m.length + quiet * 2;
  const scale = Math.max(2, Math.floor((pixelSize || 220) / n));
  const px = n * scale;
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = "#000";
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m.length; c++) {
      if (m[r][c]) {
        ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    }
  }
}

/** 结构自检测试内部面（对照 stock `QR._internals`，勿在业务代码消费） */
export const qrInternals = {
  rsRemainder,
  gmul,
  EXP,
  LOG,
  formatBits,
} as const;
