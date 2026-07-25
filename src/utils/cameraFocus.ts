/**
 * 天体跟随/飞往模式的目标解析（需求 3.2.3，P2）
 *
 * 纯函数：给定天体 id 与模拟时间，解析该天体当前的场景坐标与
 * 合适的观察距离，供 CameraController 实现"飞往"（平滑运镜）与
 * "跟随"（锁定天体随其运动）。
 *
 * 说明：
 * - 卫星优先按"渲染相位注册表"（utils/satellitePhase，P7）求值：
 *   速率钳制期间渲染相位与精确相位存在偏差，近观 glTF 模型下相机
 *   必须与渲染位置一致；未注册（组件未挂载/测试）时回落精确相位；
 * - L3 特殊天体/超新星位于银河系组内，需经"银河系组变换"
 *   （黄道-银道倾斜 + 太阳系锚定原点的反向平移）换算到场景坐标。
 */

import type { MoonData, SpecialBodyData, SupernovaEvent, Vec3 } from '@/types';
import { PLANETS, SUN, getPlanetById } from '@/data/planets';
import { MOONS } from '@/data/moons';
import { COMETS, PLUTO, getDwarfPlanetById } from '@/data/smallBodies';
import {
  LOCAL_GROUP_GALAXIES,
  M31_COMPANION_OFFSETS_LY,
  MILKY_WAY,
  SATELLITE_GALAXY_ORBITS,
} from '@/data/galaxies';
import { SPECIAL_BODIES } from '@/data/specialBodies';
import type { OrbitalElements } from '@/types';
import {
  DAYS_PER_YEAR,
  DEG_TO_RAD,
  RAD_TO_DEG,
  heliocentricPosition,
  orbitPositionWithPeriod,
  orbitalPeriodYears,
} from '@/utils/physics';
import { equivalentDaysForPhase } from '@/utils/freezeGate';
import {
  SCENE_UNITS_PER_LY,
  bodyDisplayRadius,
  cosmicDistanceToSceneUnits,
  eclipticToScene,
  lyToSceneUnits,
} from '@/utils/scale';
import {
  HELIOPAUSE_VISUAL_RADIUS_UNITS,
  VOYAGER_MARKERS,
  voyagerMarkerPositionUnits,
} from '@/utils/heliopause';
import { OORT_VISUAL_RADIUS_UNITS } from '@/utils/oort';
import { satelliteBodyDisplayRadius, satelliteOrbitDisplayRadius } from '@/utils/satellites';
import { renderedSatellitePhaseRad } from '@/utils/satellitePhase';
import { dwarfDisplayRadius, isDwarfPlanetClassification } from '@/utils/dwarfPlanets';
import { renderedGalacticFrame } from '@/utils/galacticFrame';
import { ECLIPTIC_GALACTIC_TILT_DEG, sunGalacticPositionLy } from '@/utils/galaxy';
import { mwM31SeparationLy, satelliteGalaxyPositionLy } from '@/utils/universe';

/** 飞往/跟随目标：场景坐标 + 建议观察距离 */
export interface FocusTarget {
  position: Vec3;
  viewDistanceUnits: number;
}

/** 观察距离范围（场景单位） */
export const MIN_VIEW_DISTANCE_UNITS = 2.2;
export const MAX_VIEW_DISTANCE_UNITS = 30000;

/**
 * 人造卫星近观观察距离（场景单位，P7 §3.4）：
 * 本体示意尺寸仅 ~0.04–0.07 单位，按"轨道半径×0.8"或全局下限 2.2
 * 观察时模型过小。取略高于遨游模式最近距离（OrbitControls minDistance 1.5）
 * 的固定近观距离，配合近观放大系数（utils/satellites.satelliteNearMagnification）
 * 使模型充满合理视野并触发 glTF 细节层加载。
 */
export const SATELLITE_VIEW_DISTANCE_UNITS = 1.6;

/**
 * 太阳系外围球壳结构（日球层顶/奥尔特云示意）观察距离系数（R2-1 §1.1-B）：
 * 目标点取太阳系原点（球壳中心），观察距离 = 示意半径 × 该系数，
 * 保证运镜落点能完整看到整个半透明球壳。
 */
export const SHELL_VIEW_DISTANCE_RATIO = 2.2;

