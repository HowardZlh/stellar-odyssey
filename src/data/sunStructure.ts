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
  /** 半径/厚度范围文案（英文） */
  rangeEn?: string;
  /** 温度文案 */
  temperatureZh: string;
  /** 温度文案（英文） */
  temperatureEn?: string;
  /** 科普说明 */
  descriptionZh: string;
  /** 科普说明（英文） */
  descriptionEn?: string;
}

/** 六层结构（从内到外，需求 §4.5 结构分层说明） */
export const SUN_LAYERS: readonly SunLayerInfo[] = [
  {
    id: 'core',
    nameZh: '核心',
    name: 'Core',
    rangeZh: '0–0.25 R☉',
    rangeEn: '0–0.25 R☉',
    temperatureZh: '约 1,570 万 K',
    temperatureEn: 'about 15.7 million K',
    descriptionZh:
      '核聚变反应区：氢经质子-质子链聚变为氦，每秒将约 400 万吨质量转化为能量，是太阳全部光和热的来源。',
    descriptionEn:
      'The nuclear fusion region: hydrogen fuses into helium via the proton–proton chain, converting about 4 million tonnes of mass into energy every second — the source of all the Sun\u2019s light and heat.',
  },
  {
    id: 'radiative',
    nameZh: '辐射区',
    name: 'Radiative zone',
    rangeZh: '0.25–0.7 R☉',
    rangeEn: '0.25–0.7 R☉',
    temperatureZh: '约 700 万 → 200 万 K',
    temperatureEn: 'about 7 million → 2 million K',
    descriptionZh:
      '能量以光子形式缓慢向外传输：单个光子被反复吸收再发射（随机游走），从核心逸出需数万至十几万年。与对流区交界处的差旋层（tachocline）被认为是太阳磁场发电机所在。',
    descriptionEn:
      'Energy travels slowly outward as photons: each photon is repeatedly absorbed and re-emitted (a random walk), taking tens of thousands to over a hundred thousand years to escape the core. The tachocline, the shear layer at the boundary with the convective zone, is thought to host the solar magnetic dynamo.',
  },
  {
    id: 'convective',
    nameZh: '对流区',
    name: 'Convective zone',
    rangeZh: '0.7–1.0 R☉',
    rangeEn: '0.7–1.0 R☉',
    temperatureZh: '约 200 万 → 5,772 K',
    temperatureEn: 'about 2 million → 5,772 K',
    descriptionZh:
      '能量通过等离子体对流传递：热物质上升、冷物质下沉，如沸腾的水；对流胞在表面呈现为米粒组织。',
    descriptionEn:
      'Energy is carried by convection of plasma: hot material rises and cooler material sinks, like boiling water; convection cells appear at the surface as granulation.',
  },
  {
    id: 'photosphere',
    nameZh: '光球',
    name: 'Photosphere',
    rangeZh: '厚约 500 km',
    rangeEn: 'about 500 km thick',
    temperatureZh: '约 5,772 K（有效温度）',
    temperatureEn: 'about 5,772 K (effective temperature)',
    descriptionZh: '我们看到的太阳"表面"：米粒组织翻滚、黑子（约 3,500–4,500 °C 的低温暗区）出没。',
    descriptionEn:
      'The visible "surface" of the Sun: churning granulation and sunspots (cooler dark regions at about 3,500–4,500 °C) come and go here.',
  },
  {
    id: 'chromosphere',
    nameZh: '色球',
    name: 'Chromosphere',
    rangeZh: '厚约 2,000 km',
    rangeEn: 'about 2,000 km thick',
    temperatureZh: '约 4,000–25,000 K',
    temperatureEn: 'about 4,000–25,000 K',
    descriptionZh: '光球上方的红色薄层（氢α 发射线 656 nm），日全食时呈现为日面边缘的红色细环。',
    descriptionEn:
      'A thin reddish layer above the photosphere (hydrogen-alpha emission line at 656 nm), visible during a total solar eclipse as a slender red ring around the limb of the Sun.',
  },
  {
    id: 'corona',
    nameZh: '日冕',
    name: 'Corona',
    rangeZh: '延伸数百万 km',
    rangeEn: 'extends millions of km',
    temperatureZh: '1–3 百万 K',
    temperatureEn: '1–3 million K',
    descriptionZh:
      '最外层大气，温度反而远高于表面——这就是"日冕加热问题"：加热机制仍是未解之谜（波加热/磁重联假说）。',
    descriptionEn:
      'The outermost atmosphere, paradoxically far hotter than the surface — the famous "coronal heating problem": the heating mechanism remains unsolved (wave-heating / magnetic-reconnection hypotheses).',
  },
] as const;

