/**
 * 统一天体信息目录（信息面板用，需求 3.5.2）
 *
 * 聚合行星、太阳、矮行星、卫星、彗星、星系数据，
 * 输出可直接渲染的中文标签/值行。数据来源沿用各数据文件的标注。
 */

import type { GalaxyData, GalaxyMorphology, MoonData, PlanetData } from '@/types';
import { PLANETS, SUN } from '@/data/planets';
import { MOONS } from '@/data/moons';
import { COMETS, DWARF_PLANETS, PLUTO } from '@/data/smallBodies';
import { GALAXY_MOTION_NOTE_ZH, LOCAL_GROUP_GALAXIES, MILKY_WAY } from '@/data/galaxies';
import { SPECIAL_BODIES } from '@/data/specialBodies';
import {
  CORONAL_HEATING_NOTE_ZH,
  CORONAL_HOLE_NOTE_ZH,
  HALE_POLARITY_NOTE_ZH,
  SOLAR_WIND_NOTE_ZH,
} from '@/data/sunStructure';
import { OORT_INNER_AU, OORT_OUTER_AU } from '@/utils/oort';
import {
  HELIOPAUSE_REAL_DISTANCE_AU,
  HELIOPAUSE_SHAPE_NOTE_ZH,
  TERMINATION_SHOCK_REAL_DISTANCE_AU,
  VOYAGER_MARKERS,
} from '@/utils/heliopause';
import { SN_REAL_FREQUENCY_NOTE_ZH } from '@/utils/supernova';
import {
  M87_ENVIRONMENT_SOURCE_ZH,
  M87_EXTRA_INFO_LINES_ZH,
} from '@/utils/m87Environment';
import {
  GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_ZH,
  GALAXY_STRUCTURE_SOURCE_ZH,
} from '@/utils/galaxyNearView';
import { LMC_LANDMARK_NOTE_ZH, LMC_LANDMARK_SOURCE_ZH } from '@/utils/lmcStructures';

/** 信息面板中的一行（标签 + 值） */
export interface BodyInfoLine {
  label: string;
  value: string;
}

/** 天体信息条目 */
export interface BodyInfo {
  id: string;
  name: string;
  nameZh: string;
  typeZh: string;
  lines: BodyInfoLine[];
  dataSource: string;
}

/** 星系形态 → 中文类型名 */
const MORPHOLOGY_ZH: Record<GalaxyMorphology, string> = {
  spiral: '旋涡星系',
  'barred-spiral': '棒旋星系',
  elliptical: '椭圆星系',
  irregular: '不规则星系',
};

/** 千分位格式化（固定 en-US 保证输出稳定） */
function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

/** 光年距离友好格式：≥1 万光年时以"万光年"为单位（250万光年、16万光年等） */
function formatLightYears(ly: number): string {
  if (ly < 1e4) {
    return `${formatNumber(ly)}光年`;
  }
  const wan = ly / 1e4;
  return `${formatNumber(Number(wan.toFixed(1)))}万光年`;
}

/** 自转周期（小时），负值表示逆向自转 */
function formatRotation(siderealPeriodHours: number): string {
  const abs = Math.abs(siderealPeriodHours);
  const base = `${formatNumber(abs)} 小时`;
  return siderealPeriodHours < 0 ? `${base}（逆向）` : base;
}

/** 上标数字映射（质量科学计数法显示用） */
const SUPERSCRIPT_DIGITS: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '-': '⁻',
};

/**
 * 质量格式化（需求 3.5.2 质量字段）：科学计数法，如 5.97×10²⁴ kg
 */
export function formatMassKg(massKg: number): string {
  if (!Number.isFinite(massKg) || massKg <= 0) {
    throw new RangeError(`质量必须为正有限数，收到 ${massKg}`);
  }
  const exponent = Math.floor(Math.log10(massKg));
  const mantissa = massKg / 10 ** exponent;
  const supExp = String(exponent)
    .split('')
    .map((c) => SUPERSCRIPT_DIGITS[c] ?? c)
    .join('');
  return `${mantissa.toFixed(2)}×10${supExp} kg`;
}

