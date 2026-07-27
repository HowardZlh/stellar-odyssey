/**
 * 3D 空间音效纯逻辑测试（可选需求 3.4.2 / 7 单元测试）
 */

import {
  SPATIAL_SOURCES,
  getSpatialSourceById,
  spatialSourceLevelGain,
  toAudioPosition,
} from '@/utils/spatialAudio';

describe('SPATIAL_SOURCES 清单', () => {
  it('包含太阳与人马座A* 黑洞两个音源（需求示例）', () => {
    const ids = SPATIAL_SOURCES.map((s) => s.id);
    expect(ids).toContain('sun-hum');
    expect(ids).toContain('black-hole-hum');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个音源参数有效：换算系数/基频/基础增益为正，梯形节点单调不减', () => {
    for (const s of SPATIAL_SOURCES) {
      expect(s.unitsPerAudioUnit).toBeGreaterThan(0);
      expect(s.oscillatorFrequency).toBeGreaterThan(0);
      expect(s.baseGain).toBeGreaterThan(0);
      expect(s.fade.x0).toBeLessThanOrEqual(s.fade.x1);
      expect(s.fade.x1).toBeLessThanOrEqual(s.fade.x2);
      expect(s.fade.x2).toBeLessThanOrEqual(s.fade.x3);
    }
  });

  it('太阳音源属 L2 层、黑洞音源属 L3 层', () => {
    expect(getSpatialSourceById('sun-hum')!.level).toBe('L2');
    expect(getSpatialSourceById('black-hole-hum')!.level).toBe('L3');
  });
});

describe('toAudioPosition（场景坐标归一化）', () => {
  it('按 unitsPerAudioUnit 线性缩放各分量', () => {
    const p = toAudioPosition({ x: 40, y: -80, z: 20 }, 40);
    expect(p).toEqual({ x: 1, y: -2, z: 0.5 });
  });

  it('换算系数为 1 时恒等映射', () => {
    expect(toAudioPosition({ x: 3, y: 4, z: 5 }, 1)).toEqual({ x: 3, y: 4, z: 5 });
  });

  it('非正换算系数抛出 RangeError', () => {
    expect(() => toAudioPosition({ x: 1, y: 1, z: 1 }, 0)).toThrow(RangeError);
    expect(() => toAudioPosition({ x: 1, y: 1, z: 1 }, -40)).toThrow(RangeError);
  });
});

describe('spatialSourceLevelGain（层级窗口门控）', () => {
  const sun = getSpatialSourceById('sun-hum')!;
  const blackHole = getSpatialSourceById('black-hole-hum')!;

  it('窗口平台区内为 1', () => {
    // sun-hum 平台 [x1=1, x2=2.4]
    expect(spatialSourceLevelGain(sun, 1.5)).toBe(1);
    expect(spatialSourceLevelGain(sun, 2.0)).toBe(1);
    // black-hole-hum 平台 [x1=2.8, x2=3.6]
    expect(spatialSourceLevelGain(blackHole, 3.0)).toBe(1);
  });

  it('窗口外为 0', () => {
    expect(spatialSourceLevelGain(sun, 3.5)).toBe(0);
    expect(spatialSourceLevelGain(sun, 4.0)).toBe(0);
    expect(spatialSourceLevelGain(blackHole, 1.0)).toBe(0);
    expect(spatialSourceLevelGain(blackHole, 2.0)).toBe(0);
  });

  it('过渡区内单调渐变（0 与 1 之间）', () => {
    // sun-hum 下降沿 (2.4, 3.0)
    const mid = spatialSourceLevelGain(sun, 2.7);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(spatialSourceLevelGain(sun, 2.5)).toBeGreaterThan(spatialSourceLevelGain(sun, 2.9));
    // black-hole-hum 上升沿 (2.4, 2.8)
    expect(spatialSourceLevelGain(blackHole, 2.7)).toBeGreaterThan(
      spatialSourceLevelGain(blackHole, 2.5),
    );
  });

  it('两音源窗口交叉淡变：L2→L3 过渡中太阳淡出、黑洞淡入', () => {
    const levels = [2.4, 2.6, 2.8, 3.0];
    const sunGains = levels.map((l) => spatialSourceLevelGain(sun, l));
    const bhGains = levels.map((l) => spatialSourceLevelGain(blackHole, l));
    for (let i = 1; i < levels.length; i += 1) {
      expect(sunGains[i]).toBeLessThanOrEqual(sunGains[i - 1]);
      expect(bhGains[i]).toBeGreaterThanOrEqual(bhGains[i - 1]);
    }
  });
});

describe('getSpatialSourceById', () => {
  it('按 id 查找音源配置', () => {
    expect(getSpatialSourceById('sun-hum')?.nameZh).toContain('太阳');
  });

  it('未知 id 返回 undefined', () => {
    expect(getSpatialSourceById('unknown-source')).toBeUndefined();
  });
});