/** 太阳系外围球壳结构：id → 示意球壳半径（场景单位） */
const SOLAR_SHELL_RADII_UNITS: Readonly<Record<string, number>> = {
  heliopause: HELIOPAUSE_VISUAL_RADIUS_UNITS,
  'oort-cloud': OORT_VISUAL_RADIUS_UNITS,
};

/**
 * 特殊天体观察距离下限（场景单位）：银心天体（人马座 A*）/太阳邻域天体。
 * R2-7 起导出供 utils/nearView 近观激活距离同源换算（禁止两套参数）。
 */
export const SPECIAL_VIEW_DISTANCE_FLOOR_GALACTIC_CENTER = 40;
export const SPECIAL_VIEW_DISTANCE_FLOOR_SUN_RELATIVE = 30;

/**
 * 旅行者标记观察距离（场景单位，R2-7 §7.1-A）：标记点位于日球层顶
 * 示意球壳上（半径 ~380 单位），取近观距离使标记辉光与壳层上下文同框。
 */
export const VOYAGER_VIEW_DISTANCE_UNITS = 40;

/**
 * 太阳系外围球壳结构的飞往/跟随目标解析（R2-1 §1.1-B）
 *
 * 修复"点飞往后无运镜却显示跟随中"的假跟随死锁：日球层顶/奥尔特云
 * 此前不在 resolveFocusTarget 任何分支，返回 null 但 followBodyId 已写入。
 *
 * @returns 非球壳结构 id 返回 null
 */
export function shellFocusTarget(bodyId: string): FocusTarget | null {
  const radius = SOLAR_SHELL_RADII_UNITS[bodyId];
  if (radius === undefined) return null;
  return {
    position: { x: 0, y: 0, z: 0 },
    viewDistanceUnits: Math.min(MAX_VIEW_DISTANCE_UNITS, radius * SHELL_VIEW_DISTANCE_RATIO),
  };
}

/**
 * 按天体显示半径推荐观察距离（半径的 6 倍，钳制在可用范围内）
 */
export function viewDistanceForRadius(radiusUnits: number): number {
  if (radiusUnits < 0 || !Number.isFinite(radiusUnits)) {
    throw new RangeError(`显示半径必须为非负有限数，收到 ${radiusUnits}`);
  }
  return Math.min(MAX_VIEW_DISTANCE_UNITS, Math.max(MIN_VIEW_DISTANCE_UNITS, radiusUnits * 6));
}

/**
 * 银心系本地坐标（光年）→ 场景坐标（场景单位）
 *
 * 与 Galaxy 组件的组变换一致（P6 自查修复：感知参考系模式与垂直增益）：
 * 世界坐标 = tiltX·(p − (1−w)·sun_gained)·unitsPerLy，其中
 * sun_gained = 太阳银心系位置且 y 分量乘垂直视觉增益（与 Galaxy 组偏移
 * 计算一致，见 galacticFrame.computeGalacticFramePose）；w 为银心固定权重
 * （跟随模式 0 / 银心固定 1 / 过渡期间中间值），从渲染位姿注册表读取。
 * 未注册（组件未挂载/单测）时 w=0、gain=1，与历史公式完全一致。
 */
export function galacticPointToSceneUnits(pLy: Vec3, simDays: number): Vec3 {
  const { weight, verticalGain } = renderedGalacticFrame();
  const sun = sunGalacticPositionLy(simDays);
  const k = 1 - weight;
  const x = (pLy.x - sun.x * k) * SCENE_UNITS_PER_LY;
  const y = (pLy.y - sun.y * verticalGain * k) * SCENE_UNITS_PER_LY;
  const z = (pLy.z - sun.z * k) * SCENE_UNITS_PER_LY;
  const tilt = ECLIPTIC_GALACTIC_TILT_DEG * DEG_TO_RAD;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  // 绕 X 轴旋转 tilt（与 THREE.Euler(tilt, 0, 0) 一致）
  return { x, y: y * cos - z * sin, z: y * sin + z * cos };
}

