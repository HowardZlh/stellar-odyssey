/**
 * R3-6 银河系视角天体垂直展开纯逻辑单测（IMPROVEMENT_REQUIREMENTS_3 §6.1/§6.2）：
 * 银纬 → y 换算（含数据表交叉断言）、增益钳制/平滑过渡、指示线端点、
 * 高度标注文案，以及渲染/解析同源断言（同一展开增益下两路径 y 一致）。
 */

import { SPECIAL_BODIES } from '@/data/specialBodies';
import { easeInOutCubic } from '@/utils/animation';
import {
  GALAXY_EXPAND_GAIN_DEFAULT,
  GALAXY_EXPAND_GAIN_MAX,
  GALAXY_EXPAND_GAIN_MIN,
  GALAXY_EXPAND_GAIN_RATE_PER_SECOND,
  GALAXY_EXPAND_GAIN_STEP,
  GALAXY_EXPAND_TRANSITION_SECONDS,
  advanceExpandGainValue,
  clampExpandGain,
  effectiveExpandGain,
  heightLabelText,
  heightLineDropUnits,
  offsetYFromLatitude,
} from '@/utils/galacticLatitude';
import {
  computeGalacticFramePose,
  renderedGalacticFrame,
  resetRenderedGalacticFrame,
  setRenderedGalacticFrame,
  tiltAroundX,
} from '@/utils/galacticFrame';
import { resolveFocusTarget, galacticPointToSceneUnits } from '@/utils/cameraFocus';
import { sunGalacticPositionLy } from '@/utils/galaxy';
import { SCENE_UNITS_PER_LY } from '@/utils/scale';

/** 需求文档 §6.1-A 银纬数据表（b 值来源 SIMBAD，实现时核对登记） */
const LATITUDE_TABLE: Record<string, number> = {
  betelgeuse: -9.0,
  rigel: -25.1,
  sirius: -8.9,
  'crab-pulsar': -5.8,
  'orion-nebula': -19.4,
  'ring-nebula': 14.0,
  'm13-cluster': 40.9,
  'cygnus-x1': 3.1,
  'wr-124': 3.3,
  'delta-cephei': 0.5,
  pleiades: -23.5,
  'horsehead-nebula': -16.8,
};

describe('offsetYFromLatitude（银纬 → 垂直偏移换算）', () => {
  it('12 个 sun-relative 天体 offsetLy.y 与银纬表推算值逐一同源', () => {
    const bodies = SPECIAL_BODIES.filter(
      (b) => b.level === 'L3' && b.positionMode === 'sun-relative',
    );
    expect(bodies).toHaveLength(12);
    for (const body of bodies) {
      const b = LATITUDE_TABLE[body.id];
      expect(b).toBeDefined();
      const offset = body.offsetLy!;
      const horizontal = Math.hypot(offset.x, offset.z);
      expect(offset.y).toBe(offsetYFromLatitude(horizontal, b));
    }
  });

  it('M13 由 6,200 修正为 ≈4,860（高悬银晕事实不变）', () => {
    const m13 = SPECIAL_BODIES.find((b) => b.id === 'm13-cluster')!;
    expect(m13.offsetLy!.y).toBe(4858);
    // 高于盘厚（±500 ly 半厚）一个量级 → 仍在银晕中
    expect(Math.abs(m13.offsetLy!.y)).toBeGreaterThan(4000);
  });

  it('盘上/盘下方向与银纬符号一致（猎户座/昴星团/参宿七低于盘面）', () => {
    for (const id of ['orion-nebula', 'pleiades', 'rigel', 'betelgeuse', 'horsehead-nebula']) {
      expect(SPECIAL_BODIES.find((b) => b.id === id)!.offsetLy!.y).toBeLessThan(0);
    }
    for (const id of ['m13-cluster', 'ring-nebula', 'cygnus-x1']) {
      expect(SPECIAL_BODIES.find((b) => b.id === id)!.offsetLy!.y).toBeGreaterThan(0);
    }
  });

  it('b=0 时 y=0；水平距离 0 时 y=0', () => {
    expect(offsetYFromLatitude(5000, 0)).toBe(0);
    expect(offsetYFromLatitude(0, 45)).toBe(0);
  });

  it('非法输入抛 RangeError（非有限 / |b|≥90 / 水平距离为负）', () => {
    expect(() => offsetYFromLatitude(NaN, 10)).toThrow(RangeError);
    expect(() => offsetYFromLatitude(Infinity, 10)).toThrow(RangeError);
    expect(() => offsetYFromLatitude(-1, 10)).toThrow(RangeError);
    expect(() => offsetYFromLatitude(1000, 90)).toThrow(RangeError);
    expect(() => offsetYFromLatitude(1000, -90)).toThrow(RangeError);
    expect(() => offsetYFromLatitude(1000, NaN)).toThrow(RangeError);
  });
});

