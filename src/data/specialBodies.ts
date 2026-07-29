/**
 * 特殊天体数据（需求 3.1.5）：每个条目基于真实原型天体，
 * 含"静态形态"参数与"动态效果"科学解释。
 *
 * 数据来源：
 * - 参宿四/参宿七/天狼星：NASA/ESA Hipparcos-Gaia 视差与光谱数据
 * - 蟹状星云脉冲星：NASA Chandra/HST（自转周期约 33 ms）
 * - 人马座A*：GRAVITY Collaboration (2019)，质量约 430 万太阳质量
 * - 猎户座星云/环状星云 M57/球状星团 M13：NASA HST 公开观测数据
 * - 3C 273：NED（距离约 24 亿光年，首个被确认的类星体）
 *
 * 近似处理登记（需求 4.1 视觉夸大处理原则）：
 * - sun-relative 天体的 offsetLy 为视觉夸大的示意偏移（真实距离仅数光年至
 *   数千光年，在 L3 尺度 0.05 单位/光年下不可分辨），真实距离在
 *   realDistanceLy 与信息面板中如实标注；
 * - offsetLy.y 按真实银纬推算（R3-6 §6.1-A）：y = round(√(x²+z²) × tan(b))，
 *   b 为该天体真实银纬（来源 SIMBAD，逐天体注释登记）——"从太阳看的方向
 *   按真实银纬、水平距离（x/z）仍为视觉示意"口径；
 * - visualRadiusLy 为可视化尺寸，非真实半径；
 * - 特殊天体随太阳一起绕银心共转（近似：太阳邻域恒星与太阳共转）。
 */

import type { SpecialBodyData } from "@/types";

/** 天狼星双星可视化轨道周期（秒，真实约 50 年——按 3.3 速率钳制策略降速显示） */
export const SIRIUS_VISUAL_ORBIT_PERIOD_SEC = 24;

/** 天狼星质量比 mA/mB ≈ 2.06/1.02 */
export const SIRIUS_MASS_RATIO = 2.06 / 1.02;

/** 蟹状脉冲星可视化自转周期（秒，真实 33 ms——降频表现，已登记） */
export const PULSAR_VISUAL_SPIN_PERIOD_SEC = 2.4;

