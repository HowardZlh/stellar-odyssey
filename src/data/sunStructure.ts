/**
 * 太阳结构分层与活动科普数据（S2，IMPROVEMENT_REQUIREMENTS_SOLAR §4.1/§4.5）
 *
 * 数据来源：NASA Sun Fact Sheet（半径/温度）；标准太阳模型分层半径
 * （Christensen-Dalsgaard et al. 1996, Science 272, 1286）；日冕加热问题
 * 综述（Klimchuk 2006）；Hale 极性定律（Hale et al. 1919）。
 */

import type { SunCutawayLayerId } from '@/utils/sunCutaway';

/** 单个结构分层的科普条目 */
export interface SunLayerInfo {
  /** 分层 id（剖面可点选层用 SunCutawayLayerId，大气层用字符串） */
  id: SunCutawayLayerId | 'photosphere' | 'chromosphere' | 'corona';
  nameZh: string;
  name: string;
  /** 半径/厚度范围文案 */
  rangeZh: string;
  /** 温度文案 */
  temperatureZh: string;
  /** 科普说明 */
  descriptionZh: string;
}

/** 六层结构（从内到外，需求 §4.5 结构分层说明） */
export const SUN_LAYERS: readonly SunLayerInfo[] = [
  {
    id: 'core',
    nameZh: '核心',
    name: 'Core',
    rangeZh: '0–0.25 R☉',
    temperatureZh: '约 1,570 万 K',
    descriptionZh:
      '核聚变反应区：氢经质子-质子链聚变为氦，每秒将约 400 万吨质量转化为能量，是太阳全部光和热的来源。',
  },
  {
    id: 'radiative',
    nameZh: '辐射区',
    name: 'Radiative zone',
    rangeZh: '0.25–0.7 R☉',
    temperatureZh: '约 700 万 → 200 万 K',
    descriptionZh:
      '能量以光子形式缓慢向外传输：单个光子被反复吸收再发射（随机游走），从核心逸出需数万至十几万年。与对流区交界处的差旋层（tachocline）被认为是太阳磁场发电机所在。',
  },
  {
    id: 'convective',
    nameZh: '对流区',
    name: 'Convective zone',
    rangeZh: '0.7–1.0 R☉',
    temperatureZh: '约 200 万 → 5,772 K',
    descriptionZh:
      '能量通过等离子体对流传递：热物质上升、冷物质下沉，如沸腾的水；对流胞在表面呈现为米粒组织。',
  },
  {
    id: 'photosphere',
    nameZh: '光球',
    name: 'Photosphere',
    rangeZh: '厚约 500 km',
    temperatureZh: '约 5,772 K（有效温度）',
    descriptionZh: '我们看到的太阳"表面"：米粒组织翻滚、黑子（约 3,500–4,500 °C 的低温暗区）出没。',
  },
  {
    id: 'chromosphere',
    nameZh: '色球',
    name: 'Chromosphere',
    rangeZh: '厚约 2,000 km',
    temperatureZh: '约 4,000–25,000 K',
    descriptionZh: '光球上方的红色薄层（氢α 发射线 656 nm），日全食时呈现为日面边缘的红色细环。',
  },
  {
    id: 'corona',
    nameZh: '日冕',
    name: 'Corona',
    rangeZh: '延伸数百万 km',
    temperatureZh: '1–3 百万 K',
    descriptionZh:
      '最外层大气，温度反而远高于表面——这就是"日冕加热问题"：加热机制仍是未解之谜（波加热/磁重联假说）。',
  },
] as const;

/** 按 id 查询分层条目 */
export function getSunLayerById(id: string): SunLayerInfo | undefined {
  return SUN_LAYERS.find((layer) => layer.id === id);
}

/** 日冕加热问题科普（§4.2/§4.5 反直觉现象须解释） */
export const CORONAL_HEATING_NOTE_ZH =
  '日冕温度高达百万 K，远高于表面 5,772 K——加热机制仍是未解之谜（波加热/磁重联假说）';

/** Hale 极性定律科普（黑子成对出现，§4.3-1） */
export const HALE_POLARITY_NOTE_ZH =
  '黑子通常成对出现（前导/后随），同一半球黑子对磁极方向一致、南北半球相反，且每约 11 年反转一次（Hale 极性定律）';

/** 耀斑能量科普（§4.3-2） */
export const FLARE_ENERGY_NOTE_ZH =
  '大耀斑可在几分钟内释放相当于数十亿颗氢弹的能量，伴随 X 射线/紫外线/射电辐射增强';

/** CME 地磁暴科普（§4.3-3） */
export const CME_GEOMAGNETIC_NOTE_ZH =
  '朝向地球的 CME 到达后可能引发地磁暴，影响卫星、电网和通信（携带的等离子体云约 1–3 天后抵达地球）';

/** 太阳风科普（§4.3-4） */
export const SOLAR_WIND_NOTE_ZH =
  '太阳风是从日冕持续外流的带电粒子流（质子/电子），速度 400–800 km/s，吹出的空腔形成太阳圈（Heliosphere），保护太阳系免受星际辐射';

/** 结构数据来源（信息面板/剖面卡片展示） */
export const SUN_STRUCTURE_DATA_SOURCE =
  'NASA Sun Fact Sheet；标准太阳模型 Christensen-Dalsgaard et al. (1996)；日冕加热 Klimchuk (2006)';
