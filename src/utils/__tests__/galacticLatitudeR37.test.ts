/**
 * R3-7 银河系整体垂直展开纯逻辑单测（IMPROVEMENT_REQUIREMENTS_3 §7.1/§7.2）：
 * 盘 morph 权重映射与钳制、shader 公式 CPU 镜像（恒等/符号/单调/核球下限/
 * 常量同源）、银晕增亮/尘埃带渐隐因子、uEll+uExpand 组合权重镜像断言，
 * 以及超新星渲染/解析同源（展开态飞往超新星落点与渲染一致）。
 */

import type { SupernovaEvent } from '@/types';
import {
  DISK_MORPH_AXIS_RATIO,
  DISK_MORPH_HEIGHT_REF_LY,
  DISK_MORPH_MIN_RADIUS_LY,
  GALAXY_EXPAND_GAIN_DEFAULT,
  GALAXY_EXPAND_GAIN_MAX,
  HALO_EXPAND_BOOST_MAX,
  combinedMorphWeight,
  diskMorphWeight,
  dustLaneExpandFade,
  haloExpandBoost,
  morphGalacticYLy,
} from '@/utils/galacticLatitude';
import {
  computeGalacticFramePose,
  resetRenderedGalacticFrame,
  setRenderedGalacticFrame,
  tiltAroundX,
} from '@/utils/galacticFrame';
import { supernovaFocusTarget } from '@/utils/cameraFocus';
import { SCENE_UNITS_PER_LY } from '@/utils/scale';