export const SPECIAL_BODIES: readonly SpecialBodyData[] = [
  {
    id: "betelgeuse",
    name: "Betelgeuse",
    nameZh: "参宿四",
    kind: "red-giant",
    typeZh: "红巨星（红超巨星）",
    level: "L3",
    positionMode: "sun-relative",
    // 银纬 b ≈ −9.0°（SIMBAD α Ori）：y = round(3220 × tan(−9.0°)) = −510
    offsetLy: { x: 2600, y: -510, z: -1900 },
    realDistanceLy: 640,
    visualRadiusLy: 260,
    color: "#ff6a3c",
    factsZh: [
      { label: "表面温度", value: "约 3,500 K（橙红色）" },
      { label: "半径", value: "约太阳 900 倍" },
      { label: "尺度对比", value: "置于太阳位置将吞没火星轨道" },
      { label: "真实距离", value: "约 640 光年" },
    ],
    dynamicsZh:
      "半规则变星：表面亮度缓慢不规则脉动（多个脉动周期叠加），外层有弥散气体壳",
    dataSource: "NASA/ESA Hipparcos-Gaia；ESO VLT 干涉测量",
  },
  {
    id: "rigel",
    name: "Rigel",
    nameZh: "参宿七",
    kind: "blue-giant",
    typeZh: "蓝超巨星",
    level: "L3",
    positionMode: "sun-relative",
    // 银纬 b ≈ −25.1°（SIMBAD β Ori）：y = round(4061 × tan(−25.1°)) = −1902
    offsetLy: { x: -3200, y: -1902, z: 2500 },
    realDistanceLy: 860,
    visualRadiusLy: 190,
    color: "#a9c8ff",
    factsZh: [
      { label: "表面温度", value: "约 12,000 K（蓝白色）" },
      { label: "光度", value: "约太阳 12 万倍" },
      { label: "真实距离", value: "约 860 光年" },
    ],
    dynamicsZh: "高频微闪烁（大气湍动与星风），强光晕与星风粒子外流",
    dataSource: "NASA/ESA Hipparcos-Gaia 光谱与视差数据",
  },
  {
    id: "sirius",
    name: "Sirius A/B",
    nameZh: "天狼星A/B",
    kind: "binary-white-dwarf",
    typeZh: "双星系统（主序星 + 白矮星）",
    level: "L3",
    positionMode: "sun-relative",
    // 银纬 b ≈ −8.9°（SIMBAD α CMa）：y = round(3178 × tan(−8.9°)) = −498
    offsetLy: { x: 1300, y: -498, z: 2900 },
    realDistanceLy: 8.6,
    visualRadiusLy: 110,
    color: "#eef4ff",
    factsZh: [
      { label: "天狼星A", value: "A1V 主序星，约 2.06 太阳质量" },
      { label: "天狼星B", value: "白矮星，约地球大小但质量近太阳（高密度）" },
      { label: "轨道周期", value: "约 50 年（互绕，按时间压缩比降速呈现）" },
      { label: "真实距离", value: "约 8.6 光年（最亮恒星）" },
    ],
    dynamicsZh:
      "白矮星天狼星B与主星天狼星A组成双星系统，绕共同质心互绕运动（质量比约 2:1，白矮星轨道半径更大）",
    dataSource: "NASA HST 双星轨道测量；Bond et al. (2017)",
  },
  {
    id: "crab-pulsar",
    name: "Crab Pulsar / Crab Nebula (M1)",
    nameZh: "蟹状星云脉冲星",
    kind: "pulsar-remnant",
    typeZh: "中子星/脉冲星（超新星遗迹中心）",
    level: "L3",
    positionMode: "sun-relative",
    // 银纬 b ≈ −5.8°（SIMBAD PSR B0531+21 / M1）：y = round(5301 × tan(−5.8°)) = −538
    offsetLy: { x: -4300, y: -538, z: -3100 },
    realDistanceLy: 6500,
    visualRadiusLy: 210,
    color: "#9fd8ff",
    factsZh: [
      { label: "自转周期", value: "约 33 ms（可视化降频表现，已登记）" },
      { label: "前身星", value: "1054 年超新星（SN 1054，宋代天关客星）" },
      { label: "遗迹", value: "蟹状星云：丝状扩张结构" },
      { label: "真实距离", value: "约 6,500 光年" },
    ],
    dynamicsZh:
      "双极射束随中子星自转扫描（灯塔效应），射束扫过视线方向时产生周期性脉冲闪烁；外围为超新星遗迹丝状膨胀星云",
    dataSource:
      "NASA Chandra/HST 蟹状星云观测；Lyne & Graham-Smith, Pulsar Astronomy",
  },
  {
    id: "sgr-a-star",
    name: "Sagittarius A*",
    nameZh: "人马座A*",
    kind: "black-hole",
    typeZh: "超大质量黑洞（银心）",
    level: "L3",
    positionMode: "galactic-center",
    realDistanceLy: 26000,
    visualRadiusLy: 300,
    color: "#ffb36b",
    factsZh: [
      { label: "质量", value: "约 430 万太阳质量" },
      { label: "位置", value: "银河系中心（距太阳约 2.6 万光年）" },
      { label: "事件视界", value: "纯黑球体（光无法逃逸）" },
      { label: "吸积盘", value: "发光气体环，内圈快外圈慢（较差旋转）" },
    ],
    dynamicsZh:
      "吸积盘按开普勒较差旋转（角速度 ∝ r^-3/2，内圈快外圈慢），接近侧因多普勒集束增亮；近观切换引力透镜 raymarch：光子环 + 背景星光弯曲 + 吸积盘上下缘翻折像",
    dataSource:
      "GRAVITY Collaboration (2019)；EHT 2022 人马座A* 成像；近观透镜为 Schwarzschild 二阶弯曲近似（视界渲染半径按可视化比例压缩、背景为程序化星场近似）；盘色为黑体色档艺术化映射（峰值 ≈4,600 K 橙红，实际银心吸积流为射电/亚毫米波段亮度）",
  },
  {
    id: "orion-nebula",
    name: "Orion Nebula (M42)",
    nameZh: "猎户座星云",
    kind: "emission-nebula",
    typeZh: "发射星云",
    level: "L3",
    positionMode: "sun-relative",
    // 银纬 b ≈ −19.4°（SIMBAD M42）：y = round(4031 × tan(−19.4°)) = −1420
    offsetLy: { x: 3700, y: -1420, z: 1600 },
    realDistanceLy: 1350,
    visualRadiusLy: 240,
    color: "#ff9bb5",
    factsZh: [
      { label: "颜色", value: "粉红/红色（氢α发射线）" },
      { label: "直径", value: "约 24 光年" },
      { label: "真实距离", value: "约 1,350 光年" },
      { label: "内部", value: "猎户四边形星团等年轻恒星点亮局部" },
      {
        label: "结构",
        value: "电离腔（扇贝状发射腔朝观察侧开口）+ 四边形星团空腔 + 东南前景尘埃湾",
      },
    ],
    dynamicsZh:
      "内部年轻大质量恒星的紫外辐射电离氢气发出氢α红光，雾状气体缓慢流动",
    dataSource:
      "NASA HST 猎户座星云观测（M42）；近观体积形态参考 NASA/ESA Hubble 公版图像（程序化近似）；体积色彩为自然色近似（Hα 红棕 + OIII 青灰），与哈勃调色板（SII/Hα/OIII→RGB 假彩色，Hα 显绿）存在映射差异",
  },
  {
    id: "ring-nebula",
    name: "Ring Nebula (M57)",
    nameZh: "环状星云",
    kind: "planetary-nebula",
    typeZh: "行星状星云",
    level: "L3",
    positionMode: "sun-relative",
    // 银纬 b ≈ +14.0°（SIMBAD M57）：y = round(4031 × tan(+14.0°)) = +1005
    offsetLy: { x: -1600, y: 1005, z: 3700 },
    realDistanceLy: 2300,
    visualRadiusLy: 150,
    color: "#7fe8d8",
    factsZh: [
      { label: "结构", value: "环壳状抛射气体 + 中心白矮星" },
      { label: "膨胀速度", value: "约 20–30 km/s（缓慢膨胀）" },
      { label: "真实距离", value: "约 2,300 光年" },
    ],
    dynamicsZh:
      "类太阳恒星晚年抛出外层气体形成环壳，中心残留白矮星；壳层持续缓慢膨胀（动画为艺术化加速）",
    dataSource: "NASA HST 环状星云观测（M57）",
  },
  {
    id: "m13-cluster",
    name: "Great Hercules Cluster (M13)",
    nameZh: "武仙座球状星团",
    kind: "globular-cluster",
    typeZh: "球状星团（银晕）",
    level: "L3",
    positionMode: "sun-relative",
    // 银纬 b ≈ +40.9°（SIMBAD M13）：y = round(5608 × tan(+40.9°)) = +4858（高悬银晕）
    offsetLy: { x: -2100, y: 4858, z: -5200 },
    realDistanceLy: 22200,
    visualRadiusLy: 320,
    color: "#ffd9a0",
    factsZh: [
      { label: "成员", value: "数十万颗老年恒星（偏红黄色调）" },
      { label: "位置", value: "银晕中（银盘面外）" },
      { label: "真实距离", value: "约 22,200 光年" },
    ],
    dynamicsZh: "致密球状的老年恒星集团，绕银河系中心长周期运行",
    dataSource: "NASA HST 球状星团 M13 观测",
  },
  // ---- 可选项扩展（需求 3.1.5 可选特殊天体，L3） ----
  {
    id: "cygnus-x1",
    name: "Cygnus X-1",
    nameZh: "天鹅座X-1",
    kind: "black-hole",
    typeZh: "恒星级黑洞（X射线双星）",
    level: "L3",
    positionMode: "sun-relative",
    // 银纬 b ≈ +3.1°（SIMBAD Cyg X-1）：y = round(3302 × tan(+3.1°)) = +179
    offsetLy: { x: 1900, y: 179, z: -2700 },
    realDistanceLy: 7200,
    visualRadiusLy: 130,
    color: "#9fc8ff",
    factsZh: [
      { label: "质量", value: "约 21 太阳质量" },
      { label: "伴星", value: "HDE 226868（蓝超巨星），物质被剥离形成吸积盘" },
      { label: "历史", value: "1971 年首个被广泛认可的黑洞候选体" },
      { label: "真实距离", value: "约 7,200 光年" },
    ],
    dynamicsZh:
      "从蓝超巨星伴星剥离的物质形成吸积盘并发出强 X 射线；吸积盘较差旋转（内圈快外圈慢），近观切换引力透镜 raymarch：光子环 + 背景星光弯曲 + 吸积盘上下缘翻折像",
    dataSource:
      "Miller-Jones et al. (2021), Science；NASA Chandra 天鹅座X-1 观测；近观透镜为 Schwarzschild 二阶弯曲近似（视界渲染半径按可视化比例压缩、背景为程序化星场近似）；盘色为黑体色档艺术化映射（峰值 ≈9,800 K 蓝白，真实盘内区 ~10⁷ K X 射线域不可光学表现）",
  },
  {
    id: "wr-124",
    name: "WR 124",
    nameZh: "沃尔夫-拉叶星 WR 124",
    kind: "wolf-rayet",
    typeZh: "沃尔夫-拉叶星（大质量恒星晚期）",
    level: "L3",
    positionMode: "sun-relative",
    // 银纬 b ≈ +3.3°（SIMBAD WR 124）：y = round(4993 × tan(+3.3°)) = +288
    offsetLy: { x: -2700, y: 288, z: -4200 },
    realDistanceLy: 21000,
    visualRadiusLy: 170,
    color: "#cfe0ff",
    factsZh: [
      { label: "表面温度", value: "约 44,000 K（炽热蓝白色）" },
      { label: "星风速度", value: "数千 km/s 的强星风，快速抛失外层" },
      { label: "周围星云", value: "M1-67 抛射星云（JWST 2022 红外成像）" },
      { label: "结局", value: "预计以超新星（或伽马暴）终结" },
      { label: "真实距离", value: "约 21,000 光年" },
    ],
    dynamicsZh:
      "强星风粒子持续径向外流（数千 km/s），外围为恒星自身抛出的 M1-67 膨胀星云壳",
    dataSource: "JWST ERO 2022（WR 124 / M1-67）；Crowther (2007) WR 星综述",
  },
  {
    id: "delta-cephei",
    name: "Delta Cephei",
    nameZh: "造父一",
    kind: "cepheid",
    typeZh: "造父变星（脉动变星）",
    level: "L3",
    positionMode: "sun-relative",
    // 银纬 b ≈ +0.5°（SIMBAD δ Cep）：y = round(4528 × tan(+0.5°)) = +40
    offsetLy: { x: 3100, y: 40, z: 3300 },
    realDistanceLy: 887,
    visualRadiusLy: 150,
    color: "#ffe9b8",
    factsZh: [
      { label: "光变周期", value: "5.366 天（可视化降频表现，已登记）" },
      { label: "视星等变化", value: "3.48 → 4.37（快速增亮、缓慢变暗）" },
      {
        label: "量天尺",
        value:
          "周光关系（Leavitt 1912）：光变周期越长光度越高，据此可测星系际距离——宇宙距离阶梯的基石",
      },
      { label: "真实距离", value: "约 887 光年" },
    ],
    dynamicsZh:
      '恒星外层周期性膨胀收缩（κ 机制）导致亮度锯齿形周期变化：快速上升、缓慢下降；周光关系使造父变星成为"量天尺"',
    dataSource: "AAVSO δ Cephei 光变数据；Leavitt & Pickering (1912)",
  },
  {
    id: "pleiades",
    name: "Pleiades (M45)",
    nameZh: "昴星团",
    kind: "open-cluster",
    typeZh: "疏散星团",
    level: "L3",
    positionMode: "sun-relative",
    // 银纬 b ≈ −23.5°（SIMBAD M45）：y = round(3716 × tan(−23.5°)) = −1616
    offsetLy: { x: -1500, y: -1616, z: -3400 },
    realDistanceLy: 444,
    visualRadiusLy: 260,
    color: "#bcd7ff",
    factsZh: [
      { label: "成员", value: '1000+ 颗恒星，最亮的"七姊妹"肉眼可见' },
      { label: "年龄", value: "约 1 亿年（年轻的热蓝星为主）" },
      { label: "反射星云", value: "蓝色星云为星光被尘埃散射（非电离发光）" },
      { label: "真实距离", value: "约 444 光年（最近的疏散星团之一）" },
    ],
    dynamicsZh:
      "松散引力束缚的年轻恒星集团（与球状星团的致密老年恒星相对），热蓝星微闪烁，周围有蓝色反射星云",
    dataSource: "Gaia DR3 昴星团成员星测量；NASA APOD M45",
  },
  {
    id: "horsehead-nebula",
    name: "Horsehead Nebula (Barnard 33)",
    nameZh: "马头星云",
    kind: "dark-nebula",
    typeZh: "暗星云（分子云剪影）",
    level: "L3",
    positionMode: "sun-relative",
    // 银纬 b ≈ −16.8°（SIMBAD Barnard 33）：y = round(4648 × tan(−16.8°)) = −1403
    offsetLy: { x: 3950, y: -1403, z: 2450 },
    realDistanceLy: 1375,
    visualRadiusLy: 190,
    color: "#2a2030",
    factsZh: [
      { label: "本质", value: "寒冷致密的暗分子云（尘埃遮光）" },
      {
        label: "剪影",
        value: "在背景发射星云 IC 434 的氢α红光前形成马头形剪影",
      },
      { label: "尺度", value: '"马头"高约 3.5 光年' },
      { label: "真实距离", value: "约 1,375 光年（猎户座）" },
    ],
    dynamicsZh:
      "前景冷分子云吸收背景电离氢区的红光形成剪影遮挡效果（暗星云不发光，靠遮挡被看见）",
    dataSource: "NASA HST / ESO 马头星云观测（Barnard 33）",
  },
  {
    id: "quasar-3c273",
    name: "3C 273",
    nameZh: "类星体 3C 273",
    kind: "quasar",
    typeZh: "类星体（活动星系核）",
    level: "L4",
    positionMode: "extragalactic",
    // 已归一化：0.3² + 0.75² + 0.59² ≈ 1.00
    direction: { x: 0.3, y: 0.75, z: 0.59 },
    realDistanceLy: 2.4e9,
    visualRadiusLy: 0,
    color: "#cfe8ff",
    factsZh: [
      { label: "距离", value: "约 24 亿光年（首个被确认的类星体）" },
      { label: "光度", value: "约银河系的 100 倍以上" },
      { label: "喷流", value: "相对论喷流长数十万光年" },
    ],
    dynamicsZh:
      "中心超大质量黑洞吸积产生极亮核心与双向相对论喷流（含流动动画），亮度不规则光变闪烁",
    dataSource: "NASA/IPAC Extragalactic Database (NED)；Schmidt (1963)",
  },
  // ---- 可选项扩展（需求 3.1.5 可选河外对象，L4） ----
  {
    id: "antennae-galaxies",
    name: "Antennae Galaxies (NGC 4038/4039)",
    nameZh: "触须星系",
    kind: "galaxy-collision",
    typeZh: "星系碰撞现场（并合中的旋涡星系对）",
    level: "L4",
    positionMode: "extragalactic",
    // 已归一化：(−0.55)² + 0.45² + 0.7² ≈ 0.995
    direction: { x: -0.55, y: 0.45, z: 0.7 },
    realDistanceLy: 4.5e7,
    visualRadiusLy: 0,
    color: "#ffd8c8",
    factsZh: [
      { label: "距离", value: "约 4,500 万光年（乌鸦座）" },
      { label: "进程", value: "两旋涡星系约 6 亿年前开始碰撞，正在并合" },
      { label: "触须", value: "两条长长的潮汐尾（被引力甩出的恒星流）" },
      { label: "星暴", value: "碰撞压缩气体，触发剧烈恒星形成" },
    ],
    dynamicsZh:
      '两个旋涡星系相互穿越并合：引力潮汐把恒星甩成两条"触须"状潮汐尾，气体压缩触发星暴（银河系—仙女座未来命运的预演）',
    dataSource:
      "NASA HST 触须星系观测（NGC 4038/4039）；Toomre & Toomre (1972)",
  },
  {
    id: "cluster-lensing",
    name: "Galaxy Cluster Gravitational Lensing Arcs",
    nameZh: "星系团引力透镜弧",
    kind: "lensing-cluster",
    typeZh: "星系团引力透镜（背景星系光弧）",
    level: "L4",
    positionMode: "extragalactic",
    // 与室女座星系团（M87）同方向：透镜弧示意置于最近的大型星系团处
    // （原型 Abell 370 距离约 48 亿光年，此处为便于观察的示意位置，已登记）
    direction: { x: 0.1, y: 0.86, z: 0.5 },
    realDistanceLy: 5.4e7,
    visualRadiusLy: 0,
    color: "#a8d4ff",
    factsZh: [
      {
        label: "原理",
        value: "星系团总质量（含暗物质）弯曲时空，使背景星系的光线偏折",
      },
      {
        label: "光弧",
        value: "背景星系被拉伸放大成弧状虚像（爱因斯坦广义相对论预言）",
      },
      {
        label: "原型",
        value: "Abell 370 星系团（首个发现引力透镜弧，距离约 48 亿光年）",
      },
      {
        label: "示意说明",
        value: "弧置于室女座星系团位置便于观察（示意，已登记）",
      },
    ],
    dynamicsZh:
      "背景星系的光被星系团引力场弯曲成蓝色弧状拉伸虚像，围绕团中心分布——暗物质质量分布的直接探针",
    dataSource:
      "Soucail et al. (1987) Abell 370 巨弧；NASA HST Frontier Fields",
  },
  {
    id: "grb-221009a",
    name: 'GRB 221009A ("BOAT")',
    nameZh: "伽马射线暴 GRB 221009A",
    kind: "gamma-ray-burst",
    typeZh: "伽马射线暴（长暴）",
    level: "L4",
    positionMode: "extragalactic",
    // 已归一化：(−0.62)² + 0.31² + 0.72² ≈ 0.999
    direction: { x: -0.62, y: 0.31, z: 0.72 },
    realDistanceLy: 2.0e9,
    visualRadiusLy: 0,
    color: "#e8f4ff",
    factsZh: [
      {
        label: "原型",
        value: "GRB 221009A（2022-10-09，史上最亮伽马暴，绰号 BOAT）",
      },
      { label: "距离", value: "约 20 亿光年（红移 z ≈ 0.151）" },
      { label: "本质", value: "大质量恒星核坍缩，相对论喷流恰好指向地球" },
      {
        label: "演示说明",
        value: "真实 GRB 为一次性事件，此处周期性重放为演示示意（已登记）",
      },
    ],
    dynamicsZh:
      "恒星核坍缩产生的相对论喷流正对观察者：数秒内的极亮伽马闪光（FRED 光变曲线：快升指数衰减）+ 余辉衰减",
    dataSource: "NASA Swift/Fermi GRB 221009A 观测；Burns et al. (2023)",
  },
] as const;

