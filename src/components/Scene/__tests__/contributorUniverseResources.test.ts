/**
 * 贡献者宇宙 3D 资源工厂单测（C2-2，附录 A：3D 组件以纯函数断言 +
 * dispose 断言为主，不在 jsdom 跑真 WebGL）
 */

import type { DonorRecord } from '@/utils/donors';
import { layoutContributorStars } from '@/utils/contributorUniverse';
import {
  BACKGROUND_INNER_RADIUS,
  BACKGROUND_OUTER_RADIUS,
  buildBackgroundStarBuffers,
  buildContributorStarBuffers,
  createStarPointsGeometry,
  createStarPointsMaterial,
  createStarPointsResources,
  disposeStarPointsResources,
} from '@/components/Scene/contributorUniverseResources';

const MOCK_DONORS: readonly DonorRecord[] = [
  { name: '彗星', amountCny: 10000, platform: 'wechat', date: '2026-07-02', message: '加油' },
  { name: '流星', amountCny: 520, platform: 'kofi', date: '2026-07-03' },
  { name: '小行星', amountCny: 5, platform: 'afdian', date: '2026-07-01' },
];

describe('buildContributorStarBuffers（C1 产物直灌）', () => {
  const stars = layoutContributorStars(MOCK_DONORS);
  const buffers = buildContributorStarBuffers(stars);

  it('缓冲长度与星数一致', () => {
    expect(buffers.positions).toHaveLength(stars.length * 3);
    expect(buffers.colors).toHaveLength(stars.length * 3);
    expect(buffers.scales).toHaveLength(stars.length);
    expect(buffers.brightness).toHaveLength(stars.length);
    expect(buffers.phases).toHaveLength(stars.length);
    expect(buffers.freqs).toHaveLength(stars.length);
    expect(buffers.amps).toHaveLength(stars.length);
  });

  it('position/scale/brightness/twinkle 与 C1 产物逐位一致', () => {
    stars.forEach((star, i) => {
      expect(buffers.positions[i * 3]).toBeCloseTo(star.position[0], 5);
      expect(buffers.positions[i * 3 + 1]).toBeCloseTo(star.position[1], 5);
      expect(buffers.positions[i * 3 + 2]).toBeCloseTo(star.position[2], 5);
      expect(buffers.scales[i]).toBeCloseTo(star.scale, 5);
      expect(buffers.brightness[i]).toBeCloseTo(star.brightness, 5);
      expect(buffers.phases[i]).toBeCloseTo(star.twinklePhase, 5);
      expect(buffers.freqs[i]).toBeCloseTo(star.twinkleFreq, 5);
      expect(buffers.amps[i]).toBeCloseTo(star.twinkleAmp, 5);
    });
  });

  it('金额差异映射为可辨的大小/亮度梯度（¥10000 > ¥5，最低档不消失）', () => {
    // stars 顺序与 MOCK_DONORS 一致：0=¥10000、2=¥5
    expect(buffers.scales[0]).toBeGreaterThan(buffers.scales[2]);
    expect(buffers.brightness[0]).toBeGreaterThan(buffers.brightness[2]);
    expect(buffers.brightness[2]).toBeGreaterThanOrEqual(0.4);
  });
});

describe('buildBackgroundStarBuffers（背景氛围星场）', () => {
  it('确定性：同种子逐位一致', () => {
    const a = buildBackgroundStarBuffers(200, 42);
    const b = buildBackgroundStarBuffers(200, 42);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    expect(Array.from(a.amps)).toEqual(Array.from(b.amps));
  });

  it('点数/球壳半径/更小更暗约束（与贡献者星视觉区分）', () => {
    const buffers = buildBackgroundStarBuffers(300, 7);
    expect(buffers.scales).toHaveLength(300);
    for (let i = 0; i < 300; i += 1) {
      const r = Math.hypot(
        buffers.positions[i * 3],
        buffers.positions[i * 3 + 1],
        buffers.positions[i * 3 + 2],
      );
      expect(r).toBeGreaterThanOrEqual(BACKGROUND_INNER_RADIUS - 1e-6);
      expect(r).toBeLessThanOrEqual(BACKGROUND_OUTER_RADIUS + 1e-6);
      // 贡献者星 scale ≥1 / brightness ≥0.4；背景星严格更小更暗
      expect(buffers.scales[i]).toBeLessThan(1);
      expect(buffers.brightness[i]).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('geometry/material 工厂与 dispose（Starfield 范式）', () => {
  const stars = layoutContributorStars(MOCK_DONORS);
  const buffers = buildContributorStarBuffers(stars);

  it('geometry 属性名与 itemSize 匹配 shader 布局', () => {
    const geometry = createStarPointsGeometry(buffers);
    expect(geometry.getAttribute('position').itemSize).toBe(3);
    expect(geometry.getAttribute('color').itemSize).toBe(3);
    for (const name of ['aScale', 'aBrightness', 'aPhase', 'aFreq', 'aAmp']) {
      expect(geometry.getAttribute(name).itemSize).toBe(1);
      expect(geometry.getAttribute(name).count).toBe(stars.length);
    }
    geometry.dispose();
  });

  it('material 为透明加性混合、无深度写入，uSize 按入参设定', () => {
    const material = createStarPointsMaterial(3);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.uniforms.uSize.value).toBe(3);
    expect(material.uniforms.uTime.value).toBe(0);
    material.dispose();
  });

  it('disposeStarPointsResources 释放 geometry 与 material（内存清理断言）', () => {
    const resources = createStarPointsResources(buffers, 2);
    const geometryDispose = jest.spyOn(resources.geometry, 'dispose');
    const materialDispose = jest.spyOn(resources.material, 'dispose');
    disposeStarPointsResources(resources);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });
});