describe('diskMorphWeight（生效增益 → 盘 morph 权重映射，§7.1-A）', () => {
  it('×1 → 0（不 morph）、默认 ×3 → 0.4（中等椭球）、×6 → 1.0（完整椭球）', () => {
    expect(diskMorphWeight(1)).toBe(0);
    expect(diskMorphWeight(GALAXY_EXPAND_GAIN_DEFAULT)).toBeCloseTo(0.4, 10);
    expect(diskMorphWeight(GALAXY_EXPAND_GAIN_MAX)).toBe(1);
  });

  it('效果图确认值：×5.25 → 0.85', () => {
    expect(diskMorphWeight(5.25)).toBeCloseTo(0.85, 10);
  });

  it('域外输入钳制到 [0,1]（增益 <1 或 >6 不越界）', () => {
    expect(diskMorphWeight(0.5)).toBe(0);
    expect(diskMorphWeight(7)).toBe(1);
  });

  it('权重随增益单调不减', () => {
    let prev = -1;
    for (let g = 1; g <= 6; g += 0.5) {
      const w = diskMorphWeight(g);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
  });

  it('非有限输入抛 RangeError', () => {
    expect(() => diskMorphWeight(NaN)).toThrow(RangeError);
    expect(() => diskMorphWeight(Infinity)).toThrow(RangeError);
  });
});

describe('morphGalacticYLy（shader 椭球公式 CPU 镜像，§7.1-A）', () => {
  it('与 shader 常量同源：500 / 6000 / 0.5', () => {
    expect(DISK_MORPH_HEIGHT_REF_LY).toBe(500);
    expect(DISK_MORPH_MIN_RADIUS_LY).toBe(6000);
    expect(DISK_MORPH_AXIS_RATIO).toBe(0.5);
  });

  it('morph01=0 恒等', () => {
    expect(morphGalacticYLy(300, 20000, 0)).toBe(300);
    expect(morphGalacticYLy(-150, 8000, 0)).toBe(-150);
  });

  it('y=0 恒等（银心/盘中平面不动，任意权重）', () => {
    expect(morphGalacticYLy(0, 26000, 1)).toBe(0);
    expect(morphGalacticYLy(0, 0, 0.4)).toBe(0);
  });

  it('公式逐字镜像：mix(y, (y/500)·max(r,6000)·0.5, m)', () => {
    const y = 220;
    const r = 24000;
    const m = 0.4;
    const target = (y / 500) * Math.max(r, 6000) * 0.5;
    expect(morphGalacticYLy(y, r, m)).toBeCloseTo(y + (target - y) * m, 10);
  });

  it('符号保留（盘上/盘下关系不变）', () => {
    expect(morphGalacticYLy(300, 20000, 0.7)).toBeGreaterThan(0);
    expect(morphGalacticYLy(-300, 20000, 0.7)).toBeLessThan(0);
  });

  it('|y| 随权重单调放大（水平半径 ≥ 1,000 ly 时目标 ≥ 原值）', () => {
    let prev = 0;
    for (const m of [0, 0.25, 0.5, 0.75, 1]) {
      const abs = Math.abs(morphGalacticYLy(-260, 15000, m));
      expect(abs).toBeGreaterThanOrEqual(prev);
      prev = abs;
    }
  });

  it('核球区最小水平半径下限 6,000 ly（r<6000 与 r=6000 同目标）', () => {
    expect(morphGalacticYLy(200, 1500, 1)).toBe(morphGalacticYLy(200, 6000, 1));
    // 满权重完整椭球：目标 = (y/500)·6000·0.5 = y·6
    expect(morphGalacticYLy(200, 1500, 1)).toBeCloseTo(1200, 10);
  });

  it('非法输入抛 RangeError（非有限 / 负半径 / 权重越界）', () => {
    expect(() => morphGalacticYLy(NaN, 1, 0)).toThrow(RangeError);
    expect(() => morphGalacticYLy(0, -1, 0)).toThrow(RangeError);
    expect(() => morphGalacticYLy(0, Infinity, 0)).toThrow(RangeError);
    expect(() => morphGalacticYLy(0, 1, -0.1)).toThrow(RangeError);
    expect(() => morphGalacticYLy(0, 1, 1.1)).toThrow(RangeError);
  });
});

describe('haloExpandBoost / dustLaneExpandFade（展开态联动因子，§7.1-C）', () => {
  it('银晕增亮：0 → 1（无增亮）、1 → 1.3（+30%）、0.4 → 1.12', () => {
    expect(HALO_EXPAND_BOOST_MAX).toBe(0.3);
    expect(haloExpandBoost(0)).toBe(1);
    expect(haloExpandBoost(1)).toBeCloseTo(1.3, 10);
    expect(haloExpandBoost(0.4)).toBeCloseTo(1.12, 10);
  });

  it('尘埃带渐隐：0 → 1（不渐隐）、1 → 0（完全隐去）、0.4 → 0.6', () => {
    expect(dustLaneExpandFade(0)).toBe(1);
    expect(dustLaneExpandFade(1)).toBe(0);
    expect(dustLaneExpandFade(0.4)).toBeCloseTo(0.6, 10);
  });

  it('权重越界抛 RangeError', () => {
    expect(() => haloExpandBoost(-0.1)).toThrow(RangeError);
    expect(() => haloExpandBoost(1.1)).toThrow(RangeError);
    expect(() => haloExpandBoost(NaN)).toThrow(RangeError);
    expect(() => dustLaneExpandFade(-0.1)).toThrow(RangeError);
    expect(() => dustLaneExpandFade(1.1)).toThrow(RangeError);
    expect(() => dustLaneExpandFade(NaN)).toThrow(RangeError);
  });
});

describe('combinedMorphWeight（uEll + uExpand 同目标顺序 mix 组合，§7.1-D）', () => {
  const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

  it('顺序 mix 镜像断言：mix(mix(y,T,a),T,b) = mix(y,T,1−(1−a)(1−b))', () => {
    const y = 320;
    const T = (y / 500) * 26000 * 0.5;
    for (const [a, b] of [
      [0, 0],
      [0.3, 0.5],
      [1, 0.4],
      [0.4, 1],
      [0.85, 0.85],
    ] as const) {
      const sequential = mix(mix(y, T, a), T, b);
      const combined = mix(y, T, combinedMorphWeight(a, b));
      expect(sequential).toBeCloseTo(combined, 10);
    }
  });

  it('终态 Milkomeda（uEll=1）组合权重恒 1：不受 V 开关破坏', () => {
    expect(combinedMorphWeight(1, 0)).toBe(1);
    expect(combinedMorphWeight(1, 1)).toBe(1);
    expect(combinedMorphWeight(1, 0.4)).toBe(1);
  });

  it('任一权重越界抛 RangeError', () => {
    expect(() => combinedMorphWeight(-0.1, 0)).toThrow(RangeError);
    expect(() => combinedMorphWeight(0, 1.1)).toThrow(RangeError);
    expect(() => combinedMorphWeight(NaN, 0)).toThrow(RangeError);
  });
});

describe('超新星随盘 morph 渲染/解析同源（§7.1-B，行为变更）', () => {
  afterEach(() => resetRenderedGalacticFrame());

  const EVENT: SupernovaEvent = {
    id: 'sn-r37',
    positionLy: { x: 20000, y: 180, z: -8000 },
    progenitorMassSun: 18,
    startedAtMs: 0,
    durationSec: 20,
  };

  /**
   * 独立镜像渲染路径：Supernova.tsx 定位（银心系 positionLy，y 通道经
   * morphGalacticYLy）→ Galaxy 组倾斜 + groupOffset 平移 → 世界坐标
   */
  function renderedWorldPos(
    simDays: number,
    expandGain: number,
    weight: number,
  ): { x: number; y: number; z: number } {
    const p = EVENT.positionLy;
    const morph01 = diskMorphWeight(expandGain);
    const local = {
      x: p.x * SCENE_UNITS_PER_LY,
      y: morphGalacticYLy(p.y, Math.hypot(p.x, p.z), morph01) * SCENE_UNITS_PER_LY,
      z: p.z * SCENE_UNITS_PER_LY,
    };
    const pose = computeGalacticFramePose({
      simDays,
      galacticCenterWeight: weight,
      verticalGain: 1,
    });
    const tilted = tiltAroundX(local);
    return {
      x: tilted.x + pose.groupOffset.x,
      y: tilted.y + pose.groupOffset.y,
      z: tilted.z + pose.groupOffset.z,
    };
  }

  it('展开态（×3 / ×6）飞往超新星落点与渲染路径一致', () => {
    const simDays = 8.4e9;
    for (const expandGain of [3, 6]) {
      setRenderedGalacticFrame(0, 1, expandGain);
      const target = supernovaFocusTarget(EVENT, simDays);
      const rendered = renderedWorldPos(simDays, expandGain, 0);
      expect(target.position.x).toBeCloseTo(rendered.x, 6);
      expect(target.position.y).toBeCloseTo(rendered.y, 6);
      expect(target.position.z).toBeCloseTo(rendered.z, 6);
    }
  });

  it('银心固定模式（w=1）展开态两路径仍一致', () => {
    const simDays = 4.2e10;
    setRenderedGalacticFrame(1, 1, 4.5);
    const target = supernovaFocusTarget(EVENT, simDays);
    const rendered = renderedWorldPos(simDays, 4.5, 1);
    expect(target.position.x).toBeCloseTo(rendered.x, 6);
    expect(target.position.y).toBeCloseTo(rendered.y, 6);
    expect(target.position.z).toBeCloseTo(rendered.z, 6);
  });

  it('增益 ×1（morph=0）解析与历史行为一致（恒等，零回退）', () => {
    const simDays = 8.4e9;
    setRenderedGalacticFrame(0, 1, 1);
    const target = supernovaFocusTarget(EVENT, simDays);
    const rendered = renderedWorldPos(simDays, 1, 0);
    expect(target.position.y).toBeCloseTo(rendered.y, 6);
    // morph=0 时 y 通道未被抬升（镜像恒等断言）
    expect(morphGalacticYLy(EVENT.positionLy.y, Math.hypot(20000, -8000), 0)).toBe(
      EVENT.positionLy.y,
    );
  });

  it('展开态解析 y 相对未展开显著抬升（生效验证）', () => {
    const simDays = 0;
    setRenderedGalacticFrame(0, 1, 1);
    const base = supernovaFocusTarget(EVENT, simDays);
    setRenderedGalacticFrame(0, 1, 6);
    const expanded = supernovaFocusTarget(EVENT, simDays);
    expect(Math.abs(expanded.position.y - base.position.y)).toBeGreaterThan(1);
  });
});