/**
 * 按 id 查找特殊天体
 */
export function getSpecialBodyById(id: string): SpecialBodyData | undefined {
  return SPECIAL_BODIES.find((b) => b.id === id);
}

/**
 * 判定 id 是否为"银河系组内锚定"的可跟随目标（L3 特殊天体或超新星事件）
 *
 * 用途（bug 修复：飞往/跟随特殊天体后目标不可见）：特殊天体距场景原点仅
 * 150–400 单位，飞抵后相机距原点落入 L2 连续层级区间，而银河系内容按层级
 * 门控在 2.5 以下完全淡出——导致"飞过去却看不到"。跟随/飞往这类目标期间
 * 需要对目标天体与银河系组做聚焦权重提升（保持可见），本函数为判定依据。
 * 河外特殊天体（positionMode 'extragalactic'）不在银河系组内，不适用。
 *
 * R2-5 §5.1-C 白名单扩展：日球层顶（heliopause）纳入——L3 域序列成员，
 * 飞抵观察层级 ~2.65 处银河系组常态已部分可见，聚焦提升保证巡游期间
 * 银河系上下文不因层级波动淡出。实现差异登记：L3 序列成员"太阳（sun）"
 * 不纳入——飞抵太阳后相机落入 L1 太阳系尺度，若提升银河系组权重会让
 * 太阳邻域银河粒子贴着太阳显示（复发历史 bug"被误认为柯伊伯带跑错
 * 位置"，见 Galaxy.tsx 淡入起点注释），太阳自身可见性不依赖银河系组。
 */
export function isGalaxyAnchoredFocusId(id: string): boolean {
  if (id.startsWith("sn-")) return true;
  if (id === "heliopause") return true;
  const body = getSpecialBodyById(id);
  return Boolean(
    body && body.level === "L3" && body.positionMode !== "extragalactic",
  );
}
