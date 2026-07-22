/**
 * 统一天体信息目录（信息面板用，需求 3.5.2）
 *
 * 聚合行星、太阳、矮行星、卫星、彗星、星系数据，
 * 输出可直接渲染的中文标签/值行。数据来源沿用各数据文件的标注。
 */

import type { GalaxyData, GalaxyMorphology, MoonData, PlanetData } from '@/types';
import { PLANETS, SUN } from '@/data/planets';
import { MOONS } from '@/data/moons';
import { COMETS, PLUTO } from '@/data/smallBodies';
import { LOCAL_GROUP_GALAXIES, MILKY_WAY } from '@/data/galaxies';
import { SPECIAL_BODIES } from '@/data/specialBodies';
import { SN_REAL_FREQUENCY_NOTE_ZH } from '@/utils/supernova';

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

/** 行星 / 矮行星的通用信息行 */
function planetLines(p: PlanetData): BodyInfoLine[] {
  return [
    { label: '半径', value: `${formatNumber(p.radiusKm)} km` },
    { label: '轨道半长轴', value: `${p.orbit.semiMajorAxisAu.toFixed(2)} AU` },
    { label: '离心率', value: p.orbit.eccentricity.toFixed(4) },
    { label: '公转周期', value: `${formatNumber(p.orbitalPeriodYears)} 年` },
    { label: '自转周期', value: formatRotation(p.rotation.siderealPeriodHours) },
    { label: '轴倾角', value: `${p.rotation.axialTiltDeg.toFixed(2)}°` },
  ];
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
    { label: '轨道半长轴', value: `${formatNumber(m.orbit.semiMajorAxisKm)} km` },
    { label: '公转周期', value: formatMoonPeriod(m.orbit.periodDays) },
    { label: '轨道倾角', value: `${m.orbit.inclinationDeg}°` },
  ];
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

/** 星系信息行 */
function galaxyLines(g: GalaxyData): BodyInfoLine[] {
  return [
    { label: '距离', value: formatLightYears(g.distanceLy) },
    { label: '直径', value: formatLightYears(g.diameterLy) },
    { label: '视向速度', value: formatRadialVelocity(g.radialVelocityKmS) },
    { label: '描述', value: g.descriptionZh },
  ];
}

/** 构建全量目录（模块加载时一次性生成，均为纯数据） */
function buildCatalog(): Map<string, BodyInfo> {
  const catalog = new Map<string, BodyInfo>();

  // 太阳
  catalog.set(SUN.id, {
    id: SUN.id,
    name: SUN.name,
    nameZh: SUN.nameZh,
    typeZh: '恒星',
    lines: [{ label: '半径', value: `${formatNumber(SUN.radiusKm)} km` }],
    dataSource: SUN.dataSource,
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

  // 冥王星（矮行星）：额外标注轨道倾角与海王星共振
  catalog.set(PLUTO.id, {
    id: PLUTO.id,
    name: PLUTO.name,
    nameZh: PLUTO.nameZh,
    // PLUTO.classificationZh 固定为 '矮行星'（smallBodies.ts），直接使用
    typeZh: '矮行星',
    lines: [
      ...planetLines(PLUTO),
      { label: '轨道倾角', value: `${PLUTO.orbit.inclinationDeg.toFixed(1)}°` },
      { label: '共振', value: '与海王星 2:3' },
    ],
    dataSource: PLUTO.dataSource,
  });

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
    catalog.set(c.id, {
      id: c.id,
      name: c.name,
      nameZh: c.nameZh,
      typeZh: '彗星',
      lines: [
        { label: '轨道半长轴', value: `${a.toFixed(2)} AU` },
        { label: '离心率', value: e.toFixed(4) },
        { label: '轨道倾角', value: i > 90 ? `${i}°（逆行）` : `${i}°` },
        { label: '公转周期', value: `${c.orbitalPeriodYears} 年` },
        { label: '近日点距离', value: `${(a * (1 - e)).toFixed(1)} AU` },
        { label: '远日点距离', value: `${(a * (1 + e)).toFixed(1)} AU` },
      ],
      dataSource: c.dataSource,
    });
  }

  // 本星系群及邻近星系
  for (const g of LOCAL_GROUP_GALAXIES) {
    catalog.set(g.id, {
      id: g.id,
      name: g.name,
      nameZh: g.nameZh,
      typeZh: MORPHOLOGY_ZH[g.morphology],
      lines: galaxyLines(g),
      dataSource: g.dataSource,
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
        { label: '距离', value: formatLightYears(b.realDistanceLy) },
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
      { label: '银心', value: MILKY_WAY.sagittariusAStarZh },
    ],
    dataSource: MILKY_WAY.dataSource,
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
