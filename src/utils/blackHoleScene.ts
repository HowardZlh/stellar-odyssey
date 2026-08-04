/**
 * 黑洞引力透镜主场景接入配置（R4-13，IMPROVEMENT_REQUIREMENTS_4 §R4-13 / §0.3 方案 C）
 *
 * 纯逻辑模块（附录 A §3 纯函数先行）：为 `Scene/BlackHoleLensedLayer.tsx`
 * 与 `SpecialBodies.BlackHole` 提供细节层规格（detailLayer lensing 池，
 * 容量 1）、尺度换算、盘姿态矩阵与两黑洞参数配置；组件只消费本模块输出。
 *
 * ── 门控与预算 ───────────────────────────────────────────────────────────
 * - 进入/退出阈值与 R2-7 近观层同源同值（nearViewEnter/ExitDistanceUnits）：
 *   跟随/飞往目标且飞抵观察距离 ×1.5 内激活，×1.4 滞回退出（Esc 退出
 *   跟随即淡出 0.5s 后卸载 dispose，release-on-exit 语义）；
 * - GPU 预算：程序化星场 cubemap 6 面 × 128² × RGBA 4 B = 384 KB +
 *   黑体 LUT 64×1 RGBA = 256 B（≤64 MB 总预算，lensing 池容量 1）。
 *
 * ── 尺度登记（§R4-13 第 3 条 + 附录 A §4）───────────────────────────────
 * 视界渲染半径（= 透镜 r_s 世界长度）沿用现有廉价 shader 的
 * `visualRadiusLy × SCENE_UNITS_PER_LY × 0.32`（BlackHole 组件黑球半径，
 * 单点同源），即 Sgr A* r_s ≈ 96 ly / 天鹅座 X-1 r_s ≈ 41.6 ly 可视化
 * 压缩比例——真实 r_s（Sgr A* ≈ 0.0013 ly；Cyg X-1 ≈ 6×10⁻¹¹ ly）在
 * 场景尺度下角尺寸不可辨，压缩为艺术化登记；透镜包围球世界半径 =
 * r_s × 14（LENSING_DOMAIN_RADIUS_RS），两黑洞均小于各自飞抵观察距离
 * （Sgr A* 67.2 < 90 / Cyg X-1 29.1 < 39 场景单位），飞抵后相机恒在球外。
 *
 * ── 背景弯曲采样登记（§R4-13 第 3 条二选一）─────────────────────────────
 * 采用**程序化星场近似**（buildStarfieldCubeTexture 确定性 cubemap），
 * 非场景 cubemap 快照——快照需每黑洞 6 面离屏渲染主场景（银心方向粒子
 * 峰值场景成本高、且跟随中背景随相机连续变化需重拍）。差异登记：
 * 包围球内被弯曲的"背景星场"为程序化近似星点，与球外真实场景背景
 * （银河粒子/远景星点）不逐星对应；包围球轮廓处弯曲量趋零（切向短弦
 * 积不出偏转）+ 星点呈随机分布，球缘不连续性目验不可辨（R4-11 先例）。
 *
 * ── 两黑洞参数区分登记（§R4-13 第 2 条 + 附录 A §4）─────────────────────
 * - Sgr A*（超大质量 ~430 万 M☉）：盘暗弱偏橙红——峰值色温压标
 *   7200 K × 0.64 ≈ 4600 K（实际银心吸积流为射电/亚毫米波段同步辐射
 *   亮度，EHT 2022 成像呈橙色调板；黑体色档为艺术化映射登记）、
 *   盘亮度 0.55 暗弱档、光子环暖橙；
 * - 天鹅座 X-1（恒星级 ~21 M☉）：盘亮偏蓝白——峰值色温压标
 *   7200 K × 1.36 ≈ 9800 K（真实恒星级黑洞盘内区 ~10⁷ K X 射线域，
 *   光学黑体色板不可表现，R4-12 压标先例登记）、盘亮度 1.15 明亮档、
 *   光子环冷蓝白；伴星联动登记：现状 BlackHole 组件无伴星渲染，
 *   本阶段维持（"如有则保留"条件不成立）。
 * - 盘倾角两者同取 69.23°（= 廉价 shader 吸积盘 rotation.x = −π/2.6 的
 *   盘面法线姿态，交叉淡出时盘平面对齐无跳变，单测断言）。
 * - 质量差异经 visualRadiusLy 尺度体现（视界/光子环/盘世界尺寸
 *   Sgr A* ≈ 2.3× 天鹅座 X-1），温标/亮度/色调按上表区分。
 *
 * ── 自适应降级（§R4-13 第 4 条）─────────────────────────────────────────
 * 复用 R4-4 质量档位状态机（utils/adaptiveQuality）：档位映射步数 =
 * 基准 64 步 × stepScale（high 64 / mid 48 / low 32，clampLensingSteps
 * 钳制），透镜为全分辨率不透明 raymarch，RT 半分辨率通道不适用（登记）。
 */