/**
 * 日心天体轨道求值时刻（R2-3）：行星/矮行星/彗星在速率钳制期间
 * 渲染相位与精确相位存在偏差（Planet.tsx/Comet.tsx 写入渲染相位注册表），
 * 相机跟随/飞往优先按注册相位换算等效时间求值（P7 卫星范式扩展）；
 * 未注册（未钳制/组件未挂载/测试）时回落共享模拟时间轴。
 */
function heliocentricDaysForBody(bodyId: string, orbit: OrbitalElements, simDays: number): number {
  const phase = renderedSatellitePhaseRad(bodyId);
  if (phase === null) return simDays;
  const periodDays = orbitalPeriodYears(orbit.semiMajorAxisAu) * DAYS_PER_YEAR;
  return equivalentDaysForPhase(phase, orbit.meanAnomalyAtEpochDeg, periodDays);
}

/** 卫星当前场景位置（父行星位置 + 参考平面内的局部偏移） */
function moonScenePosition(moon: MoonData, simDays: number, realScale: boolean): Vec3 | null {
  const parent = getPlanetById(moon.parentId) ?? getDwarfPlanetById(moon.parentId);
  if (!parent) return null;
  const parentScene = eclipticToScene(
    heliocentricPosition(
      parent.orbit,
      heliocentricDaysForBody(parent.id, parent.orbit, simDays),
    ),
  );
  // P7：优先使用渲染相位（速率钳制期间与渲染位置保持一致，登记于文件头）；
  // 注册相位已含历元项与时间推进，评估时刻取 0
  const renderedPhase = renderedSatellitePhaseRad(moon.id);
  const p = orbitPositionWithPeriod(
    {
      semiMajorAxisAu: satelliteOrbitDisplayRadius(
        moon.kind,
        parent.radiusKm,
        moon.orbit.semiMajorAxisKm,
        realScale,
      ),
      eccentricity: moon.orbit.eccentricity,
      inclinationDeg: moon.orbit.inclinationDeg,
      longitudeOfAscendingNodeDeg: moon.orbit.longitudeOfAscendingNodeDeg,
      argumentOfPerihelionDeg: moon.orbit.argumentOfPeriapsisDeg,
      meanAnomalyAtEpochDeg:
        renderedPhase !== null ? renderedPhase * RAD_TO_DEG : moon.orbit.meanAnomalyAtEpochDeg,
    },
    moon.orbit.periodDays,
    renderedPhase !== null ? 0 : simDays,
  );
  // 参考平面局部坐标 → three.js（与 Moon.tsx 一致：x-y → x-(-z)，z → y）
  let local: Vec3 = { x: p.x, y: p.z, z: -p.y };
  if (moon.referencePlane === 'planetEquator') {
    // 赤道面卫星挂在行星轴倾角组内（绕 Z 轴倾斜 tiltRad，与 Planet.tsx 一致）
    const tilt = parent.rotation.axialTiltDeg * DEG_TO_RAD;
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    local = { x: local.x * cos - local.y * sin, y: local.x * sin + local.y * cos, z: local.z };
  }
  return {
    x: parentScene.x + local.x,
    y: parentScene.y + local.y,
    z: parentScene.z + local.z,
  };
}

/** 河外星系当前场景位置（与 Universe.tsx 的每帧计算一致） */
function galaxyScenePosition(galaxyId: string, simDays: number): Vec3 | null {
  const galaxy = LOCAL_GROUP_GALAXIES.find((g) => g.id === galaxyId);
  if (!galaxy) return null;
  if (galaxy.id === 'm31') {
    const d = cosmicDistanceToSceneUnits(mwM31SeparationLy(simDays));
    return { x: galaxy.direction.x * d, y: galaxy.direction.y * d, z: galaxy.direction.z * d };
  }
  if (galaxy.id === 'm32' || galaxy.id === 'm110') {
    // M31 伴星系：随 M31 一同移动（示意偏移已登记于 data/galaxies.ts）
    const m31 = LOCAL_GROUP_GALAXIES.find((g) => g.id === 'm31');
    if (!m31) return null;
    const d = cosmicDistanceToSceneUnits(mwM31SeparationLy(simDays));
    const offset = M31_COMPANION_OFFSETS_LY[galaxy.id];
    return {
      x: m31.direction.x * d + lyToSceneUnits(offset.x),
      y: m31.direction.y * d + lyToSceneUnits(offset.y),
      z: m31.direction.z * d + lyToSceneUnits(offset.z),
    };
  }
  if (galaxy.id === 'lmc' || galaxy.id === 'smc') {
    const orbit = SATELLITE_GALAXY_ORBITS[galaxy.id];
    const p = satelliteGalaxyPositionLy(
      galaxy.distanceLy,
      orbit.periodMyr,
      orbit.phase0Rad,
      orbit.inclinationDeg,
      simDays,
    );
    return { x: lyToSceneUnits(p.x), y: lyToSceneUnits(p.y), z: lyToSceneUnits(p.z) };
  }
  const d = cosmicDistanceToSceneUnits(galaxy.distanceLy);
  return { x: galaxy.direction.x * d, y: galaxy.direction.y * d, z: galaxy.direction.z * d };
}

