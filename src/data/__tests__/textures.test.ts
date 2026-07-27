/**
 * 真实纹理清单数据测试（P3-1，需求 §3.1.1/§4.1）
 */

import fs from 'node:fs';
import path from 'node:path';
import { BODY_TEXTURES, DWARF_TEXTURE_LICENSE, TEXTURE_LICENSE, textureUrl } from '@/data/textures';
import { PLANETS } from '@/data/planets';

describe('纹理清单完整性', () => {
  it('八大行星全部有表面位图纹理', () => {
    for (const planet of PLANETS) {
      expect(textureUrl(planet.id, 'surface')).not.toBeNull();
    }
  });

  it('月球与太阳有表面位图纹理', () => {
    expect(textureUrl('moon', 'surface')).not.toBeNull();
    expect(textureUrl('sun', 'surface')).not.toBeNull();
  });

  it('地球专项：真实夜灯贴图与云层贴图', () => {
    expect(textureUrl('earth', 'night')).not.toBeNull();
    expect(textureUrl('earth', 'clouds')).not.toBeNull();
  });

  it('土星环真实环纹贴图（含卡西尼缝透明度，PNG 带 alpha）', () => {
    const url = textureUrl('saturn', 'ring');
    expect(url).not.toBeNull();
    expect(url).toMatch(/\.png$/);
  });

  it('冥王星/谷神星有真实表面位图纹理（P5 §3.4，NASA 公有领域）', () => {
    expect(textureUrl('pluto', 'surface')).toBe('/textures/2k_pluto.jpg');
    expect(textureUrl('ceres', 'surface')).toBe('/textures/2k_ceres.jpg');
  });

  it('无位图纹理的天体返回 null（走程序化降级路径）', () => {
    expect(textureUrl('eris', 'surface')).toBeNull();
    expect(textureUrl('makemake', 'surface')).toBeNull();
    expect(textureUrl('haumea', 'surface')).toBeNull();
    expect(textureUrl('earth', 'ring')).toBeNull();
    expect(textureUrl('io', 'surface')).toBeNull();
  });

  it('(bodyId, kind) 组合唯一', () => {
    const keys = BODY_TEXTURES.map((t) => `${t.bodyId}:${t.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('URL 均指向 public/textures 静态资源', () => {
    for (const entry of BODY_TEXTURES) {
      expect(entry.url).toMatch(/^\/textures\/.+\.(jpg|png)$/);
    }
  });

  it('纹理文件真实存在于 public/ 目录', () => {
    for (const entry of BODY_TEXTURES) {
      const filePath = path.join(process.cwd(), 'public', entry.url);
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });
});

describe('许可登记（附录B）', () => {
  it('登记 CC BY 4.0 许可与 Solar System Scope 来源', () => {
    expect(TEXTURE_LICENSE).toContain('CC BY 4.0');
    expect(TEXTURE_LICENSE).toContain('solarsystemscope.com');
  });

  it('矮行星贴图登记 NASA 公有领域来源（P5 §3.4）', () => {
    expect(DWARF_TEXTURE_LICENSE).toContain('New Horizons');
    expect(DWARF_TEXTURE_LICENSE).toContain('Dawn');
    expect(DWARF_TEXTURE_LICENSE).toContain('公有领域');
  });
});
