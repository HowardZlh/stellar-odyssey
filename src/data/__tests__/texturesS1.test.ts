/**
 * S1 纹理清单测试：太阳 4K 近观细节层（IMPROVEMENT_REQUIREMENTS_SOLAR §4.2/§5.2）
 */

import fs from 'node:fs';
import path from 'node:path';
import { detailTextureUrl, normalMapUrl, textureUrl } from '@/data/textures';

describe('太阳 4K 近观细节层（S1）', () => {
  it('太阳有 4K 细节层且与 2K 底图不同', () => {
    expect(detailTextureUrl('sun', 'surface')).toBe('/textures/4k_sun.jpg');
    expect(textureUrl('sun', 'surface')).toBe('/textures/2k_sun.jpg');
  });

  it('太阳 4K 文件真实存在于 public/ 目录（SSS "8K" 下载实为 4096×2048，已登记）', () => {
    const filePath = path.join(process.cwd(), 'public', '/textures/4k_sun.jpg');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('太阳无法线贴图（气态等离子体无固体表面，立体感由米粒 shader 提供）', () => {
    expect(normalMapUrl('sun')).toBeNull();
  });
});