describe('clampExpandGain（滑块钳制）', () => {
  it('范围 [1,6]、默认 3、步进 0.5（需求 §6.1-B 常量）', () => {
    expect(GALAXY_EXPAND_GAIN_MIN).toBe(1);
    expect(GALAXY_EXPAND_GAIN_MAX).toBe(6);
    expect(GALAXY_EXPAND_GAIN_DEFAULT).toBe(3);
    expect(GALAXY_EXPAND_GAIN_STEP).toBe(0.5);
  });

  it('钳制到 [1,6]，范围内原样返回', () => {
    expect(clampExpandGain(0)).toBe(1);
    expect(clampExpandGain(-5)).toBe(1);
    expect(clampExpandGain(9)).toBe(6);
    expect(clampExpandGain(3.5)).toBe(3.5);
    expect(clampExpandGain(1)).toBe(1);
    expect(clampExpandGain(6)).toBe(6);
  });

  it('非有限输入抛 RangeError', () => {
    expect(() => clampExpandGain(NaN)).toThrow(RangeError);
    expect(() => clampExpandGain(Infinity)).toThrow(RangeError);
  });
});

describe('advanceExpandGainValue（滑块值平滑跟随）', () => {
  it('以恒定速率向目标靠拢并停在目标（不越过）', () => {
    const step = advanceExpandGainValue(1, 3, 0.1);
    expect(step).toBeCloseTo(1 + 0.1 * GALAXY_EXPAND_GAIN_RATE_PER_SECOND, 10);
    expect(advanceExpandGainValue(2.9, 3, 1)).toBe(3);
    expect(advanceExpandGainValue(3, 3, 1)).toBe(3);
  });

  it('双向收敛（调大/调小滑块均平滑）', () => {
    expect(advanceExpandGainValue(6, 1, 0.2)).toBeCloseTo(5, 10);
    expect(advanceExpandGainValue(1, 6, 1)).toBe(6);
  });

  it('全量程 [1,6] 约 1 秒走完', () => {
    expect(
      advanceExpandGainValue(
        GALAXY_EXPAND_GAIN_MIN,
        GALAXY_EXPAND_GAIN_MAX,
        GALAXY_EXPAND_TRANSITION_SECONDS,
      ),
    ).toBe(GALAXY_EXPAND_GAIN_MAX);
  });

  it('目标经内部钳制；非法速率抛 RangeError', () => {
    expect(advanceExpandGainValue(6, 99, 1)).toBe(6);
    expect(() => advanceExpandGainValue(1, 3, 0.1, 0)).toThrow(RangeError);
    expect(() => advanceExpandGainValue(1, 3, 0.1, -1)).toThrow(RangeError);
  });
});

