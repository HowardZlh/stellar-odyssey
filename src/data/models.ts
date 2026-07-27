/**
 * 人造卫星 glTF 精细模型清单（P7 §3.1，需求登记）
 *
 * 模型来源与许可：
 * - ISS：NASA 3D Resources "International Space Station (ISS) (B)"（公有领域），
 *   本地经 gltf-transform 优化（weld/simplify + meshopt 压缩），
 *   190 KB / 31,997 三角形
 * - 哈勃：NASA 3D Resources "Hubble Space Telescope (A)"（公有领域），
 *   同上优化，168 KB / 5,128 三角形
 * - 静止轨道卫星：NASA 3D Resources "Tracking and Data Relay Satellites (TDRS) (B)"
 *   （公有领域，以 TDRS 为原型的静止轨道通信卫星示意），同上优化，
 *   305 KB / 16,476 三角形
 * - 天宫空间站：无 NASA 公版模型且未找到开放许可（CC0/CC BY）社区模型，
 *   按需求降级为程序化几何组合（T 字构型，见
 *   components/CelestialBody/satelliteGeometry.ts，差异已登记）——url 为 null
 *
 * 预算（P7 §4 硬性）：单模型 ≤3 MB、总增量 ≤10 MB、单模型三角形 ≤5 万
 * （当前合计约 0.66 MB / 全部模型 ≤3.2 万三角形，均达标）。
 *
 * 运行时：EXT_meshopt_compression 由 three 内置 MeshoptDecoder 解码，
 * 无需额外解码器资源文件；加载失败静默降级为程序化几何组合。
 */

/** 单个人造卫星模型清单条目 */
export interface SatelliteModelEntry {
  /** 对应 MoonData.id */
  bodyId: string;
  /** glb 文件 URL；null = 无合规模型来源，使用程序化几何组合（登记） */
  url: string | null;
  /** 来源说明（中文，信息登记） */
  sourceZh: string;
  /** 许可 */
  license: string;
}

/** 单模型文件大小预算（字节，P7 §4） */
export const MODEL_FILE_BUDGET_BYTES = 3 * 1024 * 1024;
/** 模型文件总增量预算（字节，P7 §4） */
export const MODEL_TOTAL_BUDGET_BYTES = 10 * 1024 * 1024;
/** 单模型三角形数预算（P7 §4） */
export const MODEL_TRIANGLE_BUDGET = 50000;

/** 人造卫星模型清单（顺序与切换序列一致） */
export const SATELLITE_MODELS: readonly SatelliteModelEntry[] = [
  {
    bodyId: 'iss',
    url: '/models/iss.glb',
    sourceZh: 'NASA 3D Resources "International Space Station (ISS) (B)"，本地 meshopt 压缩',
    license: '公有领域（NASA）',
  },
  {
    bodyId: 'tiangong',
    url: null,
    sourceZh: '无 NASA 公版模型与开放许可社区模型，程序化几何组合降级（T 字构型，登记）',
    license: '程序化生成（本项目）',
  },
  {
    bodyId: 'hubble',
    url: '/models/hubble.glb',
    sourceZh: 'NASA 3D Resources "Hubble Space Telescope (A)"，本地 meshopt 压缩',
    license: '公有领域（NASA）',
  },
  {
    bodyId: 'geo-satellite',
    url: '/models/geo-satellite.glb',
    sourceZh:
      'NASA 3D Resources "Tracking and Data Relay Satellites (TDRS) (B)"（静止轨道通信卫星原型），本地 meshopt 压缩',
    license: '公有领域（NASA）',
  },
];

/** 按天体 id 查询模型清单条目 */
export function satelliteModelEntry(bodyId: string): SatelliteModelEntry | undefined {
  return SATELLITE_MODELS.find((m) => m.bodyId === bodyId);
}