/** 特殊天体当前场景位置与观察距离 */
function specialBodyFocusTarget(body: SpecialBodyData, simDays: number): FocusTarget | null {
  if (body.positionMode === 'extragalactic') {
    if (!body.direction) return null;
    const d = cosmicDistanceToSceneUnits(body.realDistanceLy);
    return {
      position: { x: body.direction.x * d, y: body.direction.y * d, z: body.direction.z * d },
      viewDistanceUnits: viewDistanceForRadius(300),
    };
  }
  const sizeUnits = body.visualRadiusLy * SCENE_UNITS_PER_LY;
  if (body.positionMode === 'galactic-center') {
    return {
      position: galacticPointToSceneUnits({ x: 0, y: 0, z: 0 }, simDays),
      viewDistanceUnits: Math.max(
        viewDistanceForRadius(sizeUnits),
        SPECIAL_VIEW_DISTANCE_FLOOR_GALACTIC_CENTER,
      ),
    };
  }
  // sun-relative：随太阳共转（跟随模式下世界坐标 = tiltX·(offset·unitsPerLy)，
  // 与 simDays 无关）。太阳 y 分量乘垂直增益，与 SpecialBodies.useGalacticPlacement
  // 的渲染位置一致（P6 自查修复：增益不一致导致特殊天体解析位置垂直漂移）
  const offset = body.offsetLy;
  if (!offset) return null;
  const sun = sunGalacticPositionLy(simDays);
  const gain = renderedGalacticFrame().verticalGain;
  return {
    position: galacticPointToSceneUnits(
      { x: sun.x + offset.x, y: sun.y * gain + offset.y, z: sun.z + offset.z },
      simDays,
    ),
    viewDistanceUnits: Math.max(
      viewDistanceForRadius(sizeUnits),
      SPECIAL_VIEW_DISTANCE_FLOOR_SUN_RELATIVE,
    ),
  };
}

/**
 * 超新星事件当前场景位置与观察距离
 */
export function supernovaFocusTarget(event: SupernovaEvent, simDays: number): FocusTarget {
  return {
    position: galacticPointToSceneUnits(event.positionLy, simDays),
    viewDistanceUnits: 90,
  };
}

/**
 * 解析飞往/跟随目标（需求 3.2.3）
 *
 * 支持：太阳 / 八大行星 / 冥王星 / 卫星（自然+人造）/ 彗星 /
 * 本星系群星系 / L3-L4 特殊天体。超新星事件由
 * supernovaFocusTarget 单独解析（事件状态在 store 中）。
 *
 * @returns 未知 id 返回 null（调用方忽略该请求）
 */
