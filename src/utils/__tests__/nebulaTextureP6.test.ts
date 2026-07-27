/**
 * 程序化星云纹理生成器单元测试（P6 §3.2 / §6 纹理参数校验）
 */

import {
  averageAlpha,
  generateNebulaTextureData,
  radialAlphaProfile,
  type NebulaTextureParams,
} from '@/utils/nebulaTexture';

const BASE: NebulaTextureParams = {
  size: 64,
  seed: 12345,
  innerColor: '#66ccff',
  outerColor: '#ff5577',
  filamentStrength: 0.6,
  irregularity: 0.5,
  octaves: 4,
  shape: 'cloud',
};

describe('generateNebulaTextureData（确定性 + 尺寸约束）', () => {
  it('输出 size*size*4 RGBA 像素', () => {
    const d = generateNebulaTextureData(BASE);
    expect(d.size).toBe(64);
    expect(d.pixels.length).toBe(64 * 64 * 4);
  });

  it('同参数同种子结果逐元素相等（确定性缓存前提）', () => {
    const a = generateNebulaTextureData(BASE);
    const b = generateNebulaTextureData(BASE);
    expect(Array.from(a.pixels)).toEqual(Array.from(b.pixels));
  });

  it('不同种子结果不同（形态随机化）', () => {
    const a = generateNebulaTextureData(BASE);
    const b = generateNebulaTextureData({ ...BASE, seed: 999 });
    expect(Array.from(a.pixels)).not.toEqual(Array.from(b.pixels));
  });

  it('纹理非空（平均 alpha 显著 > 0）且不全满', () => {
    const avg = averageAlpha(generateNebulaTextureData(BASE));
    expect(avg).toBeGreaterThan(0.02);
    expect(avg).toBeLessThan(0.95);
  });

  it('≤512px 约束：512 合法、513 抛错', () => {
    expect(() => generateNebulaTextureData({ ...BASE, size: 512 })).not.toThrow();
    expect(() => generateNebulaTextureData({ ...BASE, size: 513 })).toThrow(RangeError);
  });
});

describe('形态包络', () => {
  it('cloud：中心比边缘亮（中心亮向外衰减）', () => {
    const p = radialAlphaProfile(generateNebulaTextureData({ ...BASE, shape: 'cloud' }));
    expect(p.center).toBeGreaterThan(p.edge);
  });

  it('ring：中环比中心亮（环壳峰值在 r≈0.6）', () => {
    const p = radialAlphaProfile(generateNebulaTextureData({ ...BASE, shape: 'ring' }));
    expect(p.mid).toBeGreaterThan(p.center);
  });

  it('shell：中心中空（中心暗于中环，丝状遗迹壳）', () => {
    const p = radialAlphaProfile(generateNebulaTextureData({ ...BASE, shape: 'shell' }));
    expect(p.mid).toBeGreaterThan(p.center);
  });
});

describe('参数校验（RangeError）', () => {
  it('size 非整数 / 越界', () => {
    expect(() => generateNebulaTextureData({ ...BASE, size: 1 })).toThrow(RangeError);
    expect(() => generateNebulaTextureData({ ...BASE, size: 64.5 })).toThrow(RangeError);
  });

  it('filamentStrength / irregularity 越界', () => {
    expect(() => generateNebulaTextureData({ ...BASE, filamentStrength: -0.1 })).toThrow(RangeError);
    expect(() => generateNebulaTextureData({ ...BASE, filamentStrength: 1.1 })).toThrow(RangeError);
    expect(() => generateNebulaTextureData({ ...BASE, irregularity: 2 })).toThrow(RangeError);
  });

  it('octaves 越界 / 非整数', () => {
    expect(() => generateNebulaTextureData({ ...BASE, octaves: 0 })).toThrow(RangeError);
    expect(() => generateNebulaTextureData({ ...BASE, octaves: 7 })).toThrow(RangeError);
    expect(() => generateNebulaTextureData({ ...BASE, octaves: 2.5 })).toThrow(RangeError);
  });

  it('非法颜色格式', () => {
    expect(() => generateNebulaTextureData({ ...BASE, innerColor: 'red' })).toThrow(RangeError);
    expect(() => generateNebulaTextureData({ ...BASE, outerColor: '#xyz' })).toThrow(RangeError);
  });
});
