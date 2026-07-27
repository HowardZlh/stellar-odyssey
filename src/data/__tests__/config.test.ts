/**
 * 相机视角与音景配置测试（需求 3.2.1 / 3.4.1 / 附录A）
 */

import { CAMERA_VIEWS, VIEW_TRANSITION_SECONDS } from '@/data/cameraViews';
import { PROCEDURAL_SOUND_PARAMS, SOUNDSCAPES } from '@/data/sounds';
import { VIEW_LEVELS } from '@/types';

describe('CAMERA_VIEWS（四视角锚点）', () => {
  it('覆盖全部四个层级', () => {
    for (const level of VIEW_LEVELS) {
      expect(CAMERA_VIEWS[level].level).toBe(level);
      expect(CAMERA_VIEWS[level].nameZh.length).toBeGreaterThan(0);
    }
  });

  it('距离范围有效：min < max 且均为正', () => {
    for (const level of VIEW_LEVELS) {
      const view = CAMERA_VIEWS[level];
      expect(view.minDistance).toBeGreaterThan(0);
      expect(view.maxDistance).toBeGreaterThan(view.minDistance);
    }
  });

  it('层级越外相机距离越远', () => {
    const dist = (level: (typeof VIEW_LEVELS)[number]): number => {
      const p = CAMERA_VIEWS[level].position;
      return Math.hypot(p.x, p.y, p.z);
    };
    expect(dist('L1')).toBeLessThan(dist('L2'));
    expect(dist('L2')).toBeLessThan(dist('L3'));
    expect(dist('L3')).toBeLessThan(dist('L4'));
  });

  it('L4 宇宙视角背景为纯黑（需求 4.2）', () => {
    expect(CAMERA_VIEWS.L4.background).toBe('#000000');
  });

  it('各层级背景色符合附录A参考值', () => {
    expect(CAMERA_VIEWS.L1.background).toBe('#1a1a2e');
    expect(CAMERA_VIEWS.L2.background).toBe('#1a1a35');
    expect(CAMERA_VIEWS.L3.background).toBe('#1a1a4a');
  });

  it('FOV 在合理范围（30–75）', () => {
    for (const level of VIEW_LEVELS) {
      expect(CAMERA_VIEWS[level].fov).toBeGreaterThanOrEqual(30);
      expect(CAMERA_VIEWS[level].fov).toBeLessThanOrEqual(75);
    }
  });

  it('视角过渡时长为正且不超过 5 秒', () => {
    expect(VIEW_TRANSITION_SECONDS).toBeGreaterThan(0);
    expect(VIEW_TRANSITION_SECONDS).toBeLessThanOrEqual(5);
  });
});

describe('SOUNDSCAPES（视角—音景映射）', () => {
  it('覆盖全部四个层级且基准音量在 (0, 1]', () => {
    for (const level of VIEW_LEVELS) {
      const s = SOUNDSCAPES[level];
      expect(s.level).toBe(level);
      expect(s.baseVolume).toBeGreaterThan(0);
      expect(s.baseVolume).toBeLessThanOrEqual(1);
      expect(s.src.length).toBeGreaterThan(0);
    }
  });

  it('程序化合成参数完整且为正值', () => {
    for (const level of VIEW_LEVELS) {
      const p = PROCEDURAL_SOUND_PARAMS[level];
      expect(p.filterFrequency).toBeGreaterThan(0);
      expect(p.oscillatorFrequency).toBeGreaterThan(0);
      expect(p.noiseGain).toBeGreaterThan(0);
      expect(p.oscGain).toBeGreaterThan(0);
    }
  });

  it('L2 太阳轰鸣与 L4 宇宙铺底为低频（<100 Hz 振荡）', () => {
    expect(PROCEDURAL_SOUND_PARAMS.L2.oscillatorFrequency).toBeLessThan(100);
    expect(PROCEDURAL_SOUND_PARAMS.L4.oscillatorFrequency).toBeLessThan(100);
  });
});