import {
  DETAIL_GPU_BUDGET_BYTES,
  type DetailLayerSpec,
} from '@/utils/detailLayer';
import {
  nearViewEnterDistanceUnits,
  nearViewExitDistanceUnits,
} from '@/utils/nearView';
import {
  DISK_LUT_WIDTH,
  LENSING_STEPS_DEFAULT,
  STARFIELD_FACE_SIZE,
  clampDiskRadii,
} from '@/utils/blackHoleLensing';

/** 视界渲染半径系数（× 视觉半径场景尺寸；BlackHole 黑球半径单点同源） */
export const BLACK_HOLE_HORIZON_RADIUS_FACTOR = 0.32;

/** 盘倾角（°；= 廉价 shader 盘 rotation.x = −π/2.6 的法线姿态，登记见文件头） */
export const BLACK_HOLE_DISK_INCLINATION_DEG = 180 / 2.6;

/** 透镜 raymarch 基准步数（自适应档位映射：×1 / ×0.75 / ×0.5） */
export const BLACK_HOLE_LENSED_BASE_STEPS = LENSING_STEPS_DEFAULT;

/** 透镜层 GPU 显存估算（字节）：星场 cubemap 6 面 RGBA + 黑体 LUT */
export const BLACK_HOLE_LENSING_GPU_BYTES =
  6 * STARFIELD_FACE_SIZE * STARFIELD_FACE_SIZE * 4 + DISK_LUT_WIDTH * 4;

/** 单黑洞透镜层场景参数（BlackHoleLensedLayer 消费；登记见文件头） */
export interface BlackHoleLensedSceneConfig {
  /** 盘内缘半径（r_s；3 = ISCO） */
  diskInnerRs: number;
  /** 盘外缘半径（r_s；量级与廉价 shader 盘外缘 2×size ≈ 6.25 r_s 衔接） */
  diskOuterRs: number;
  /** 盘发光基准亮度（Sgr A* 暗弱 / Cyg X-1 明亮） */
  diskBrightness: number;
  /** 盘峰值色温缩放（× 7200 K 压标档；<1 偏橙红 / >1 偏蓝白） */
  diskTempScale: number;
  /** 多普勒束流强度（1 = R4-12 物理档 δ³） */
  beamStrength: number;
  /** 光子环发光强度 */
  ringStrength: number;
  /** 光子环发光色 */
  ringColor: string;
  /** 背景星场亮度倍率 */
  starIntensity: number;
  /** 盘倾角（°；两者同取廉价盘姿态对齐值） */
  diskInclinationDeg: number;
  /** 程序化星场 cubemap 确定性种子（两黑洞星场不同、两次进入一致） */
  starfieldSeed: number;
}

/** 两黑洞参数配置（§R4-13 第 2 条；差异登记见文件头） */
export const BLACK_HOLE_LENSED_CONFIGS: Readonly<
  Record<string, BlackHoleLensedSceneConfig>
> = {
  'sgr-a-star': {
    diskInnerRs: 3,
    diskOuterRs: 8,
    diskBrightness: 0.55,
    diskTempScale: 0.64,
    beamStrength: 1,
    ringStrength: 2.6,
    ringColor: '#ffc27a',
    starIntensity: 1,
    diskInclinationDeg: BLACK_HOLE_DISK_INCLINATION_DEG,
    starfieldSeed: 4131,
  },
  'cygnus-x1': {
    diskInnerRs: 3,
    diskOuterRs: 10,
    diskBrightness: 1.15,
    diskTempScale: 1.36,
    beamStrength: 1,
    ringStrength: 3.4,
    ringColor: '#cfe0ff',
    starIntensity: 1,
    diskInclinationDeg: BLACK_HOLE_DISK_INCLINATION_DEG,
    starfieldSeed: 4132,
  },
};

