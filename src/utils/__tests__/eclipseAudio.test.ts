/**
 * 日全食声景纯函数单测（E-M6-1，需求 §5）：
 * - 包络锚点：偏食段底噪全量、C2/C3 间近寂静（空气感垫层抬升）、
 *   渐弱/回归对称且单调、窗外恒为白日底噪；
 * - 提示音跨越判据：正向跨越触发、反向/跳变/未跨越不触发。
 */

import {
  AIR_BASE_GAIN,
  AIR_TOTALITY_GAIN,
  AMBIENT_FADE_SEC,
  CHIME_MAX_FRAME_SPAN_SEC,
  ECLIPSE_AMBIENT_PEAK_GAIN,
  eclipseChimeCrossing,
  eclipseSoundscapeGains,
  emptyEclipseSoundscapeGains,
} from "../eclipseAudio";
import type { EclipseContacts } from "../solarEclipseLab";

/** 测试接触点（相对秒；c2→c3 为 380s 全食段，2027 量级） */
const CONTACTS: EclipseContacts = {
  c1: 0,
  c2: 5000,
  max: 5190,
  c3: 5380,
  c4: 10000,
};

function gainsAt(tSec: number): { ambient01: number; air01: number } {
  return eclipseSoundscapeGains(tSec, CONTACTS, emptyEclipseSoundscapeGains());
}

describe("eclipseSoundscapeGains（§5 阶段包络）", () => {
  it("偏食段（渐弱窗之前）环境底噪全量、空气感为低垫层", () => {
    const g = gainsAt(CONTACTS.c2 - AMBIENT_FADE_SEC - 1);
    expect(g.ambient01).toBe(1);
    expect(g.air01).toBeCloseTo(AIR_BASE_GAIN, 10);
  });

  it("时间窗外（C1 前/C4 后）同为白日底噪", () => {
    expect(gainsAt(CONTACTS.c1 - 900).ambient01).toBe(1);
    expect(gainsAt(CONTACTS.c4 + 900).ambient01).toBe(1);
  });

  it("全食段近寂静：环境底噪 0、空气感抬升至 AIR_TOTALITY_GAIN（A8 非绝对静音）", () => {
    for (const t of [CONTACTS.c2, CONTACTS.max, CONTACTS.c3]) {
      const g = gainsAt(t);
      expect(g.ambient01).toBe(0);
      expect(g.air01).toBeCloseTo(AIR_TOTALITY_GAIN, 10);
    }
    expect(AIR_TOTALITY_GAIN).toBeGreaterThan(0);
  });

  it("C2 前渐弱单调、C3 后回归单调，且两侧对称", () => {
    let prev = gainsAt(CONTACTS.c2 - AMBIENT_FADE_SEC).ambient01;
    expect(prev).toBe(1);
    for (let dt = 1; dt <= AMBIENT_FADE_SEC; dt += 1) {
      const curr = gainsAt(CONTACTS.c2 - AMBIENT_FADE_SEC + dt).ambient01;
      expect(curr).toBeLessThanOrEqual(prev);
      // 对称性：C2 前 x 秒 与 C3 后 x 秒 包络等值
      const mirror = gainsAt(CONTACTS.c3 + AMBIENT_FADE_SEC - dt).ambient01;
      expect(mirror).toBeCloseTo(curr, 10);
      prev = curr;
    }
    expect(prev).toBe(0);
  });

  it("渐弱中点为半程量级（smoothstep 0.5）且空气感与底噪互补", () => {
    const g = gainsAt(CONTACTS.c2 - AMBIENT_FADE_SEC / 2);
    expect(g.ambient01).toBeCloseTo(0.5, 10);
    expect(g.air01).toBeCloseTo(
      AIR_BASE_GAIN + (AIR_TOTALITY_GAIN - AIR_BASE_GAIN) * 0.5,
      10,
    );
  });

  it("out 参复用（零 GC）：返回值即传入对象", () => {
    const out = emptyEclipseSoundscapeGains();
    expect(eclipseSoundscapeGains(CONTACTS.max, CONTACTS, out)).toBe(out);
  });

  it("峰值常量为正且不越界（引擎侧 0–1 钳制的合法输入）", () => {
    expect(ECLIPSE_AMBIENT_PEAK_GAIN).toBeGreaterThan(0);
    expect(ECLIPSE_AMBIENT_PEAK_GAIN).toBeLessThanOrEqual(1);
    expect(AIR_BASE_GAIN).toBeLessThan(AIR_TOTALITY_GAIN);
  });
});

describe("eclipseChimeCrossing（C2/C3 提示音触发判据）", () => {
  it("正向跨越接触时刻触发", () => {
    expect(
      eclipseChimeCrossing(CONTACTS.c2 - 0.5, CONTACTS.c2 + 0.5, CONTACTS.c2),
    ).toBe(true);
    // 恰好落在接触时刻（含端点）
    expect(
      eclipseChimeCrossing(CONTACTS.c2 - 0.5, CONTACTS.c2, CONTACTS.c2),
    ).toBe(true);
  });

  it("未跨越/同帧不触发", () => {
    expect(
      eclipseChimeCrossing(CONTACTS.c2 + 0.1, CONTACTS.c2 + 0.2, CONTACTS.c2),
    ).toBe(false);
    expect(eclipseChimeCrossing(CONTACTS.c2, CONTACTS.c2, CONTACTS.c2)).toBe(
      false,
    );
  });

  it("反向（seek 回拖）不触发", () => {
    expect(
      eclipseChimeCrossing(CONTACTS.c2 + 1, CONTACTS.c2 - 1, CONTACTS.c2),
    ).toBe(false);
  });

  it("帧跨度超限（scrubber 大跳/页签切换）不补播", () => {
    expect(
      eclipseChimeCrossing(
        CONTACTS.c2 - CHIME_MAX_FRAME_SPAN_SEC,
        CONTACTS.c2 + 1,
        CONTACTS.c2,
      ),
    ).toBe(false);
    // 边界内（≤ 上限）正常触发
    expect(
      eclipseChimeCrossing(
        CONTACTS.c2 - 1,
        CONTACTS.c2 + CHIME_MAX_FRAME_SPAN_SEC - 1,
        CONTACTS.c2,
      ),
    ).toBe(true);
  });
});