/** 行星 / 矮行星的通用信息行 */
function planetLines(p: PlanetData): BodyInfoLine[] {
  const lines: BodyInfoLine[] = [
    { label: '半径', value: `${formatNumber(p.radiusKm)} km` },
  ];
  if (p.massKg !== undefined) {
    lines.push({ label: '质量', value: formatMassKg(p.massKg) });
  }
  lines.push(
    { label: '轨道半长轴', value: `${p.orbit.semiMajorAxisAu.toFixed(2)} AU` },
    { label: '离心率', value: p.orbit.eccentricity.toFixed(4) },
    { label: '公转周期', value: `${formatNumber(p.orbitalPeriodYears)} 年` },
    { label: '自转周期', value: formatRotation(p.rotation.siderealPeriodHours) },
    { label: '轴倾角', value: `${p.rotation.axialTiltDeg.toFixed(2)}°` },
  );
  return lines;
}

/** 卫星周期：不足 1 天转为分钟显示（ISS 约 92.9 分钟） */
function formatMoonPeriod(periodDays: number): string {
  if (periodDays < 1) {
    return `${(periodDays * 1440).toFixed(1)} 分钟`;
  }
  return `${periodDays.toFixed(2)} 天`;
}

/** 卫星信息行 */
function moonLines(m: MoonData): BodyInfoLine[] {
  const lines: BodyInfoLine[] = [
    {
      label: '半径',
      value:
        m.kind === 'artificial'
          ? `${m.radiusKm} km（示意尺寸）`
          : `${formatNumber(m.radiusKm)} km`,
    },
  ];
  // 人造卫星真实特征尺寸对照（P7 §3.2：示意尺寸与真实尺寸对照展示）
  if (m.kind === 'artificial' && m.spanMeters !== undefined) {
    lines.push({ label: '真实特征尺寸', value: `约 ${m.spanMeters} m（最大跨度）` });
  }
  if (m.massKg !== undefined) {
    lines.push({ label: '质量', value: formatMassKg(m.massKg) });
  }
  lines.push(
    { label: '轨道半长轴', value: `${formatNumber(m.orbit.semiMajorAxisKm)} km` },
    { label: '公转周期', value: formatMoonPeriod(m.orbit.periodDays) },
    {
      label: '轨道倾角',
      value: m.orbit.inclinationDeg > 90 ? `${m.orbit.inclinationDeg}°（逆行）` : `${m.orbit.inclinationDeg}°`,
    },
  );
  if (m.tidallyLocked) {
    lines.push({ label: '潮汐锁定', value: '是' });
  }
  if (m.noteZh) {
    lines.push({ label: '备注', value: m.noteZh });
  }
  return lines;
}

/** 星系视向速度：负值为接近，正值为退行 */
function formatRadialVelocity(v: number): string {
  return v < 0 ? `接近 ${Math.abs(v)} km/s` : `退行 ${v} km/s`;
}

/** 星系信息行（R2-8 §8.1：补结构说明行——核球/盘/晕，随时可见含跟随近观语境；
 * R2-10：补"运动（模拟）"行——轨迹线与运动同源核对结论逐星系登记；
 * R5-4：M87 增补 M87*·球状星团·室女座团三行（utils/m87Environment 登记） */
function galaxyLines(g: GalaxyData): BodyInfoLine[] {
  const lines: BodyInfoLine[] = [
    { label: '距离', value: formatLightYears(g.distanceLy) },
    { label: '直径', value: formatLightYears(g.diameterLy) },
    { label: '视向速度', value: formatRadialVelocity(g.radialVelocityKmS) },
    { label: '结构', value: GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_ZH[g.morphology] },
  ];
  const motion = GALAXY_MOTION_NOTE_ZH[g.id];
  if (motion) {
    lines.push({ label: '运动（模拟）', value: motion });
  }
  if (g.id === 'm87') {
    lines.push(...M87_EXTRA_INFO_LINES_ZH);
  }
  // R5-5：LMC 标志结构行（30 Doradus + 中央棒色彩分层，近观联动）
  if (g.id === 'lmc') {
    lines.push({ label: '标志结构', value: LMC_LANDMARK_NOTE_ZH });
  }
  lines.push({ label: '描述', value: g.descriptionZh });
  return lines;
}

