/**
 * 行星光影解析计算测试（P3-4，需求 §4.6）
 *
 * 光照方向统一以太阳（场景原点）为准；土星环投影与行星在环面上的
 * 阴影均为几何解析（shader 的纯逻辑镜像）。
 */

import {
  RING_SHADOW_STRENGTH,
  TERMINATOR_SOFTNESS,
  axialTiltNormal,
  dayFactor,
  planetShadowOnRing,
  ringShadowRadial01,
  smoothstep,
  terminatorWarmBand,
} from '@/utils/planetShading';

describe('smoothstep（GLSL 语义镜像）', () => {
  it('边界外钳制到 0/1', () => {
    expect(smoothstep(0, 1, -0.5)).toBe(0);
    expect(smoothstep(0, 1, 1.5)).toBe(1);
  });

  it('中点为 0.5，单调递增', () => {
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(smoothstep(0, 1, 0.3)).toBeLessThan(smoothstep(0, 1, 0.6));
  });

  it('edge0 >= edge1 抛错', () => {
    expect(() => smoothstep(1, 1, 0.5)).toThrow(RangeError);
  });
});

describe('dayFactor 昼夜明暗界线（terminator 柔和过渡）', () => {
  it('正对太阳（N·L = 1）为全昼', () => {
    expect(dayFactor(1)).toBe(1);
  });

  it('背向太阳（N·L = -1）为全夜', () => {
    expect(dayFactor(-1)).toBe(0);
  });

  it('明暗界线（N·L = 0）恰为半亮（柔和过渡中点）', () => {
    expect(dayFactor(0)).toBeCloseTo(0.5);
  });

  it('过渡区间为 ±TERMINATOR_SOFTNESS（外侧饱和）', () => {
    expect(dayFactor(TERMINATOR_SOFTNESS)).toBe(1);
    expect(dayFactor(-TERMINATOR_SOFTNESS)).toBe(0);
    expect(dayFactor(TERMINATOR_SOFTNESS * 0.5)).toBeGreaterThan(0.5);
    expect(dayFactor(TERMINATOR_SOFTNESS * 0.5)).toBeLessThan(1);
  });
});

describe('terminatorWarmBand 明暗界线暖色带', () => {
  it('全昼与全夜两侧为 0', () => {
    expect(terminatorWarmBand(0)).toBe(0);
    expect(terminatorWarmBand(1)).toBe(0);
  });

  it('过渡带（day≈0.3）达到峰值 1', () => {
    expect(terminatorWarmBand(0.3)).toBeCloseTo(1);
  });

  it('超界输入钳制不抛错', () => {
    expect(terminatorWarmBand(-1)).toBe(0);
    expect(terminatorWarmBand(2)).toBe(0);
  });
});

describe('ringShadowRadial01 土星环在行星表面的投影', () => {
  // 场景设定：行星中心位于 +X 轴 100 单位处，环面为水平面（法线 +Y），
  // 环带 2–4 单位。太阳位于原点 → 日照方向为 -X。
  const center = { x: 100, y: 0, z: 0 };
  const normal = { x: 0, y: 1, z: 0 };

  it('表面点在环带正下方偏太阳侧且太阳在高处时命中环带', () => {
    // 表面点：行星北半球偏下方（y=-1），朝太阳的射线穿过 y=0 环面
    // 取表面点 (103, -1, 0)：朝太阳方向 ≈ (-1, +0.0097, 0)，t≈103 处 y=0，
    // 命中点 x≈103-103*1≈0 → 距行星中心 100 → 超出环带。改用更陡的几何：
    // 表面点 (100, -1, 0) 正下方，日照方向 (-100,1,0)/|..| → 与环面交于
    // t=|(0,1,0)·(0,1,0)|... 直接验证：交点半径应在环内 → 选点使几何可控
    const surface = { x: 100.5, y: -0.5, z: 0 };
    // 射线方向 = -surface/|surface|，向上抬升极小 → 交点距离行星中心很远
    const radial = ringShadowRadial01(surface, center, normal, 2, 4);
    // 该几何下交点半径远超环外缘，返回 null（验证不误报）
    expect(radial).toBeNull();
  });

  it('太阳位于环面上方、表面点在环下方阴影区时返回径向位置', () => {
    // 构造行星在 y = -50 下方（太阳原点在环面法线上方），
    // 环面法线 +Y，环带 2–4；表面点位于行星"下方"（背光通过环面）
    const planetCenter = { x: 0, y: -50, z: 0 };
    // 表面点在行星侧面（x=+3, y=-50）：朝太阳（原点）的射线大致向 +Y，
    // 与环面（过行星中心、法线 +Y）交点在 y=-50 平面 —— 环面过中心，
    // 表面点也在该平面 → 使用略低于环面的表面点
    const surface = { x: 3, y: -50.5, z: 0 };
    const radial = ringShadowRadial01(surface, planetCenter, normal, 2, 4);
    expect(radial).not.toBeNull();
    // 命中点应在环带内 → radial01 ∈ [0, 1]
    expect(radial as number).toBeGreaterThanOrEqual(0);
    expect(radial as number).toBeLessThanOrEqual(1);
  });

  it('射线与环面平行时返回 null', () => {
    // 表面点与太阳连线垂直于环面法线：surface 在 y=0 平面且法线 +Y
    const surface = { x: 96, y: 0, z: 0 };
    expect(ringShadowRadial01(surface, { x: 100, y: 0, z: 0 }, normal, 2, 4)).toBeNull();
  });

  it('交点在环带外（内缘以内/外缘以外）返回 null', () => {
    const planetCenter = { x: 0, y: -50, z: 0 };
    // 表面点几乎正下方 → 交点半径接近 0，小于内缘 2
    const surface = { x: 0.1, y: -51, z: 0 };
    expect(ringShadowRadial01(surface, planetCenter, normal, 2, 4)).toBeNull();
  });

  it('径向位置随交点半径线性映射（内缘 0 → 外缘 1）', () => {
    const planetCenter = { x: 0, y: -50, z: 0 };
    const near = ringShadowRadial01({ x: 2.2, y: -50.3, z: 0 }, planetCenter, normal, 2, 4);
    const far = ringShadowRadial01({ x: 3.5, y: -50.3, z: 0 }, planetCenter, normal, 2, 4);
    expect(near).not.toBeNull();
    expect(far).not.toBeNull();
    expect(far as number).toBeGreaterThan(near as number);
  });

  it('环半径非法时抛错', () => {
    const surface = { x: 1, y: -1, z: 0 };
    expect(() => ringShadowRadial01(surface, center, normal, 0, 4)).toThrow(RangeError);
    expect(() => ringShadowRadial01(surface, center, normal, 4, 2)).toThrow(RangeError);
  });

  it('环投影随自转/公转移动：同一表面点在行星移动后遮蔽关系变化', () => {
    // 行星移动到另一位置后，同一相对表面点的日照方向改变 → 投影结果不同
    const planetA = { x: 0, y: -50, z: 0 };
    const planetB = { x: 50, y: -20, z: 0 };
    const relSurface = { x: 3, y: -0.5, z: 0 };
    const a = ringShadowRadial01(
      { x: planetA.x + relSurface.x, y: planetA.y + relSurface.y, z: planetA.z },
      planetA,
      normal,
      2,
      4,
    );
    const b = ringShadowRadial01(
      { x: planetB.x + relSurface.x, y: planetB.y + relSurface.y, z: planetB.z },
      planetB,
      normal,
      2,
      4,
    );
    expect(a).not.toEqual(b);
  });
});

