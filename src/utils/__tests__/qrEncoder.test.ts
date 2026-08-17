/**
 * src/utils/qrEncoder.ts — QR 编码器结构自检（Z 迭代 M2，裁决 D7；
 * 校验向量与断言矩阵对照 stock_analysis `tests/js/qr.test.mjs`——
 * RS 纠错多项式求值归零（代数正确性）/ 数据位流回读（编码正确性）/
 * 功能图形与格式信息 BCH（结构正确性）/ 容量边界。
 * 真机扫码验证在 M2 上线验收（§9-6 真实 ¥6 周卡单）。
 */
import {
  qrCodewords,
  qrInternals,
  qrMatrix,
  renderQrToCanvas,
  type QrCanvasLike,
} from "@/utils/qrEncoder";
import { utf8Encode } from "@/utils/unlockToken";

const SAMPLES = [
  "HTTPS://QR.ALIPAY.COM/FKX000000000000000000000",
  "https://qr.alipay.com/bax08431lkmutnyi7c0d0017", // 真实形态码串
  "A", // 最小内容（版本 1）
  "https://qr.alipay.com/".repeat(8), // 长内容（高版本 + 多 RS 块）
];

describe("RS 纠错（代数正确性）", () => {
  it("每块码字多项式在 α^0..α^(ec-1) 求值归零", () => {
    const { gmul, EXP } = qrInternals;
    for (const text of SAMPLES) {
      const { blocks } = qrCodewords(text);
      for (const blk of blocks) {
        const cw = [...blk.data, ...blk.ec];
        const ecLen = blk.ec.length;
        for (let i = 0; i < ecLen; i++) {
          // syndrome_i = Σ cw[j] · (α^i)^(n-1-j)
          let s = 0;
          for (let j = 0; j < cw.length; j++) {
            let term = cw[j];
            const power = (i * (cw.length - 1 - j)) % 255;
            term = term === 0 ? 0 : gmul(term, EXP[power]);
            s ^= term;
          }
          expect(s).toBe(0);
        }
      }
    }
  });
});

describe("数据位流回读（编码正确性）", () => {
  it("模式/长度/内容与输入一致", () => {
    for (const text of SAMPLES) {
      const { version, blocks } = qrCodewords(text);
      // 还原数据码字（按块顺序拼接即编码顺序）
      const data = blocks.flatMap((b) => [...b.data]);
      let bitPos = 0;
      const readBits = (n: number): number => {
        let v = 0;
        for (let i = 0; i < n; i++) {
          v =
            (v << 1) |
            ((data[Math.floor(bitPos / 8)] >>> (7 - (bitPos % 8))) & 1);
          bitPos++;
        }
        return v;
      };
      expect(readBits(4)).toBe(4); // byte 模式指示符
      const len = readBits(version < 10 ? 8 : 16);
      const bytes = utf8Encode(text);
      expect(len).toBe(bytes.length); // 字符计数
      for (let i = 0; i < len; i++) {
        expect(readBits(8)).toBe(bytes[i]);
      }
    }
  });
});

describe("矩阵结构（结构正确性）", () => {
  it("尺寸/探测图形/时序图形/暗模块/无 null 残留", () => {
    for (const text of SAMPLES) {
      const { version } = qrCodewords(text);
      const m = qrMatrix(text);
      const size = version * 4 + 17;
      expect(m).toHaveLength(size);
      // 三个探测图形的中心 3x3 全暗、外一圈（距离 1）全亮
      for (const [r0, c0] of [
        [0, 0],
        [size - 7, 0],
        [0, size - 7],
      ]) {
        expect(m[r0 + 3][c0 + 3]).toBe(true);
        expect(m[r0 + 1][c0 + 1]).toBe(false);
        expect(m[r0][c0]).toBe(true);
        expect(m[r0 + 6][c0 + 6]).toBe(true);
      }
      // 时序图形交替
      for (let t = 8; t < size - 8; t++) {
        expect(m[6][t]).toBe(t % 2 === 0);
        expect(m[t][6]).toBe(t % 2 === 0);
      }
      // 固定暗模块
      expect(m[size - 8][8]).toBe(true);
      // 所有模块均已着色（无 null 残留）
      for (const row of m) {
        for (const cell of row) expect(typeof cell).toBe("boolean");
      }
    }
  });
});

describe("格式信息", () => {
  it("BCH(15,5) 自洽 + 纠错级为 M", () => {
    const { formatBits } = qrInternals;
    const m = qrMatrix(SAMPLES[1]);
    const size = m.length;
    // 从横排副本（行 8）回读 15 位格式信息
    let bits = 0;
    for (let i = 0; i < 15; i++) {
      let bit: boolean;
      if (i < 8) bit = m[8][size - i - 1];
      else if (i < 9) bit = m[8][15 - i - 1 + 1];
      else bit = m[8][15 - i - 1];
      if (bit) bits |= 1 << i;
    }
    const data5 = ((bits ^ 0x5412) >> 10) & 0x1f;
    expect(bits).toBe(formatBits(data5)); // 格式信息 BCH 校验
    expect((data5 >> 3) & 0x3).toBe(0); // 纠错级位应为 M（00）
  });
});

describe("容量边界", () => {
  it("超出版本 10 容量抛错；213 字节恰为版本 10", () => {
    expect(() => qrCodewords("x".repeat(214))).toThrow(/过长/);
    expect(qrCodewords("x".repeat(213)).version).toBe(10);
  });
});

describe("renderQrToCanvas（canvas 渲染）", () => {
  function mockCanvas(withCtx: boolean): {
    canvas: QrCanvasLike;
    fills: [number, number, number, number][];
  } {
    const fills: [number, number, number, number][] = [];
    const ctx = {
      fillStyle: "",
      fillRect: (x: number, y: number, w: number, h: number): void => {
        fills.push([x, y, w, h]);
      },
    };
    return {
      canvas: {
        width: 0,
        height: 0,
        getContext: () => (withCtx ? ctx : null),
      },
      fills,
    };
  }

  it("含 4 模块静区；底色整幅 + 暗模块逐格填充", () => {
    const { canvas, fills } = mockCanvas(true);
    renderQrToCanvas(canvas, SAMPLES[1], 220);
    const m = qrMatrix(SAMPLES[1]);
    const n = m.length + 8; // 静区 4 × 2
    const scale = Math.max(2, Math.floor(220 / n));
    expect(canvas.width).toBe(n * scale);
    expect(canvas.height).toBe(n * scale);
    // 首笔为整幅底色；其余为暗模块（数量一致）
    expect(fills[0]).toEqual([0, 0, n * scale, n * scale]);
    const darkCount = m.flat().filter(Boolean).length;
    expect(fills).toHaveLength(darkCount + 1);
  });

  it("getContext 为 null（jsdom/受限环境）：静默跳过不抛错", () => {
    const { canvas, fills } = mockCanvas(false);
    expect(() => renderQrToCanvas(canvas, "A")).not.toThrow();
    expect(fills).toHaveLength(0);
    expect(canvas.width).toBeGreaterThan(0); // 尺寸已设置
  });
});
