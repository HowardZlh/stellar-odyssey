/**
 * 统一天体信息目录（信息面板用，需求 3.5.2）
 *
 * 聚合行星、太阳、矮行星、卫星、彗星、星系数据，
 * 输出可直接渲染的标签/值行。数据来源沿用各数据文件的标注。
 *
 * i18n（全站覆盖）：目录按 locale 各构建一份（懒加载缓存）——
 * `getBodyInfoById(id)` 默认 zh（既有测试断言零改动），en 目录的
 * 值行按英文生成（数据层 `*En` 字段缺失时回退中文，豁免登记沿用）；
 * 标签列（line.label）与类型行（typeZh）恒为中文键，由 UI 层
 * `localizeCatalogText` 直映射（B3 既有口径不变）。
 */

import type { GalaxyData, GalaxyMorphology, Locale, MoonData, PlanetData } from '@/types';
import { pickLocalized } from '@/i18n';
import { PLANETS, SUN } from '@/data/planets';
import { MOONS } from '@/data/moons';
import { COMETS, DWARF_PLANETS, PLUTO } from '@/data/smallBodies';
import {
  GALAXY_MOTION_NOTE_EN,
  GALAXY_MOTION_NOTE_ZH,
  LOCAL_GROUP_GALAXIES,
  MILKY_WAY,
} from '@/data/galaxies';
import { SPECIAL_BODIES } from '@/data/specialBodies';
import {
  CORONAL_HEATING_NOTE_EN,
  CORONAL_HEATING_NOTE_ZH,
  CORONAL_HOLE_NOTE_EN,
  CORONAL_HOLE_NOTE_ZH,
  HALE_POLARITY_NOTE_EN,
  HALE_POLARITY_NOTE_ZH,
  SOLAR_WIND_NOTE_EN,
  SOLAR_WIND_NOTE_ZH,
} from '@/data/sunStructure';
import { OORT_INNER_AU, OORT_OUTER_AU } from '@/utils/oort';
import {
  HELIOPAUSE_REAL_DISTANCE_AU,
  HELIOPAUSE_SHAPE_NOTE_EN,
  HELIOPAUSE_SHAPE_NOTE_ZH,
  TERMINATION_SHOCK_REAL_DISTANCE_AU,
  VOYAGER_MARKERS,
} from '@/utils/heliopause';
import { SN_REAL_FREQUENCY_NOTE_EN, SN_REAL_FREQUENCY_NOTE_ZH } from '@/utils/supernova';
import {
  M87_ENVIRONMENT_SOURCE_EN,
  M87_ENVIRONMENT_SOURCE_ZH,
  M87_EXTRA_INFO_LINES_EN,
  M87_EXTRA_INFO_LINES_ZH,
} from '@/utils/m87Environment';
import {
  GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_EN,
  GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_ZH,
  GALAXY_STRUCTURE_SOURCE_EN,
  GALAXY_STRUCTURE_SOURCE_ZH,
} from '@/utils/galaxyNearView';
import {
  LMC_LANDMARK_NOTE_EN,
  LMC_LANDMARK_NOTE_ZH,
  LMC_LANDMARK_SOURCE_EN,
  LMC_LANDMARK_SOURCE_ZH,
} from '@/utils/lmcStructures';

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

/**
 * 光年距离友好格式：zh 态 ≥1 万光年时以"万光年"为单位（250万光年等）；
 * en 态 <100 万取 "N ly"、≥100 万取 "N million ly"
 */
function formatLightYears(ly: number, locale: Locale = 'zh'): string {
  if (locale === 'en') {
    if (ly < 1e6) {
      return `${formatNumber(ly)} ly`;
    }
    return `${formatNumber(Number((ly / 1e6).toFixed(2)))} million ly`;
  }
  if (ly < 1e4) {
    return `${formatNumber(ly)}光年`;
  }
  const wan = ly / 1e4;
  return `${formatNumber(Number(wan.toFixed(1)))}万光年`;
}

