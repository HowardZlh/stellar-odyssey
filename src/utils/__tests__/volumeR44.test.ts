/**
 * R4-4 蓝噪声抖动掩码单测（IMPROVEMENT_REQUIREMENTS_4 §R4-4）
 *
 * 覆盖：程序化生成（void-and-cluster 简化）确定性、边长校验、直方图
 * 严格均匀（秩填充性质）、蓝色频谱特征（邻差高于白噪声期望）、平铺
 * 无缝（环绕核）、DataTexture 参数。
 */

import * as THREE from 'three';
import {
  BLUE_NOISE_SIZE,
  BLUE_NOISE_MAX_SIZE,
  buildBlueNoiseData,
  buildBlueNoiseTexture,
  volumeSeed,
} from '@/utils/volume';

describe('buildBlueNoiseData（64×64 程序化蓝噪声，零新依赖）', () => {
  const seed = volumeSeed('volume-blue-noise');

  it('输出长度 = size²，值域 [0, 255]', () => {
    const data = buildBlueNoiseData(16, seed);
    expect(data.length).toBe(256);
    for (const v of data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it('确定性：同一 (size, seed) 双次生成逐字节一致（附录 A §2）', () => {
    const a = buildBlueNoiseData(32, seed);
    const b = buildBlueNoiseData(32, seed);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('不同种子产生不同排布（同尺寸）', () => {
    const a = buildBlueNoiseData(32, 1);
    const b = buildBlueNoiseData(32, 2);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('直方图严格均匀：64² 时每个 8-bit 级恰出现 16 次（秩填充性质）', () => {
    const data = buildBlueNoiseData(64, seed);
    const hist = new Array<number>(256).fill(0);
    for (const v of data) hist[v] += 1;
    for (let level = 0; level < 256; level += 1) {
      expect(hist[level]).toBe((64 * 64) / 256);
    }
  });

  it('蓝色频谱特征：环绕邻差均值显著高于白噪声期望（≈1/3）', () => {
    const size = 64;
    const data = buildBlueNoiseData(size, seed);
    let sum = 0;
    let count = 0;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const v = data[y * size + x] / 255;
        const right = data[y * size + ((x + 1) % size)] / 255;
        const down = data[((y + 1) % size) * size + x] / 255;
        sum += Math.abs(v - right) + Math.abs(v - down);
        count += 2;
      }
    }
    const meanNeighborDiff = sum / count;
    // 均匀白噪声的期望邻差 = 1/3；蓝噪声高频为主，邻差显著更大。
    // 环绕取邻（RepeatWrapping 语义）同时校验平铺边界无低频接缝。
    expect(meanNeighborDiff).toBeGreaterThan(0.38);
  });

  it('边长越界/非整数抛 RangeError（[8, 128]）', () => {
    expect(() => buildBlueNoiseData(4, seed)).toThrow(RangeError);
    expect(() => buildBlueNoiseData(BLUE_NOISE_MAX_SIZE + 1, seed)).toThrow(RangeError);
    expect(() => buildBlueNoiseData(31.5, seed)).toThrow(RangeError);
    expect(() => buildBlueNoiseData(Number.NaN, seed)).toThrow(RangeError);
  });

  it('边界边长 8 与 128 可生成', () => {
    expect(buildBlueNoiseData(8, seed).length).toBe(64);
    expect(buildBlueNoiseData(BLUE_NOISE_MAX_SIZE, seed).length).toBe(
      BLUE_NOISE_MAX_SIZE * BLUE_NOISE_MAX_SIZE,
    );
  });
});

describe('buildBlueNoiseTexture（DataTexture 参数约定）', () => {
  it('默认 64×64、R8/UnsignedByte、Nearest、Repeat 平铺、unpackAlignment=1', () => {
    const tex = buildBlueNoiseTexture();
    expect(tex).toBeInstanceOf(THREE.DataTexture);
    expect(tex.image.width).toBe(BLUE_NOISE_SIZE);
    expect(tex.image.height).toBe(BLUE_NOISE_SIZE);
    expect(tex.format).toBe(THREE.RedFormat);
    expect(tex.type).toBe(THREE.UnsignedByteType);
    expect(tex.minFilter).toBe(THREE.NearestFilter);
    expect(tex.magFilter).toBe(THREE.NearestFilter);
    expect(tex.wrapS).toBe(THREE.RepeatWrapping);
    expect(tex.wrapT).toBe(THREE.RepeatWrapping);
    expect(tex.unpackAlignment).toBe(1);
    expect(tex.version).toBeGreaterThan(0); // needsUpdate 已置位（首帧上传）
    tex.dispose();
  });

  it('数据与 buildBlueNoiseData 同源（同默认种子逐字节一致）', () => {
    const tex = buildBlueNoiseTexture(16, 42);
    const data = buildBlueNoiseData(16, 42);
    expect(Buffer.from(tex.image.data as Uint8Array).equals(Buffer.from(data))).toBe(true);
    tex.dispose();
  });
});