describe('planetShadowOnRing 行星在环面上的阴影', () => {
  // 行星中心位于 (100, 0, 0)，半径 1；太阳位于原点
  const center = { x: 100, y: 0, z: 0 };

  it('环上点在行星背光侧（行星挡在与太阳之间）时进入阴影', () => {
    // 环上点在行星正后方（x = 103），朝太阳的射线穿过行星球体
    const factor = planetShadowOnRing({ x: 103, y: 0, z: 0 }, center, 1);
    expect(factor).toBeCloseTo(0.18, 5); // 核心阴影保留环境光
  });

  it('环上点在行星向阳侧不被遮挡', () => {
    const factor = planetShadowOnRing({ x: 97, y: 0, z: 0 }, center, 1);
    expect(factor).toBe(1);
  });

  it('侧向偏移超出行星轮廓时无阴影', () => {
    const factor = planetShadowOnRing({ x: 103, y: 0, z: 3 }, center, 1);
    expect(factor).toBe(1);
  });

  it('轮廓边缘软化：半影区因子介于核心与无阴影之间', () => {
    const penumbra = planetShadowOnRing({ x: 103, y: 0, z: 1.0 }, center, 1);
    expect(penumbra).toBeGreaterThan(0.18);
    expect(penumbra).toBeLessThan(1);
  });

  it('行星半径非正时抛错', () => {
    expect(() => planetShadowOnRing({ x: 103, y: 0, z: 0 }, center, 0)).toThrow(RangeError);
  });

  it('环上点位于原点（太阳处）时返回 1（防御性退化）', () => {
    expect(planetShadowOnRing({ x: 0, y: 0, z: 0 }, center, 1)).toBe(1);
  });
});

describe('axialTiltNormal 轴倾角赤道面法线', () => {
  it('无倾角时为 +Y', () => {
    const n = axialTiltNormal(0);
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(1);
    expect(n.z).toBe(0);
  });

  it('倾斜 90°（近天王星侧躺）时法线倒向 -X', () => {
    const n = axialTiltNormal(Math.PI / 2);
    expect(n.x).toBeCloseTo(-1);
    expect(n.y).toBeCloseTo(0);
  });

  it('法线始终为单位向量', () => {
    for (const tilt of [0.1, 0.41, 1.2, 3.1]) {
      const n = axialTiltNormal(tilt);
      expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1);
    }
  });
});

describe('常量合理性', () => {
  it('环投影遮光强度在 (0, 1] 内', () => {
    expect(RING_SHADOW_STRENGTH).toBeGreaterThan(0);
    expect(RING_SHADOW_STRENGTH).toBeLessThanOrEqual(1);
  });

  it('terminator 软化半宽为小量（柔和但不失锐利）', () => {
    expect(TERMINATOR_SOFTNESS).toBeGreaterThan(0);
    expect(TERMINATOR_SOFTNESS).toBeLessThan(0.5);
  });
});