/** 自转周期（小时），负值表示逆向自转 */
function formatRotation(siderealPeriodHours: number, locale: Locale = 'zh'): string {
  const abs = Math.abs(siderealPeriodHours);
  if (locale === 'en') {
    const base = `${formatNumber(abs)} h`;
    return siderealPeriodHours < 0 ? `${base} (retrograde)` : base;
  }
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
function planetLines(p: PlanetData, locale: Locale): BodyInfoLine[] {
  const en = locale === 'en';
  const lines: BodyInfoLine[] = [
    { label: '半径', value: `${formatNumber(p.radiusKm)} km` },
  ];
  if (p.massKg !== undefined) {
    lines.push({ label: '质量', value: formatMassKg(p.massKg) });
  }
  lines.push(
    { label: '轨道半长轴', value: `${p.orbit.semiMajorAxisAu.toFixed(2)} AU` },
    { label: '离心率', value: p.orbit.eccentricity.toFixed(4) },
    {
      label: '公转周期',
      value: `${formatNumber(p.orbitalPeriodYears)} ${en ? 'yr' : '年'}`,
    },
    { label: '自转周期', value: formatRotation(p.rotation.siderealPeriodHours, locale) },
    { label: '轴倾角', value: `${p.rotation.axialTiltDeg.toFixed(2)}°` },
  );
  return lines;
}

/** 卫星周期：不足 1 天转为分钟显示（ISS 约 92.9 分钟） */
function formatMoonPeriod(periodDays: number, locale: Locale): string {
  const en = locale === 'en';
  if (periodDays < 1) {
    return `${(periodDays * 1440).toFixed(1)} ${en ? 'min' : '分钟'}`;
  }
  return `${periodDays.toFixed(2)} ${en ? 'days' : '天'}`;
}

/** 卫星信息行 */
function moonLines(m: MoonData, locale: Locale): BodyInfoLine[] {
  const en = locale === 'en';
  const lines: BodyInfoLine[] = [
    {
      label: '半径',
      value:
        m.kind === 'artificial'
          ? `${m.radiusKm} km${en ? ' (schematic size)' : '（示意尺寸）'}`
          : `${formatNumber(m.radiusKm)} km`,
    },
  ];
  // 人造卫星真实特征尺寸对照（P7 §3.2：示意尺寸与真实尺寸对照展示）
  if (m.kind === 'artificial' && m.spanMeters !== undefined) {
    lines.push({
      label: '真实特征尺寸',
      value: en
        ? `~${m.spanMeters} m (max span)`
        : `约 ${m.spanMeters} m（最大跨度）`,
    });
  }
  if (m.massKg !== undefined) {
    lines.push({ label: '质量', value: formatMassKg(m.massKg) });
  }
  lines.push(
    { label: '轨道半长轴', value: `${formatNumber(m.orbit.semiMajorAxisKm)} km` },
    { label: '公转周期', value: formatMoonPeriod(m.orbit.periodDays, locale) },
    {
      label: '轨道倾角',
      value:
        m.orbit.inclinationDeg > 90
          ? `${m.orbit.inclinationDeg}°${en ? ' (retrograde)' : '（逆行）'}`
          : `${m.orbit.inclinationDeg}°`,
    },
  );
  if (m.tidallyLocked) {
    lines.push({ label: '潮汐锁定', value: en ? 'Yes' : '是' });
  }
  if (m.noteZh) {
    lines.push({ label: '备注', value: pickLocalized(locale, m.noteZh, m.noteEn) });
  }
  return lines;
}

/** 星系视向速度：负值为接近，正值为退行 */
function formatRadialVelocity(v: number, locale: Locale): string {
  if (locale === 'en') {
    return v < 0 ? `approaching at ${Math.abs(v)} km/s` : `receding at ${v} km/s`;
  }
  return v < 0 ? `接近 ${Math.abs(v)} km/s` : `退行 ${v} km/s`;
}

/** 星系信息行（R2-8 §8.1：补结构说明行——核球/盘/晕，随时可见含跟随近观语境；
 * R2-10：补"运动（模拟）"行——轨迹线与运动同源核对结论逐星系登记；
 * R5-4：M87 增补 M87*·球状星团·室女座团三行（utils/m87Environment 登记） */
function galaxyLines(g: GalaxyData, locale: Locale): BodyInfoLine[] {
  const en = locale === 'en';
  const lines: BodyInfoLine[] = [
    { label: '距离', value: formatLightYears(g.distanceLy, locale) },
    { label: '直径', value: formatLightYears(g.diameterLy, locale) },
    { label: '视向速度', value: formatRadialVelocity(g.radialVelocityKmS, locale) },
    {
      label: '结构',
      value: en
        ? GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_EN[g.morphology]
        : GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_ZH[g.morphology],
    },
  ];
  const motion = en ? GALAXY_MOTION_NOTE_EN[g.id] : GALAXY_MOTION_NOTE_ZH[g.id];
  if (motion) {
    lines.push({ label: '运动（模拟）', value: motion });
  }
  if (g.id === 'm87') {
    lines.push(...(en ? M87_EXTRA_INFO_LINES_EN : M87_EXTRA_INFO_LINES_ZH));
  }
  // R5-5：LMC 标志结构行（30 Doradus + 中央棒色彩分层，近观联动）
  if (g.id === 'lmc') {
    lines.push({
      label: '标志结构',
      value: en ? LMC_LANDMARK_NOTE_EN : LMC_LANDMARK_NOTE_ZH,
    });
  }
  lines.push({
    label: '描述',
    value: pickLocalized(locale, g.descriptionZh, g.descriptionEn),
  });
  return lines;
}

/** 构建全量目录（按 locale 各构建一次、懒加载缓存，均为纯数据） */
function buildCatalog(locale: Locale): Map<string, BodyInfo> {
  const en = locale === 'en';
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
      {
        label: '结构分层',
        value: en
          ? 'Core → radiative zone → convective zone → photosphere → chromosphere → corona'
          : '核心 → 辐射区 → 对流区 → 光球 → 色球 → 日冕',
      },
      {
        label: '表面温度',
        value: en ? '~5,772 K (effective temperature)' : '约 5,772 K（有效温度）',
      },
      {
        label: '日冕温度',
        value: en
          ? `1–3 million K — ${CORONAL_HEATING_NOTE_EN}`
          : `1–3 百万 K——${CORONAL_HEATING_NOTE_ZH}`,
      },
      {
        label: '较差自转',
        value: en
          ? 'Equator 25.4 days / poles ~34 days (non-rigid)'
          : '赤道 25.4 天 / 极区约 34 天（非刚体）',
      },
      {
        label: '黑子',
        value: en
          ? `Cooler dark regions of ~3,500–4,500 °C; ${HALE_POLARITY_NOTE_EN}`
          : `约 3,500–4,500 °C 的低温暗区；${HALE_POLARITY_NOTE_ZH}`,
      },
      { label: '太阳风', value: en ? SOLAR_WIND_NOTE_EN : SOLAR_WIND_NOTE_ZH },
      { label: '日冕洞', value: en ? CORONAL_HOLE_NOTE_EN : CORONAL_HOLE_NOTE_ZH },
      {
        label: '活动周期',
        value: en
          ? '~11-year rise and fall (sunspot counts, flare/CME frequency and coronal shape vary with the cycle; the magnetic field flips every 22 years — the Hale cycle)'
          : '约 11 年消长（黑子数/耀斑/CME 频率/日冕形态随周期变化，磁场 22 年反转即 Hale 周期）',
      },
    ],
    dataSource: en
      ? `${SUN.dataSource}; differential rotation Snodgrass & Ulrich (1990); coronal heating Klimchuk (2006)`
      : `${SUN.dataSource}；较差自转 Snodgrass & Ulrich (1990)；日冕加热 Klimchuk (2006)`,
  });

  // 八大行星
  for (const p of PLANETS) {
    catalog.set(p.id, {
      id: p.id,
      name: p.name,
      nameZh: p.nameZh,
      typeZh: '行星',
      lines: planetLines(p, locale),
      dataSource: pickLocalized(locale, p.dataSource, p.dataSourceEn),
    });
  }

  // 矮行星（IAU 官方 5 颗：谷神星/冥王星/妊神星/鸟神星/阋神星，需求 3.1.1 / P5 §3.1）：
  // 均标注轨道倾角；冥王星额外标注海王星共振；谷神星附注小行星带与 Dawn 探测；
  // 无探测器实拍图的三颗（阋神星/鸟神星/妊神星）注明表面为艺术化呈现（P5 §3.4 登记）
  for (const d of DWARF_PLANETS) {
    const lines: BodyInfoLine[] = [
      ...planetLines(d, locale),
      { label: '轨道倾角', value: `${d.orbit.inclinationDeg.toFixed(1)}°` },
    ];
    if (d.id === PLUTO.id) {
      lines.push({ label: '共振', value: en ? '2:3 with Neptune' : '与海王星 2:3' });
    }
    if (d.id === 'ceres') {
      lines.push({
        label: '备注',
        value: en
          ? 'Largest body in the asteroid belt; orbited by the Dawn spacecraft in 2015'
          : '小行星带中最大天体，Dawn 探测器 2015 年环绕探测',
      });
    }
    if (d.id === 'haumea') {
      lines.push({
        label: '形状',
        value: en
          ? 'Triaxial ellipsoid 2100×1680×1074 km (flattened by its rapid 3.9-hour spin)'
          : '三轴椭球 2100×1680×1074 km（3.9 小时快速自转甩扁）',
      });
    }
    if (d.id === 'eris' || d.id === 'makemake' || d.id === 'haumea') {
      lines.push({
        label: '备注',
        value: en
          ? 'Surface details are an artistic rendering based on observations (no spacecraft imagery)'
          : '表面细节为基于观测数据的艺术化呈现（无探测器实拍图）',
      });
    }
    catalog.set(d.id, {
      id: d.id,
      name: d.name,
      nameZh: d.nameZh,
      typeZh: '矮行星',
      lines,
      dataSource: pickLocalized(locale, d.dataSource, d.dataSourceEn),
    });
  }

  // 卫星（自然 + 人造）
  for (const m of MOONS) {
    catalog.set(m.id, {
      id: m.id,
      name: m.name,
      nameZh: m.nameZh,
      typeZh: m.kind === 'natural' ? '卫星' : '人造卫星',
      lines: moonLines(m, locale),
      dataSource: pickLocalized(locale, m.dataSource, m.dataSourceEn),
    });
  }

  // 彗星：倾角 >90° 标注逆行，附近日点/远日点距离
  for (const c of COMETS) {
    const { semiMajorAxisAu: a, eccentricity: e, inclinationDeg: i } = c.orbit;
    const lines: BodyInfoLine[] = [
      { label: '轨道半长轴', value: `${a.toFixed(2)} AU` },
      { label: '离心率', value: e.toFixed(4) },
      {
        label: '轨道倾角',
        value: i > 90 ? `${i}°${en ? ' (retrograde)' : '（逆行）'}` : `${i}°`,
      },
      { label: '公转周期', value: `${c.orbitalPeriodYears} ${en ? 'yr' : '年'}` },
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
      dataSource: pickLocalized(locale, c.dataSource, c.dataSourceEn),
    });
  }

  // 奥尔特云外边界示意（可选需求 3.1.1：L2 与 L3 之间的过渡参照物）
  catalog.set('oort-cloud', {
    id: 'oort-cloud',
    name: 'Oort Cloud (outer boundary, schematic)',
    nameZh: '奥尔特云外边界（示意）',
    typeZh: '太阳系外围结构',
    lines: [
      {
        label: '内缘',
        value: en ? `~${formatNumber(OORT_INNER_AU)} AU` : `约 ${formatNumber(OORT_INNER_AU)} AU`,
      },
      {
        label: '外缘',
        value: en
          ? `~${formatNumber(OORT_OUTER_AU)} AU (~1.58 ly)`
          : `约 ${formatNumber(OORT_OUTER_AU)} AU（约 1.58 光年）`,
      },
      {
        label: '组成',
        value: en
          ? 'Spherical-shell reservoir of long-period comets (the boundary of the Sun\u2019s gravitational dominance)'
          : '球壳状长周期彗星库（太阳引力主导范围的边界）',
      },
      {
        label: '示意说明',
        value: en
          ? 'True scale far exceeds the scene; the shell radius is a compressed schematic value (registered)'
          : '真实尺度远超场景范围，球壳半径为压缩示意值（已登记）',
      },
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
      {
        label: '距离',
        value: en
          ? `~${HELIOPAUSE_REAL_DISTANCE_AU} AU`
          : `约 ${HELIOPAUSE_REAL_DISTANCE_AU} AU`,
      },
      {
        label: '定义',
        value: en
          ? 'The boundary where solar-wind and interstellar-medium pressures balance (outer edge of the heliosphere)'
          : '太阳风与星际介质压力平衡的边界（日球层 Heliosphere 外缘）',
      },
      {
        label: '结构分层',
        value: en
          ? `Termination shock (~${TERMINATION_SHOCK_REAL_DISTANCE_AU} AU, solar wind slows to subsonic) → heliosheath (turbulent transition) → heliopause (~${HELIOPAUSE_REAL_DISTANCE_AU} AU outer boundary)`
          : `终端激波（~${TERMINATION_SHOCK_REAL_DISTANCE_AU} AU，太阳风减速至亚声速）→ 日鞘（湍流渐变区）→ 日球层顶（~${HELIOPAUSE_REAL_DISTANCE_AU} AU 外边界）`,
      },
      { label: '形态', value: en ? HELIOPAUSE_SHAPE_NOTE_EN : HELIOPAUSE_SHAPE_NOTE_ZH },
      {
        label: '探测',
        value: en
          ? 'Crossed by Voyager 1 (2012) and Voyager 2 (2018), measured at ~119–121 AU'
          : '旅行者 1 号（2012）、旅行者 2 号（2018）先后穿越，实测约 119–121 AU',
      },
      {
        label: '示意说明',
        value: en
          ? 'Shell radius is a compressed schematic value (the real ~120 AU far exceeds the planetary-region scale, registered)'
          : '球壳半径为压缩示意值（真实 ~120 AU 远超行星区尺度，已登记）',
      },
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
        { label: '发射', value: pickLocalized(locale, v.launchDateZh, v.launchDateEn) },
        {
          label: '穿越日球层顶',
          value: en
            ? `${v.crossedYear} (~${v.crossedDistanceAu} AU from the Sun)`
            : `${v.crossedYear} 年（距太阳约 ${v.crossedDistanceAu} AU）`,
        },
        { label: '备注', value: pickLocalized(locale, v.noteZh, v.noteEn) },
        {
          label: '携带',
          value: en ? 'The Golden Record (Sounds of Earth)' : '金唱片（地球之音，Golden Record）',
        },
        {
          label: '示意说明',
          value: en
            ? 'Marker position converted schematically from crossing distance and ecliptic latitude (longitude schematic, registered)'
            : '标记位置按穿越距离与黄纬示意换算（方向经度为示意，已登记）',
        },
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
      lines: galaxyLines(g, locale),
      // i18n：来源段按 locale 取用（分隔符 zh 全角"；"/ en "; "）
      dataSource: ((): string => {
        const sep = en ? '; ' : '；';
        const structure = en ? GALAXY_STRUCTURE_SOURCE_EN : GALAXY_STRUCTURE_SOURCE_ZH;
        const base = `${g.dataSource}${sep}${structure}`;
        if (g.id === 'm87') {
          return `${base}${sep}${en ? M87_ENVIRONMENT_SOURCE_EN : M87_ENVIRONMENT_SOURCE_ZH}`;
        }
        if (g.id === 'lmc') {
          // R5-5：LMC 标志结构来源（30 Dor 位置换算/棒分层登记）
          return `${base}${sep}${en ? LMC_LANDMARK_SOURCE_EN : LMC_LANDMARK_SOURCE_ZH}`;
        }
        return base;
      })(),
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
          : [{ label: '距离', value: formatLightYears(b.realDistanceLy, locale) }]),
        ...b.factsZh.map((f) => ({
          label: f.label,
          value: pickLocalized(locale, f.value, f.valueEn),
        })),
        { label: '动态效果', value: pickLocalized(locale, b.dynamicsZh, b.dynamicsEn) },
      ],
      dataSource: pickLocalized(locale, b.dataSource, b.dataSourceEn),
    });
  }

  // 银河系
  catalog.set(MILKY_WAY.id, {
    id: MILKY_WAY.id,
    name: MILKY_WAY.name,
    nameZh: MILKY_WAY.nameZh,
    typeZh: MORPHOLOGY_ZH[MILKY_WAY.morphology],
    lines: [
      { label: '直径', value: formatLightYears(MILKY_WAY.diameterLy, locale) },
      { label: '盘厚度', value: formatLightYears(MILKY_WAY.diskThicknessLy, locale) },
      {
        label: '主旋臂',
        value: en ? MILKY_WAY.armNamesEn.join(', ') : MILKY_WAY.armNames.join('、'),
      },
      {
        label: '结构',
        value: en
          ? GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_EN[MILKY_WAY.morphology]
          : GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_ZH[MILKY_WAY.morphology],
      },
      {
        label: '银心',
        value: en ? MILKY_WAY.sagittariusAStarEn : MILKY_WAY.sagittariusAStarZh,
      },
    ],
    dataSource: en
      ? `${MILKY_WAY.dataSourceEn}; ${GALAXY_STRUCTURE_SOURCE_EN}`
      : `${MILKY_WAY.dataSource}；${GALAXY_STRUCTURE_SOURCE_ZH}`,
  });

  return catalog;
}