describe('effectiveExpandGain（开关过渡生效增益）', () => {
  it('进度 0 恒为 1（关闭时默认零视觉影响）', () => {
    expect(effectiveExpandGain(3, 0)).toBe(1);
    expect(effectiveExpandGain(6, 0)).toBe(1);
  });

  it('进度 1 等于滑块值；中间进度按 easeInOutCubic 插值', () => {
    expect(effectiveExpandGain(3, 1)).toBe(3);
    expect(effectiveExpandGain(3, 0.5)).toBeCloseTo(1 + 2 * easeInOutCubic(0.5), 10);
    // 单调：进度增大生效增益不减
    let prev = 1;
    for (let p = 0; p <= 1; p += 0.1) {
      const g = effectiveExpandGain(3, p);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });

  it('滑块值内部钳制到 [1,6]', () => {
    expect(effectiveExpandGain(99, 1)).toBe(6);
    expect(effectiveExpandGain(0, 1)).toBe(1);
  });
});

describe('heightLineDropUnits（指示线端点）', () => {
  it('端点位移 = −(太阳 y×太阳增益 + offset.y×展开增益)×unitsPerLy（镜像渲染 y 通道）', () => {
    expect(heightLineDropUnits(100, 10, 4858, 3, 0.05)).toBeCloseTo(
      -(100 * 10 + 4858 * 3) * 0.05,
      10,
    );
  });

  it('盘上天体位移为负（指示线向下指向盘面），盘下为正', () => {
    expect(heightLineDropUnits(0, 1, 4858, 1, 0.05)).toBeLessThan(0);
    expect(heightLineDropUnits(0, 1, -1616, 1, 0.05)).toBeGreaterThan(0);
  });

  it('unitsPerLy 非正抛 RangeError', () => {
    expect(() => heightLineDropUnits(0, 1, 100, 1, 0)).toThrow(RangeError);
    expect(() => heightLineDropUnits(0, 1, 100, 1, -0.05)).toThrow(RangeError);
  });
});

describe('heightLabelText（高度标注文案）', () => {
  it('正负区分盘上/盘下，千分位分隔', () => {
    expect(heightLabelText(4858)).toBe('+4,858 ly');
    expect(heightLabelText(-1616)).toBe('−1,616 ly');
    expect(heightLabelText(0)).toBe('+0 ly');
    expect(heightLabelText(40)).toBe('+40 ly');
  });

  it('非有限输入抛 RangeError', () => {
    expect(() => heightLabelText(NaN)).toThrow(RangeError);
    expect(() => heightLabelText(-Infinity)).toThrow(RangeError);
  });
});

describe('渲染/解析同源（R3-6 §6.1-D：展开状态下飞往/跟随落点正确）', () => {
  afterEach(() => resetRenderedGalacticFrame());

  /**
   * 独立镜像渲染路径：Galaxy 组（倾斜 + groupOffset 平移）内的
   * SpecialBodies.useGalacticPlacement 本地定位 → 世界坐标
   */
  function renderedWorldPos(
    bodyId: string,
    simDays: number,
    expandGain: number,
    verticalGain: number,
    weight: number,
  ): { x: number; y: number; z: number } {
    const body = SPECIAL_BODIES.find((b) => b.id === bodyId)!;
    const offset = body.offsetLy!;
    const sun = sunGalacticPositionLy(simDays);
    const local = {
      x: (sun.x + offset.x) * SCENE_UNITS_PER_LY,
      y: (sun.y * verticalGain + offset.y * expandGain) * SCENE_UNITS_PER_LY,
      z: (sun.z + offset.z) * SCENE_UNITS_PER_LY,
    };
    const pose = computeGalacticFramePose({
      simDays,
      galacticCenterWeight: weight,
      verticalGain,
    });
    const tilted = tiltAroundX(local);
    return {
      x: tilted.x + pose.groupOffset.x,
      y: tilted.y + pose.groupOffset.y,
      z: tilted.z + pose.groupOffset.z,
    };
  }

  it('同一展开增益下渲染与解析两路径 y 一致（m13 / 猎户座星云，×3）', () => {
    const simDays = 8.4e9;
    setRenderedGalacticFrame(0, 1, 3);
    for (const id of ['m13-cluster', 'orion-nebula']) {
      const target = resolveFocusTarget(id, simDays)!;
      const rendered = renderedWorldPos(id, simDays, 3, 1, 0);
      expect(target.position.x).toBeCloseTo(rendered.x, 6);
      expect(target.position.y).toBeCloseTo(rendered.y, 6);
      expect(target.position.z).toBeCloseTo(rendered.z, 6);
    }
  });

  it('银心固定 + 太阳垂直增益 + 展开增益组合下两路径仍一致', () => {
    const simDays = 4.2e10;
    setRenderedGalacticFrame(1, 10, 4.5);
    const target = resolveFocusTarget('pleiades', simDays)!;
    const rendered = renderedWorldPos('pleiades', simDays, 4.5, 10, 1);
    expect(target.position.x).toBeCloseTo(rendered.x, 6);
    expect(target.position.y).toBeCloseTo(rendered.y, 6);
    expect(target.position.z).toBeCloseTo(rendered.z, 6);
  });

  it('展开增益变化改变特殊天体解析 y（生效验证）', () => {
    const simDays = 0;
    setRenderedGalacticFrame(0, 1, 1);
    const base = resolveFocusTarget('m13-cluster', simDays)!;
    setRenderedGalacticFrame(0, 1, 3);
    const expanded = resolveFocusTarget('m13-cluster', simDays)!;
    expect(expanded.position.y).not.toBeCloseTo(base.position.y, 1);
  });

  it('sgr-a-star（银心原点）与 galacticPointToSceneUnits 不受展开增益影响（R3-7 口径：超新星随盘 morph 在 supernovaFocusTarget 层施加，本换算函数不变）', () => {
    const simDays = 8.4e9;
    setRenderedGalacticFrame(0, 1, 1);
    const sgrBase = resolveFocusTarget('sgr-a-star', simDays)!;
    const snBase = galacticPointToSceneUnits({ x: 20000, y: 100, z: -8000 }, simDays);
    setRenderedGalacticFrame(0, 1, 6);
    const sgrExpanded = resolveFocusTarget('sgr-a-star', simDays)!;
    const snExpanded = galacticPointToSceneUnits({ x: 20000, y: 100, z: -8000 }, simDays);
    expect(sgrExpanded.position).toEqual(sgrBase.position);
    expect(snExpanded).toEqual(snBase);
  });

  it('注册表默认展开增益为 1（未挂载/单测行为与历史一致）；setter 校验', () => {
    expect(renderedGalacticFrame().expandGain).toBe(1);
    setRenderedGalacticFrame(0, 1);
    expect(renderedGalacticFrame().expandGain).toBe(1);
    expect(() => setRenderedGalacticFrame(0, 1, 0.5)).toThrow(RangeError);
    expect(() => setRenderedGalacticFrame(0, 1, NaN)).toThrow(RangeError);
  });
});