export function resolveFocusTarget(
  bodyId: string,
  simDays: number,
  realScale = false,
): FocusTarget | null {
  if (bodyId === SUN.id) {
    return {
      position: { x: 0, y: 0, z: 0 },
      viewDistanceUnits: viewDistanceForRadius(bodyDisplayRadius(SUN.radiusKm, realScale)),
    };
  }

  const planet = getPlanetById(bodyId) ?? getDwarfPlanetById(bodyId);
  if (planet) {
    // 矮行星（P5 §3.3 聚焦距离适配）：观察距离按与渲染一致的显示半径推荐
    // （默认模式含最小可见钳制），保证近观时天体充满合理视野比例
    const displayRadius = isDwarfPlanetClassification(planet.classificationZh)
      ? dwarfDisplayRadius(planet.radiusKm, realScale)
      : bodyDisplayRadius(planet.radiusKm, realScale);
    return {
      // R2-3：速率钳制期间按渲染相位求值（相机跟随与渲染位置一致）
      position: eclipticToScene(
        heliocentricPosition(
          planet.orbit,
          heliocentricDaysForBody(planet.id, planet.orbit, simDays),
        ),
      ),
      viewDistanceUnits: viewDistanceForRadius(displayRadius),
    };
  }

  const moon = MOONS.find((m) => m.id === bodyId);
  if (moon) {
    const position = moonScenePosition(moon, simDays, realScale);
    if (!position) return null;
    // 人造卫星（P7 §3.4）：观察距离按本体近观体验适配（而非轨道半径），
    // 飞抵后模型充满合理视野并触发 glTF/细节层加载；真实比例模式下
    // 卫星本体不可见（科学事实），维持同一距离观察其轨道位置
    if (moon.kind === 'artificial') {
      const bodyRadius = satelliteBodyDisplayRadius(
        moon.kind,
        moon.radiusKm,
        realScale,
        moon.spanMeters,
      );
      return {
        position,
        viewDistanceUnits: Math.max(SATELLITE_VIEW_DISTANCE_UNITS, bodyRadius * 8),
      };
    }
    const orbitRadius = satelliteOrbitDisplayRadius(
      moon.kind,
      (getPlanetById(moon.parentId) ?? getDwarfPlanetById(moon.parentId) ?? PLUTO).radiusKm,
      moon.orbit.semiMajorAxisKm,
      realScale,
    );
    return {
      position,
      viewDistanceUnits: Math.max(MIN_VIEW_DISTANCE_UNITS, orbitRadius * 0.8),
    };
  }

  const comet = COMETS.find((c) => c.id === bodyId);
  if (comet) {
    return {
      // R2-3：速率钳制期间按渲染相位求值（相机跟随与渲染位置一致）
      position: eclipticToScene(
        heliocentricPosition(
          comet.orbit,
          heliocentricDaysForBody(comet.id, comet.orbit, simDays),
        ),
      ),
      viewDistanceUnits: 4,
    };
  }

  // 银河系整体（R2-5 L4 域序列首站）：目标点取银心（与 Galaxy 组渲染中心
  // 一致，跟随/银心固定两种参考系模式下均随组变换求值），观察距离按
  // 银盘显示半径（半径 5 万光年 × 场景比例）推荐，运镜落点可见整个银盘
  if (bodyId === MILKY_WAY.id) {
    const radiusUnits = (MILKY_WAY.diameterLy / 2) * SCENE_UNITS_PER_LY;
    return {
      position: galacticPointToSceneUnits({ x: 0, y: 0, z: 0 }, simDays),
      viewDistanceUnits: viewDistanceForRadius(radiusUnits),
    };
  }

  const galaxyPosition = galaxyScenePosition(bodyId, simDays);
  if (galaxyPosition) {
    const galaxy = LOCAL_GROUP_GALAXIES.find((g) => g.id === bodyId)!;
    // 视觉尺寸与 Universe.tsx 一致：直径相对银河系 ×2500×2×0.55
    const sizeUnits = (galaxy.diameterLy / 100000) * 2500 * 2 * 0.55;
    return { position: galaxyPosition, viewDistanceUnits: viewDistanceForRadius(sizeUnits / 2) };
  }

  const special = SPECIAL_BODIES.find((b) => b.id === bodyId);
  if (special) {
    return specialBodyFocusTarget(special, simDays);
  }

  // 太阳系外围球壳结构（日球层顶/奥尔特云示意，R2-1）
  const shell = shellFocusTarget(bodyId);
  if (shell) {
    return shell;
  }

  // 旅行者 1/2 号标记点（R2-7 §7.1-A：日球层顶壳上的位置标记，可点选/飞往）
  if (VOYAGER_MARKERS.some((m) => m.id === bodyId)) {
    return {
      position: voyagerMarkerPositionUnits(bodyId),
      viewDistanceUnits: VOYAGER_VIEW_DISTANCE_UNITS,
    };
  }

  return null;
}

/** 全部行星 id（用于快捷校验/测试） */
export const FOCUSABLE_PLANET_IDS: readonly string[] = PLANETS.map((p) => p.id);