/** 按 id 查询分层条目 */
export function getSunLayerById(id: string): SunLayerInfo | undefined {
  return SUN_LAYERS.find((layer) => layer.id === id);
}

/** 日冕加热问题科普（§4.2/§4.5 反直觉现象须解释） */
export const CORONAL_HEATING_NOTE_ZH =
  '日冕温度高达百万 K，远高于表面 5,772 K——加热机制仍是未解之谜（波加热/磁重联假说）';

/** 日冕加热问题科普（英文） */
export const CORONAL_HEATING_NOTE_EN =
  'The corona reaches millions of K, far hotter than the 5,772 K surface — the heating mechanism remains an unsolved mystery (wave-heating / magnetic-reconnection hypotheses)';

/** Hale 极性定律科普（黑子成对出现，§4.3-1） */
export const HALE_POLARITY_NOTE_ZH =
  '黑子通常成对出现（前导/后随），同一半球黑子对磁极方向一致、南北半球相反，且每约 11 年反转一次（Hale 极性定律）';

/** Hale 极性定律科普（英文） */
export const HALE_POLARITY_NOTE_EN =
  'Sunspots usually appear in pairs (leading/trailing); pairs in the same hemisphere share the same magnetic polarity orientation, opposite between hemispheres, reversing about every 11 years (Hale\u2019s polarity law)';

/** 耀斑能量科普（§4.3-2） */
export const FLARE_ENERGY_NOTE_ZH =
  '大耀斑可在几分钟内释放相当于数十亿颗氢弹的能量，伴随 X 射线/紫外线/射电辐射增强';

/** 耀斑能量科普（英文） */
export const FLARE_ENERGY_NOTE_EN =
  'A major flare can release the energy of billions of hydrogen bombs within minutes, accompanied by enhanced X-ray, ultraviolet, and radio emission';

/** CME 地磁暴科普（§4.3-3） */
export const CME_GEOMAGNETIC_NOTE_ZH =
  '朝向地球的 CME 到达后可能引发地磁暴，影响卫星、电网和通信（携带的等离子体云约 1–3 天后抵达地球）';

/** CME 地磁暴科普（英文） */
export const CME_GEOMAGNETIC_NOTE_EN =
  'An Earth-directed CME can trigger a geomagnetic storm on arrival, affecting satellites, power grids, and communications (the plasma cloud it carries reaches Earth in about 1–3 days)';

/** 日冕洞科普（S3 §4.2） */
export const CORONAL_HOLE_NOTE_ZH =
  '日冕洞是日冕中磁力线向外开放的区域，在 EUV/X 射线下呈暗斑；它是高速太阳风（~800 km/s，远快于慢风 ~400 km/s）的主要源头，常驻于太阳极区';

/** 日冕洞科普（英文） */
export const CORONAL_HOLE_NOTE_EN =
  'Coronal holes are regions of the corona where magnetic field lines open outward, appearing as dark patches in EUV/X-ray images; they are the main source of the fast solar wind (~800 km/s, much faster than the slow wind at ~400 km/s) and persist near the solar poles';

/** 太阳风科普（§4.3-4） */
export const SOLAR_WIND_NOTE_ZH =
  '太阳风是从日冕持续外流的带电粒子流（质子/电子），速度 400–800 km/s，吹出的空腔形成太阳圈（Heliosphere），保护太阳系免受星际辐射';

/** 太阳风科普（英文） */
export const SOLAR_WIND_NOTE_EN =
  'The solar wind is a continuous outflow of charged particles (protons/electrons) from the corona at 400–800 km/s; the cavity it carves out forms the heliosphere, shielding the solar system from interstellar radiation';

/** 结构数据来源（信息面板/剖面卡片展示） */
export const SUN_STRUCTURE_DATA_SOURCE =
  'NASA Sun Fact Sheet；标准太阳模型 Christensen-Dalsgaard et al. (1996)；日冕加热 Klimchuk (2006)';