/**
 * 按天体 id 取透镜场景配置（非黑洞成员返回 null，组件侧不挂接）
 */
export function blackHoleLensedConfig(bodyId: string): BlackHoleLensedSceneConfig | null {
  return BLACK_HOLE_LENSED_CONFIGS[bodyId] ?? null;
}

/**
 * 透镜 r_s 世界长度（场景单位）= 视界渲染半径（廉价 shader 黑球同源）
 *
 * @param sizeUnits 黑洞视觉半径场景尺寸（visualRadiusLy × SCENE_UNITS_PER_LY）
 */
export function blackHoleRsWorldUnits(sizeUnits: number): number {
  if (!Number.isFinite(sizeUnits) || sizeUnits <= 0) {
    throw new RangeError(`黑洞视觉尺寸必须为正有限数，收到 ${sizeUnits}`);
  }
  return sizeUnits * BLACK_HOLE_HORIZON_RADIUS_FACTOR;
}

/**
 * 透镜细节层规格（useDetailLayer 入参；调用方 useMemo 稳定）
 *
 * 阈值与 R2-7 近观门控同源（nearView 登记表含两黑洞条目）；预算 =
 * 星场 cubemap + 黑体 LUT（远低于 64 MB 总预算，单测断言）。
 *
 * @throws RangeError 未登记透镜配置的天体 id
 */
export function blackHoleLensingDetailLayerSpec(bodyId: string): DetailLayerSpec {
  if (!BLACK_HOLE_LENSED_CONFIGS[bodyId]) {
    throw new RangeError(`未登记黑洞透镜配置的天体 id：${bodyId}`);
  }
  return {
    bodyId,
    kind: 'lensing',
    enterDistanceUnits: nearViewEnterDistanceUnits(bodyId),
    exitDistanceUnits: nearViewExitDistanceUnits(bodyId),
    budget: { gpuBytesEstimate: BLACK_HOLE_LENSING_GPU_BYTES },
  };
}

/**
 * 盘姿态矩阵元素（物体空间 → 盘空间，Matrix3.set 行主序 9 元；
 * 与 R4-12 预览页同式：uDiskRot = Rx(−a)，a = 90° − 倾角，
 * 0° = 正视（盘法线 +z）/ 90° = 侧视（盘法线 +y，恒等）。
 * 仅挂载时计算一次（渲染循环零分配）。
 */
export function blackHoleDiskRotElements(
  inclinationDeg: number,
): readonly [number, number, number, number, number, number, number, number, number] {
  if (!Number.isFinite(inclinationDeg)) {
    throw new RangeError(`盘倾角必须为有限数，收到 ${inclinationDeg}`);
  }
  const a = ((90 - inclinationDeg) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

// ---------------------------------------------------------------------------
// 配置自洽校验（模块加载即执行；纯函数导出供单测覆盖异常分支）
// ---------------------------------------------------------------------------

/**
 * 校验透镜配置记录自洽（盘内外缘不被 clampDiskRadii 改写、GPU 估算
 * 在细节层总预算内）；越界抛 RangeError
 */
export function assertBlackHoleLensedConfigs(
  configs: Readonly<Record<string, BlackHoleLensedSceneConfig>>,
  gpuBytes: number = BLACK_HOLE_LENSING_GPU_BYTES,
): void {
  for (const [id, cfg] of Object.entries(configs)) {
    const clamped = clampDiskRadii(cfg.diskInnerRs, cfg.diskOuterRs);
    if (clamped.innerRs !== cfg.diskInnerRs || clamped.outerRs !== cfg.diskOuterRs) {
      throw new RangeError(`黑洞 ${id} 盘内外缘配置越界（clampDiskRadii 会改写）`);
    }
  }
  if (gpuBytes > DETAIL_GPU_BUDGET_BYTES) {
    throw new RangeError('黑洞透镜层 GPU 估算超出细节层总预算');
  }
}

assertBlackHoleLensedConfigs(BLACK_HOLE_LENSED_CONFIGS);