/** 构建全量目录（模块加载时一次性生成，均为纯数据） */
function buildCatalog(): Map<string, BodyInfo> {
  const catalog = new Map<string, BodyInfo>();

  // 太阳（S2 §4.5 面板扩展：结构分层/温度对比/较差自转/黑子/日冕加热问题）
  catalog.set(SUN.id, {
    id: SUN.id,
    name: SUN.name,
    nameZh: SUN.nameZh,
    typeZh: '恒星',
    lines: [
      { label: '半径', value: `${formatNumber(SUN.radiusKm)} km` },
      { label: '质量', value: formatMassKg(SUN.massKg) },
      { label: '结构分层', value: '核心 → 辐射区 → 对流区 → 光球 → 色球 → 日冕' },
      { label: '表面温度', value: '约 5,772 K（有效温度）' },
      { label: '日冕温度', value: `1–3 百万 K——${CORONAL_HEATING_NOTE_ZH}` },
      { label: '较差自转', value: '赤道 25.4 天 / 极区约 34 天（非刚体）' },
      { label: '黑子', value: `约 3,500–4,500 °C 的低温暗区；${HALE_POLARITY_NOTE_ZH}` },
      { label: '太阳风', value: SOLAR_WIND_NOTE_ZH },
      { label: '日冕洞', value: CORONAL_HOLE_NOTE_ZH },
      { label: '活动周期', value: '约 11 年消长（黑子数/耀斑/CME 频率/日冕形态随周期变化，磁场 22 年反转即 Hale 周期）' },
    ],
    dataSource: `${SUN.dataSource}；较差自转 Snodgrass & Ulrich (1990)；日冕加热 Klimchuk (2006)`,
  });

  // 八大行星
  for (const p of PLANETS) {
    catalog.set(p.id, {
      id: p.id,
      name: p.name,
      nameZh: p.nameZh,
      typeZh: '行星',
      lines: planetLines(p),
      dataSource: p.dataSource,
    });
  }

  // 矮行星（IAU 官方 5 颗：谷神星/冥王星/妊神星/鸟神星/阋神星，需求 3.1.1 / P5 §3.1）：
  // 均标注轨道倾角；冥王星额外标注海王星共振；谷神星附注小行星带与 Dawn 探测；
  // 无探测器实拍图的三颗（阋神星/鸟神星/妊神星）注明表面为艺术化呈现（P5 §3.4 登记）
  for (const d of DWARF_PLANETS) {
    const lines: BodyInfoLine[] = [
      ...planetLines(d),
      { label: '轨道倾角', value: `${d.orbit.inclinationDeg.toFixed(1)}°` },
    ];
    if (d.id === PLUTO.id) {
      lines.push({ label: '共振', value: '与海王星 2:3' });
    }
    if (d.id === 'ceres') {
      lines.push({ label: '备注', value: '小行星带中最大天体，Dawn 探测器 2015 年环绕探测' });
    }
    if (d.id === 'haumea') {
      lines.push({ label: '形状', value: '三轴椭球 2100×1680×1074 km（3.9 小时快速自转甩扁）' });
    }
    if (d.id === 'eris' || d.id === 'makemake' || d.id === 'haumea') {
      lines.push({
        label: '备注',
        value: '表面细节为基于观测数据的艺术化呈现（无探测器实拍图）',
      });
    }
    catalog.set(d.id, {
      id: d.id,
      name: d.name,
      nameZh: d.nameZh,
      typeZh: '矮行星',
      lines,
      dataSource: d.dataSource,
    });
  }

  // 卫星（自然 + 人造）
  for (const m of MOONS) {
    catalog.set(m.id, {
      id: m.id,
      name: m.name,
      nameZh: m.nameZh,
      typeZh: m.kind === 'natural' ? '卫星' : '人造卫星',
      lines: moonLines(m),
      dataSource: m.dataSource,
    });
  }

  // 彗星：倾角 >90° 标注逆行，附近日点/远日点距离
  for (const c of COMETS) {
    const { semiMajorAxisAu: a, eccentricity: e, inclinationDeg: i } = c.orbit;
    const lines: BodyInfoLine[] = [
      { label: '轨道半长轴', value: `${a.toFixed(2)} AU` },
      { label: '离心率', value: e.toFixed(4) },
      { label: '轨道倾角', value: i > 90 ? `${i}°（逆行）` : `${i}°` },
      { label: '公转周期', value: `${c.orbitalPeriodYears} 年` },
      { label: '近日点距离', value: `${(a * (1 - e)).toFixed(1)} AU` },
      { label: '远日点距离', value: `${(a * (1 + e)).toFixed(1)} AU` },
    ];
    if (c.massKg !== undefined) {
      lines.splice(1, 0, { label: '质量', value: formatMassKg(c.massKg) });
    }
    catalog.set(c.id, {
      id: c.id,
      name: c.name,
      nameZh: c.nameZh,
      typeZh: '彗星',
      lines,
      dataSource: c.dataSource,
    });
  }

  // 奥尔特云外边界示意（可选需求 3.1.1：L2 与 L3 之间的过渡参照物）
  catalog.set('oort-cloud', {
    id: 'oort-cloud',
    name: 'Oort Cloud (outer boundary, schematic)',
    nameZh: '奥尔特云外边界（示意）',
    typeZh: '太阳系外围结构',
    lines: [
      { label: '内缘', value: `约 ${formatNumber(OORT_INNER_AU)} AU` },
      { label: '外缘', value: `约 ${formatNumber(OORT_OUTER_AU)} AU（约 1.58 光年）` },
      { label: '组成', value: '球壳状长周期彗星库（太阳引力主导范围的边界）' },
      { label: '示意说明', value: '真实尺度远超场景范围，球壳半径为压缩示意值（已登记）' },
    ],
    dataSource: 'NASA Solar System Exploration – Oort Cloud',
  });

  // 日球层顶（S3 §4.3-4：太阳风与星际介质边界，Voyager 实测约 120 AU；
  // R2-7 §7.1-A：近观三层结构 + 形态不对称登记）
  catalog.set('heliopause', {
    id: 'heliopause',
    name: 'Heliopause (schematic)',
    nameZh: '日球层顶（示意）',
    typeZh: '太阳系外围结构',
    lines: [
      { label: '距离', value: `约 ${HELIOPAUSE_REAL_DISTANCE_AU} AU` },
      { label: '定义', value: '太阳风与星际介质压力平衡的边界（日球层 Heliosphere 外缘）' },
      {
        label: '结构分层',
        value: `终端激波（~${TERMINATION_SHOCK_REAL_DISTANCE_AU} AU，太阳风减速至亚声速）→ 日鞘（湍流渐变区）→ 日球层顶（~${HELIOPAUSE_REAL_DISTANCE_AU} AU 外边界）`,
      },
      { label: '形态', value: HELIOPAUSE_SHAPE_NOTE_ZH },
      { label: '探测', value: '旅行者 1 号（2012）、旅行者 2 号（2018）先后穿越，实测约 119–121 AU' },
      { label: '示意说明', value: '球壳半径为压缩示意值（真实 ~120 AU 远超行星区尺度，已登记）' },
    ],
    dataSource: 'NASA/JPL Voyager Interstellar Mission',
  });

  // 旅行者 1/2 号标记点科普卡片（R2-7 §7.1-A，catalog 条目扩展）
  for (const v of VOYAGER_MARKERS) {
    catalog.set(v.id, {
      id: v.id,
      name: v.name,
      nameZh: v.nameZh,
      typeZh: '星际探测器（日球层顶穿越标记）',
      lines: [
        { label: '发射', value: v.launchDateZh },
        {
          label: '穿越日球层顶',
          value: `${v.crossedYear} 年（距太阳约 ${v.crossedDistanceAu} AU）`,
        },
        { label: '备注', value: v.noteZh },
        { label: '携带', value: '金唱片（地球之音，Golden Record）' },
        { label: '示意说明', value: '标记位置按穿越距离与黄纬示意换算（方向经度为示意，已登记）' },
      ],
      dataSource: 'NASA/JPL Voyager Interstellar Mission',
    });
  }

  // 本星系群及邻近星系（R2-8：结构行数据来源随 dataSource 标注）
  for (const g of LOCAL_GROUP_GALAXIES) {
    catalog.set(g.id, {
      id: g.id,
      name: g.name,
      nameZh: g.nameZh,
      typeZh: MORPHOLOGY_ZH[g.morphology],
      lines: galaxyLines(g),
      dataSource:
        g.id === 'm87'
          ? `${g.dataSource}；${GALAXY_STRUCTURE_SOURCE_ZH}；${M87_ENVIRONMENT_SOURCE_ZH}`
          : g.id === 'lmc'
            ? // R5-5：LMC 标志结构来源（30 Dor 位置换算/棒分层登记）
              `${g.dataSource}；${GALAXY_STRUCTURE_SOURCE_ZH}；${LMC_LANDMARK_SOURCE_ZH}`
            : `${g.dataSource}；${GALAXY_STRUCTURE_SOURCE_ZH}`,
    });
  }

  // 特殊天体（需求 3.1.5 通用要求：真实名称、类型、距离、关键参数、
  // 动态效果的科学解释、数据来源）
  for (const b of SPECIAL_BODIES) {
    catalog.set(b.id, {
      id: b.id,
      name: b.name,
      nameZh: b.nameZh,
      typeZh: b.typeZh,
      lines: [
        // R4-10 修复：factsZh 已含"距离"行（3C 273/触须星系富文本）时以
        // 其为准，不再叠加自动距离行——避免同卡重复行（React 同 key 告警）
        ...(b.factsZh.some((f) => f.label === '距离')
          ? []
          : [{ label: '距离', value: formatLightYears(b.realDistanceLy) }]),
        ...b.factsZh,
        { label: '动态效果', value: b.dynamicsZh },
      ],
      dataSource: b.dataSource,
    });
  }

  // 银河系
  catalog.set(MILKY_WAY.id, {
    id: MILKY_WAY.id,
    name: MILKY_WAY.name,
    nameZh: MILKY_WAY.nameZh,
    typeZh: MORPHOLOGY_ZH[MILKY_WAY.morphology],
    lines: [
      { label: '直径', value: formatLightYears(MILKY_WAY.diameterLy) },
      { label: '盘厚度', value: formatLightYears(MILKY_WAY.diskThicknessLy) },
      { label: '主旋臂', value: MILKY_WAY.armNames.join('、') },
      {
        label: '结构',
        value: GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_ZH[MILKY_WAY.morphology],
      },
      { label: '银心', value: MILKY_WAY.sagittariusAStarZh },
    ],
    dataSource: `${MILKY_WAY.dataSource}；${GALAXY_STRUCTURE_SOURCE_ZH}`,
  });

  return catalog;
}