/** 按 locale 懒加载缓存（zh 目录模块加载即建——既有消费路径零变化） */
const CATALOGS: Partial<Record<Locale, Map<string, BodyInfo>>> = {
  zh: buildCatalog('zh'),
};

function catalogFor(locale: Locale): Map<string, BodyInfo> {
  const cached = CATALOGS[locale];
  if (cached) return cached;
  const built = buildCatalog(locale);
  CATALOGS[locale] = built;
  return built;
}

/** 超新星事件/遗迹的通用信息条目（事件为运行时动态生成，id 前缀 sn-） */
function supernovaInfo(locale: Locale): Omit<BodyInfo, 'id'> {
  const en = locale === 'en';
  return {
    name: 'Supernova (Core-collapse)',
    nameZh: '超新星爆炸',
    typeZh: '动态事件（核坍缩超新星）',
    lines: [
      {
        label: '阶段',
        value: en
          ? 'Brightening → shock expansion → decay → permanent remnant'
          : '增亮 → 冲击波扩张 → 衰减 → 永久遗迹',
      },
      {
        label: '冲击波',
        value: en
          ? 'Sedov–Taylor phase; ejecta decelerate as they expand (r ∝ t^0.4)'
          : 'Sedov-Taylor 相，抛射物减速膨胀（r ∝ t^0.4）',
      },
      {
        label: '遗迹',
        value: en
          ? 'Expanding nebula + compact object (a black hole if the progenitor is ≥ 20 M☉, otherwise a neutron star)'
          : '膨胀星云 + 致密天体（前身星 ≥ 20 M☉ 为黑洞，否则中子星）',
      },
      {
        label: '科学性说明',
        value: en ? SN_REAL_FREQUENCY_NOTE_EN : SN_REAL_FREQUENCY_NOTE_ZH,
      },
    ],
    dataSource: en
      ? 'Sedov (1959) self-similar blast-wave solution; core-collapse supernova theory (Woosley & Janka 2005)'
      : 'Sedov (1959) 冲击波自相似解；核坍缩超新星理论（Woosley & Janka 2005）',
  };
}

/**
 * 按 id 查询天体信息（信息面板入口）
 *
 * 超新星事件（sn- 前缀）为运行时动态生成，返回通用条目。
 *
 * @param locale 目录语言（默认 zh——既有消费方与测试零改动）
 */
export function getBodyInfoById(id: string, locale: Locale = 'zh'): BodyInfo | undefined {
  if (id.startsWith('sn-')) {
    return { id, ...supernovaInfo(locale) };
  }
  return catalogFor(locale).get(id);
}
