/**
 * P4 纹理清单测试：4K 近观细节层与法线贴图（需求 §4.7）
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  BODY_DETAIL_TEXTURES,
  BODY_NORMAL_MAPS,
  detailTextureUrl,
  normalMapUrl,
  textureUrl,
} from '@/data/textures';

describe('4K 细节层清单（§4.7）', () => {
  it('有 4K 源的天体齐全（水金地火木土 + 月球；地球含夜灯/云层）', () => {
    expect(detailTextureUrl('mercury', 'surface')).toBe('/textures/4k_mercury.jpg');
    expect(detailTextureUrl('venus', 'surface')).toBe('/textures/4k_venus_atmosphere.jpg');
    expect(detailTextureUrl('earth', 'surface')).toBe('/textures/4k_earth_daymap.jpg');
    expect(detailTextureUrl('earth', 'night')).toBe('/textures/4k_earth_nightmap.jpg');
    expect(detailTextureUrl('earth', 'clouds')).toBe('/textures/4k_earth_clouds.jpg');
    expect(detailTextureUrl('mars', 'surface')).toBe('/textures/4k_mars.jpg');
    expect(detailTextureUrl('jupiter', 'surface')).toBe('/textures/4k_jupiter.jpg');
    expect(detailTextureUrl('saturn', 'surface')).toBe('/textures/4k_saturn.jpg');
    expect(detailTextureUrl('moon', 'surface')).toBe('/textures/4k_moon.jpg');
  });

  it('源图限制登记：天王星/海王星/土星环无 4K（维持 2K + 程序化增强）', () => {
    expect(detailTextureUrl('uranus', 'surface')).toBeNull();
    expect(detailTextureUrl('neptune', 'surface')).toBeNull();
    expect(detailTextureUrl('saturn', 'ring')).toBeNull();
  });

  it('矮行星 4K 近观层（P5 §3.4 可选项）：冥王星/谷神星有、其余三颗无', () => {
    expect(detailTextureUrl('pluto', 'surface')).toBe('/textures/4k_pluto.jpg');
    expect(detailTextureUrl('ceres', 'surface')).toBe('/textures/4k_ceres.jpg');
    expect(detailTextureUrl('eris', 'surface')).toBeNull();
    expect(detailTextureUrl('makemake', 'surface')).toBeNull();
    expect(detailTextureUrl('haumea', 'surface')).toBeNull();
  });

  it('矮行星法线贴图（P5 §3.4 可选项）：冥王星/谷神星由 DEM/DTM 转换生成', () => {
    expect(normalMapUrl('pluto')).toBe('/textures/4k_pluto_normal.jpg');
    expect(normalMapUrl('ceres')).toBe('/textures/4k_ceres_normal.jpg');
    // 其余三颗无高程数据，无法线贴图
    expect(normalMapUrl('eris')).toBeNull();
    expect(normalMapUrl('makemake')).toBeNull();
    expect(normalMapUrl('haumea')).toBeNull();
  });

  it('细节层 URL 均为 4k_ 前缀且与 2K 底图不同', () => {
    for (const entry of BODY_DETAIL_TEXTURES) {
      expect(entry.url).toMatch(/^\/textures\/4k_/);
      expect(entry.url).not.toBe(textureUrl(entry.bodyId, entry.kind));
      // 对应 2K 底图必须存在（先显示防空窗的前提）
      expect(textureUrl(entry.bodyId, entry.kind)).not.toBeNull();
    }
  });

  it('清单无重复项', () => {
    const keys = BODY_DETAIL_TEXTURES.map((t) => `${t.bodyId}:${t.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('法线贴图清单（§4.7 近观立体细节）', () => {
  it('地球/火星/月球有法线贴图', () => {
    expect(normalMapUrl('earth')).toBe('/textures/4k_earth_normal.jpg');
    expect(normalMapUrl('mars')).toBe('/textures/4k_mars_normal.jpg');
    expect(normalMapUrl('moon')).toBe('/textures/4k_moon_normal.jpg');
  });

  it('气态行星无法线贴图（无固体表面）', () => {
    expect(normalMapUrl('jupiter')).toBeNull();
    expect(normalMapUrl('saturn')).toBeNull();
    expect(normalMapUrl('uranus')).toBeNull();
    expect(normalMapUrl('neptune')).toBeNull();
  });

  it('法线贴图 URL 含 "_normal"（textureManager 据此按线性色彩空间加载）', () => {
    for (const entry of BODY_NORMAL_MAPS) {
      expect(entry.url).toContain('_normal');
    }
  });

  it('4K 细节层与法线贴图文件真实存在于 public/ 目录', () => {
    for (const entry of [...BODY_DETAIL_TEXTURES, ...BODY_NORMAL_MAPS]) {
      const filePath = path.join(process.cwd(), 'public', entry.url);
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });
});
