/**
 * P7 glTF 模型清单与预算测试（§3.1 / §4 硬性预算）
 */

import fs from 'fs';
import path from 'path';
import {
  MODEL_FILE_BUDGET_BYTES,
  MODEL_TOTAL_BUDGET_BYTES,
  MODEL_TRIANGLE_BUDGET,
  SATELLITE_MODELS,
  satelliteModelEntry,
} from '@/data/models';
import { MOONS } from '@/data/moons';

describe('模型清单结构（P7 §3.1）', () => {
  it('清单覆盖全部 4 颗人造卫星', () => {
    const artificialIds = MOONS.filter((m) => m.kind === 'artificial').map((m) => m.id);
    expect(SATELLITE_MODELS.map((m) => m.bodyId).sort()).toEqual(artificialIds.sort());
  });

  it('ISS/哈勃/TDRS 有 glb URL（NASA 公有领域），天宫为程序化降级（url = null，登记）', () => {
    expect(satelliteModelEntry('iss')!.url).toBe('/models/iss.glb');
    expect(satelliteModelEntry('hubble')!.url).toBe('/models/hubble.glb');
    expect(satelliteModelEntry('geo-satellite')!.url).toBe('/models/geo-satellite.glb');
    expect(satelliteModelEntry('tiangong')!.url).toBeNull();
  });

  it('全部条目登记来源与许可', () => {
    for (const entry of SATELLITE_MODELS) {
      expect(entry.sourceZh.length).toBeGreaterThan(0);
      expect(entry.license.length).toBeGreaterThan(0);
    }
    // NASA 模型为公有领域
    for (const id of ['iss', 'hubble', 'geo-satellite']) {
      expect(satelliteModelEntry(id)!.license).toContain('公有领域');
    }
  });

  it('未知 id 返回 undefined', () => {
    expect(satelliteModelEntry('moon')).toBeUndefined();
  });
});

describe('模型资源预算（P7 §4 硬性）', () => {
  it('预算常量与需求一致：单模型 ≤3 MB、总 ≤10 MB、三角形 ≤5 万', () => {
    expect(MODEL_FILE_BUDGET_BYTES).toBe(3 * 1024 * 1024);
    expect(MODEL_TOTAL_BUDGET_BYTES).toBe(10 * 1024 * 1024);
    expect(MODEL_TRIANGLE_BUDGET).toBe(50000);
  });

  it('public/models 下实际文件大小符合单模型与总量预算', () => {
    let total = 0;
    for (const entry of SATELLITE_MODELS) {
      if (!entry.url) continue;
      const filePath = path.join(process.cwd(), 'public', entry.url);
      expect(fs.existsSync(filePath)).toBe(true);
      const size = fs.statSync(filePath).size;
      expect(size).toBeLessThanOrEqual(MODEL_FILE_BUDGET_BYTES);
      total += size;
    }
    expect(total).toBeLessThanOrEqual(MODEL_TOTAL_BUDGET_BYTES);
  });

  it('glb 三角形数符合单模型预算（解析 glTF JSON chunk 统计）', () => {
    for (const entry of SATELLITE_MODELS) {
      if (!entry.url) continue;
      const filePath = path.join(process.cwd(), 'public', entry.url);
      const buf = fs.readFileSync(filePath);
      // GLB 头：magic(4) version(4) length(4)，chunk0：len(4) type(4) JSON
      expect(buf.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
      const jsonLen = buf.readUInt32LE(12);
      const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
        meshes?: { primitives: { indices?: number; attributes: { POSITION: number } }[] }[];
        accessors: { count: number }[];
      };
      let triangles = 0;
      for (const mesh of json.meshes ?? []) {
        for (const prim of mesh.primitives) {
          const accessor =
            prim.indices !== undefined
              ? json.accessors[prim.indices]
              : json.accessors[prim.attributes.POSITION];
          triangles += Math.floor(accessor.count / 3);
        }
      }
      expect(triangles).toBeLessThanOrEqual(MODEL_TRIANGLE_BUDGET);
      expect(triangles).toBeGreaterThan(0);
    }
  });
});
