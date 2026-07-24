/**
 * L1 太阳近观"沸腾"颗粒噪声音景混合单测（S3，
 * IMPROVEMENT_REQUIREMENTS_SOLAR §4.6/§6）：增益随近观强度与周期相位微调。
 */

import { SUN_BOIL_MAX_GAIN, sunBoilLayerGain } from '@/utils/audioMixer';

describe('sunBoilLayerGain（太阳沸腾音景增益）', () => {
  it('远观（近观强度 0）时无沸腾音', () => {
    expect(sunBoilLayerGain(0, 0)).toBe(0);
    expect(sunBoilLayerGain(0, 1)).toBe(0);
  });

  it('近观强度越高增益越大', () => {
    expect(sunBoilLayerGain(0.3, 0.5)).toBeLessThan(sunBoilLayerGain(0.9, 0.5));
  });

  it('极大期（包络高）略强于极小期（周期微调 ±20%）', () => {
    const min = sunBoilLayerGain(1, 0);
    const max = sunBoilLayerGain(1, 1);
    expect(max).toBeGreaterThan(min);
    // 极小期 0.8 倍、极大期 1.2 倍
    expect(max / min).toBeCloseTo(1.2 / 0.8, 6);
  });

  it('峰值（近观 1、极大期）不超过额定上限', () => {
    expect(sunBoilLayerGain(1, 1)).toBeCloseTo(SUN_BOIL_MAX_GAIN * 1.2, 6);
    // 亮度克制：额定上限本身较低
    expect(SUN_BOIL_MAX_GAIN).toBeLessThan(0.3);
  });

  it('输入越界钳制', () => {
    expect(sunBoilLayerGain(-1, 0.5)).toBe(0);
    expect(sunBoilLayerGain(2, 0.5)).toBeCloseTo(sunBoilLayerGain(1, 0.5), 10);
  });
});