const CATALOG = buildCatalog();

/** 超新星事件/遗迹的通用信息条目（事件为运行时动态生成，id 前缀 sn-） */
const SUPERNOVA_INFO: Omit<BodyInfo, 'id'> = {
  name: 'Supernova (Core-collapse)',
  nameZh: '超新星爆炸',
  typeZh: '动态事件（核坍缩超新星）',
  lines: [
    { label: '阶段', value: '增亮 → 冲击波扩张 → 衰减 → 永久遗迹' },
    { label: '冲击波', value: 'Sedov-Taylor 相，抛射物减速膨胀（r ∝ t^0.4）' },
    { label: '遗迹', value: '膨胀星云 + 致密天体（前身星 ≥ 20 M☉ 为黑洞，否则中子星）' },
    { label: '科学性说明', value: SN_REAL_FREQUENCY_NOTE_ZH },
  ],
  dataSource: 'Sedov (1959) 冲击波自相似解；核坍缩超新星理论（Woosley & Janka 2005）',
};

/**
 * 按 id 查询天体信息（信息面板入口）
 *
 * 超新星事件（sn- 前缀）为运行时动态生成，返回通用条目。
 */
export function getBodyInfoById(id: string): BodyInfo | undefined {
  if (id.startsWith('sn-')) {
    return { id, ...SUPERNOVA_INFO };
  }
  return CATALOG.get(id);
}
